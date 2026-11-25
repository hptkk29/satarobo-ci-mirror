import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { writeAudit } from "@/lib/audit/audit-log";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuid } from "uuid";
import { getR2Client, getR2Bucket, getPublicUrl } from "@/lib/storage/r2-client";
import { z } from "zod";
import {
  validateQuestions,
  toPrismaType,
  type ParsedQuestion,
  type DocxQuestionType,
} from "@/lib/exams/docx-import";

export const runtime = "nodejs";

const optionSchema = z.object({
  key: z.string().min(1).max(1),
  text: z.string().default(""),
  imageRId: z.string().nullable().optional().default(null),
});

const questionSchema = z.object({
  questionCode: z.string().trim().min(1),
  type: z.enum(["SINGLE", "MULTI", "TRUE_FALSE"]),
  text: z.string().default(""),
  questionImageRId: z.string().nullable().optional().default(null),
  options: z.array(optionSchema).default([]),
  correctRaw: z.string().default(""),
  score: z.coerce.number().nullable().default(null),
  explanation: z.string().nullable().optional().default(null),
  tags: z.array(z.string()).default([]),
});

const bodySchema = z.object({
  examId: z.string().trim().optional().nullable(),
  questions: z.array(questionSchema).min(1, "Không có câu hỏi"),
  // rId → data-url (chỉ ảnh thực sự dùng).
  media: z.record(z.string(), z.string()).default({}),
});

function decodeDataUrl(dataUrl: string): { mime: string; buf: Buffer } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], buf: Buffer.from(m[2], "base64") };
}

function extForMime(mime: string): string {
  if (mime.includes("png")) return ".png";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("webp")) return ".webp";
  return ".bin";
}

async function uploadDataUrl(dataUrl: string): Promise<string | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const ext = extForMime(decoded.mime);
  const datePrefix = new Date().toISOString().slice(0, 7);
  const key = `uploads/images/${datePrefix}/exam-q-${uuid().slice(0, 8)}${ext}`;
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: getR2Bucket(),
      Key: key,
      Body: decoded.buf,
      ContentType: decoded.mime,
    }),
  );
  return getPublicUrl(key);
}

function correctSet(raw: string): Set<string> {
  return new Set(
    raw
      .toUpperCase()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

// POST /admin/exams/import-word/confirm
// Upsert câu hỏi DRAFT (isPublic=false) idempotent theo questionCode. Ảnh → R2.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Chưa đăng nhập" }, { status: 401 });
  }
  if (!(await checkPermission("exams:create"))) {
    return NextResponse.json({ ok: false, error: "Không có quyền" }, { status: 403 });
  }
  if (!session.user.id) {
    return NextResponse.json({ ok: false, error: "Phiên không hợp lệ" }, { status: 401 });
  }
  const sdb = scopedDb(await resolveActor(session.user.id));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" },
      { status: 400 },
    );
  }
  const { examId, questions, media } = parsed.data;

  // Re-validate server-side (không tin client). Chỉ import câu hợp lệ.
  const asParsed: ParsedQuestion[] = questions.map((q) => ({
    questionCode: q.questionCode,
    rawType: q.type,
    type: q.type as DocxQuestionType,
    text: q.text,
    questionImageRId: q.questionImageRId ?? null,
    options: q.options.map((o) => ({
      key: o.key.toUpperCase(),
      text: o.text,
      imageRId: o.imageRId ?? null,
    })),
    correctRaw: q.correctRaw,
    score: q.score,
    explanation: q.explanation ?? null,
    tags: q.tags,
    hasExternalImage: false,
  }));
  const validated = validateQuestions(asParsed);
  const toImport = validated.filter((q) => q.valid);

  if (toImport.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Không có câu hợp lệ để import." },
      { status: 400 },
    );
  }

  // Resolve employee id (author).
  let authorId: string | null = null;
  {
    const u = await sdb.user.findUnique({
      where: { id: session.user.id },
      select: { employeeId: true },
    });
    authorId = u?.employeeId ?? null;
  }

  // Upload tất cả ảnh được dùng (rId → publicUrl) — 1 lần / rId.
  const usedRIds = new Set<string>();
  for (const q of toImport) {
    if (q.questionImageRId) usedRIds.add(q.questionImageRId);
    for (const o of q.options) if (o.imageRId) usedRIds.add(o.imageRId);
  }
  const urlByRId: Record<string, string> = {};
  try {
    for (const rId of usedRIds) {
      const dataUrl = media[rId];
      if (!dataUrl) continue;
      const url = await uploadDataUrl(dataUrl);
      if (url) urlByRId[rId] = url;
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Lỗi tải ảnh lên kho R2: ${err instanceof Error ? err.message : "Unknown"}`,
      },
      { status: 500 },
    );
  }

  let created = 0;
  let updated = 0;
  const importedIds: string[] = [];
  try {
    await sdb.$transaction(async (tx) => {
      for (const q of toImport) {
        const correct = correctSet(q.correctRaw);
        const prismaType = toPrismaType(q.type as DocxQuestionType);
        const base = {
          type: prismaType,
          text: q.text.trim(),
          explanation: q.explanation,
          imageUrl: q.questionImageRId ? (urlByRId[q.questionImageRId] ?? null) : null,
          difficulty: "MEDIUM" as const,
          tags: q.tags,
          correctAnswer: null,
          isPublic: false, // DRAFT — chỉ Đào tạo publish (set isPublic / gắn đề publish)
          notes: null,
          authorId,
        };

        const existing = await tx.question.findUnique({
          where: { questionCode: q.questionCode },
          select: { id: true },
        });

        let questionId: string;
        if (existing) {
          await tx.question.update({ where: { id: existing.id }, data: base });
          await tx.choice.deleteMany({ where: { questionId: existing.id } });
          questionId = existing.id;
          updated++;
        } else {
          const c = await tx.question.create({
            data: { ...base, questionCode: q.questionCode },
            select: { id: true },
          });
          questionId = c.id;
          created++;
        }

        if (q.options.length > 0) {
          await tx.choice.createMany({
            data: q.options.map((o, i) => ({
              questionId,
              order: i + 1,
              text: o.text.trim() || o.key,
              isCorrect: correct.has(o.key.toUpperCase()),
              imageUrl: o.imageRId ? (urlByRId[o.imageRId] ?? null) : null,
            })),
          });
        }
        importedIds.push(questionId);

        // Gắn vào đề (nếu chỉ định) — bỏ qua nếu đã có.
        if (examId) {
          const dup = await tx.examQuestion.findUnique({
            where: { examId_questionId: { examId, questionId } },
            select: { id: true },
          });
          if (!dup) {
            const count = await tx.examQuestion.count({ where: { examId } });
            await tx.examQuestion.create({
              data: { examId, questionId, order: count + 1, points: q.score ?? 1 },
            });
          }
        }
      }
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Lỗi ghi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
      },
      { status: 500 },
    );
  }

  await writeAudit({
    actor: { id: session.user.id ?? null, name: session.user.name ?? "?" },
    module: "exams",
    entityType: "Question",
    entityId: examId ?? "import-word",
    action: "IMPORT",
    newValues: { created, updated, examId: examId ?? null, source: "word" },
    reason: "Import câu hỏi từ file Word (.docx)",
  });

  return NextResponse.json({
    ok: true,
    data: { created, updated, total: importedIds.length, skipped: validated.length - toImport.length },
  });
}
