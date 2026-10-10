"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import {
  assignmentTemplateSchema,
  templateToAssignmentData,
  type AssignmentTemplateInput,
} from "@/lib/assignments/template";
import {
  RICH_QUESTION_SELECT,
  choiceImageByOrder,
  prepareQuestionsForSave,
  richQuestionData,
  type RichQuestionRow,
} from "@/lib/assignments/question-content-db";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type Sdb = ReturnType<typeof scopedDb>;

// Quyền template = quyền quản lý bài tập (W0): SUPER_ADMIN + TRAINING.
// TEACHER/CM chỉ view (gate ở page → redirect mềm).
async function requireCreate(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("assignments:create"))) {
    return { ok: false, error: "Không có quyền quản lý mẫu bài tập" };
  }
  return { ok: true, userId: session.user.id ?? "" };
}

async function requireEdit(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("assignments:edit"))) {
    return { ok: false, error: "Không có quyền chỉnh sửa mẫu bài tập" };
  }
  return { ok: true, userId: session.user.id ?? "" };
}

async function requireDelete(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("assignments:delete"))) {
    return { ok: false, error: "Không có quyền xoá mẫu bài tập" };
  }
  return { ok: true, userId: session.user.id ?? "" };
}

async function resolveEmployeeId(sdb: Sdb, userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const u = await sdb.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    return u?.employeeId ?? null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// AssignmentTemplate CRUD (nguồn/bank theo KHUNG CT — KHÔNG gắn lớp)
// ──────────────────────────────────────────────────────────────────────────

export async function createTemplate(
  input: AssignmentTemplateInput,
): Promise<Result<{ templateId: string }>> {
  const gate = await requireCreate();
  if (!gate.ok) return gate;

  const parsed = assignmentTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const sdb = scopedDb(await resolveActor(gate.userId));
  const createdById = await resolveEmployeeId(sdb, gate.userId);

  try {
    const t = await sdb.assignmentTemplate.create({
      data: { ...parsed.data, createdById },
      select: { id: true },
    });
    revalidatePath("/assignments/templates");
    return { ok: true, data: { templateId: t.id } };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

export async function createTemplateAndRedirect(input: AssignmentTemplateInput) {
  const res = await createTemplate(input);
  if (!res.ok) return res;
  redirect(`/assignments/templates/${res.data!.templateId}/edit`);
}

export async function updateTemplate(
  id: string,
  input: AssignmentTemplateInput,
): Promise<Result> {
  const gate = await requireEdit();
  if (!gate.ok) return gate;

  const parsed = assignmentTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const sdb = scopedDb(await resolveActor(gate.userId));
  try {
    await sdb.assignmentTemplate.update({ where: { id }, data: parsed.data });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/assignments/templates");
  revalidatePath(`/assignments/templates/${id}/edit`);
  return { ok: true };
}

export async function deleteTemplate(id: string): Promise<Result> {
  const gate = await requireDelete();
  if (!gate.ok) return gate;

  // Bài giao đã sinh từ template chỉ tham chiếu mềm (templateId, onDelete: SetNull
  // ở schema) — xoá template KHÔNG xoá bài giao, chỉ mất liên kết truy vết.
  const sdb = scopedDb(await resolveActor(gate.userId));
  try {
    await sdb.assignmentTemplate.delete({ where: { id } });
  } catch (err) {
    return {
      ok: false,
      error: `Không xoá được: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/assignments/templates");
  return { ok: true };
}

export async function deleteTemplateAndRedirect(id: string): Promise<Result> {
  const res = await deleteTemplate(id);
  if (!res.ok) return res;
  redirect("/assignments/templates");
}

// ──────────────────────────────────────────────────────────────────────────
// FL1-06 (R2) — gắn câu hỏi (ngân hàng) vào template
//   AssignmentTemplateQuestion(templateId, questionId, order) là JOIN tham chiếu.
//   Khi sinh bài giao cho lớp, mỗi link được CLONE thành Question sở hữu của bài.
// ──────────────────────────────────────────────────────────────────────────

const SetTemplateQuestionsSchema = z.object({
  templateId: z.string().min(1, "Thiếu template"),
  // Mảng id câu hỏi theo THỨ TỰ mong muốn (index = order khi clone sang bài giao).
  questionIds: z.array(z.string().min(1)).max(200),
});

export async function setTemplateQuestions(
  input: z.infer<typeof SetTemplateQuestionsSchema>,
): Promise<Result> {
  // Cùng cổng quyền với sửa mẫu (soạn nội dung mẫu = chỉnh sửa mẫu).
  const gate = await requireEdit();
  if (!gate.ok) return gate;

  const parsed = SetTemplateQuestionsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { templateId, questionIds } = parsed.data;

  const sdb = scopedDb(await resolveActor(gate.userId));

  const template = await sdb.assignmentTemplate.findUnique({
    where: { id: templateId },
    select: { id: true },
  });
  if (!template) return { ok: false, error: "Không tìm thấy mẫu bài tập" };

  // Khử trùng lặp nhưng giữ thứ tự xuất hiện đầu tiên (order = index sau khử trùng).
  const uniqueIds = [...new Set(questionIds)];

  try {
    await sdb.$transaction(async (tx) => {
      // Sync = xoá toàn bộ link cũ rồi tạo lại theo thứ tự mới (đơn giản, idempotent).
      await tx.assignmentTemplateQuestion.deleteMany({ where: { templateId } });
      if (uniqueIds.length > 0) {
        await tx.assignmentTemplateQuestion.createMany({
          data: uniqueIds.map((questionId, order) => ({ templateId, questionId, order })),
          skipDuplicates: true,
        });
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath(`/assignments/templates/${templateId}/edit`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Parity site GV 18/08 — SOẠN câu hỏi TRỰC TIẾP trong mẫu (thay picker ngân hàng).
//   Cùng bộ soạn 8 loại với "Tạo bài tập" của GV (QuestionListEditor +
//   prepareQuestionsForSave). Câu hỏi lưu thành Question riêng của mẫu
//   (isPublic=false) + link AssignmentTemplateQuestion theo thứ tự — khi giao/sinh
//   bài cho lớp vẫn CLONE như cũ. Mẫu "chưa số hoá" hợp lệ (0 câu → chỉ gỡ link).
// ──────────────────────────────────────────────────────────────────────────

const SaveAuthoredSchema = z.object({
  templateId: z.string().min(1, "Thiếu template"),
  questions: z.unknown(),
});

export async function saveTemplateQuestionsAuthored(
  input: z.infer<typeof SaveAuthoredSchema>,
): Promise<Result> {
  // Cùng cổng quyền với sửa mẫu (soạn nội dung mẫu = chỉnh sửa mẫu).
  const gate = await requireEdit();
  if (!gate.ok) return gate;

  const parsed = SaveAuthoredSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { templateId } = parsed.data;

  // 0 câu = mẫu mô tả thuần (chưa số hoá) — hợp lệ, chỉ dọn link cũ.
  const isEmpty = Array.isArray(parsed.data.questions) && parsed.data.questions.length === 0;
  const prepared = isEmpty
    ? ({ ok: true, questions: [] } as const)
    : prepareQuestionsForSave(parsed.data.questions);
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const sdb = scopedDb(await resolveActor(gate.userId));

  const template = await sdb.assignmentTemplate.findUnique({
    where: { id: templateId },
    select: { id: true },
  });
  if (!template) return { ok: false, error: "Không tìm thấy mẫu bài tập" };

  const authorId = await resolveEmployeeId(sdb, gate.userId);

  try {
    await sdb.$transaction(async (tx) => {
      // Gỡ toàn bộ link cũ; dọn Question RIÊNG của mẫu đã mồ côi (isPublic=false,
      // chưa gắn bài giao). Câu hỏi NGÂN HÀNG (isPublic=true, từ picker cũ) chỉ bị
      // gỡ link — KHÔNG xoá khỏi ngân hàng.
      const links = await tx.assignmentTemplateQuestion.findMany({
        where: { templateId },
        select: { questionId: true },
      });
      const qids = links.map((l) => l.questionId);
      // Hàng cũ để CHÉP LẠI field giàu (ảnh/điểm/giải thích/khung CT + ảnh đáp án)
      // — editor 8-loại không quản lý các field này, thiếu bước chép là round-trip
      // "Lưu bộ câu hỏi" tự rụng dữ liệu dù không sửa gì.
      const oldRich: RichQuestionRow[] = qids.length
        ? await tx.question.findMany({
            where: { id: { in: qids } },
            select: RICH_QUESTION_SELECT,
          })
        : [];
      const richById = new Map(oldRich.map((r) => [r.id, r]));

      await tx.assignmentTemplateQuestion.deleteMany({ where: { templateId } });
      if (qids.length > 0) {
        await tx.question.deleteMany({
          where: { id: { in: qids }, isPublic: false, assignmentId: null },
        });
      }

      for (let i = 0; i < prepared.questions.length; i++) {
        const q = prepared.questions[i]!;
        const old = richById.get(q.sourceId);
        const choiceImg = choiceImageByOrder(old);
        const created = await tx.question.create({
          data: {
            type: q.type,
            text: q.text,
            correctAnswer: q.correctAnswer,
            meta: q.meta,
            isPublic: false,
            authorId,
            ...richQuestionData(old),
            ...(q.choices.length > 0
              ? {
                  choices: {
                    create: q.choices.map((c) => ({
                      order: c.order,
                      text: c.text,
                      isCorrect: c.isCorrect,
                      imageUrl: choiceImg.get(c.order) ?? null,
                    })),
                  },
                }
              : {}),
          },
          select: { id: true },
        });
        await tx.assignmentTemplateQuestion.create({
          data: { templateId, questionId: created.id, order: i },
        });
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath(`/assignments/templates/${templateId}/edit`);
  revalidatePath("/assignments/templates");
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Sinh bài giao cho lớp từ template (copy field + giữ templateId truy vết)
// ──────────────────────────────────────────────────────────────────────────

const GenerateSchema = z.object({
  templateId: z.string().min(1, "Thiếu template"),
  classId: z.string().min(1, "Chọn lớp"),
  dueAt: z
    .union([z.coerce.date(), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

export async function generateAssignmentFromTemplate(
  input: z.infer<typeof GenerateSchema>,
): Promise<Result<{ assignmentId: string }>> {
  // Sinh bài giao = tạo Assignment → cần quyền tạo bài tập.
  const gate = await requireCreate();
  if (!gate.ok) return gate;

  const parsed = GenerateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { templateId, classId, dueAt } = parsed.data;

  const sdb = scopedDb(await resolveActor(gate.userId));

  const template = await sdb.assignmentTemplate.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      title: true,
      description: true,
      instructions: true,
      kind: true,
      lessonId: true,
      totalPoints: true,
      allowText: true,
      allowFile: true,
      // BGĐ 31/07 — file đề bài đính kèm: copy tham chiếu sang bài giao.
      attachments: {
        select: { fileUrl: true, fileName: true, fileSize: true, mimeType: true, uploadedById: true },
      },
    },
  });
  if (!template) return { ok: false, error: "Không tìm thấy mẫu bài tập" };

  // Class ∈ SCOPED_MODELS → findFirst auto-scope theo cơ sở actor: không thể sinh
  // bài giao vào lớp ngoài tầm nhìn cơ sở (CS1 không giao cho lớp CS2).
  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { id: true },
  });
  if (!cls) return { ok: false, error: "Không tìm thấy lớp hoặc lớp đã xoá" };

  // QA 21/07 (#2) — mỗi mẫu chỉ sinh 1 bài/lớp (unique classId+templateId). Chặn
  // sớm với thông báo thân thiện thay vì để lộ stack Prisma ra banner đỏ.
  const already = await sdb.assignment.findFirst({
    where: { classId, templateId },
    select: { id: true },
  });
  if (already) {
    return {
      ok: false,
      error:
        "Lớp này đã được sinh bài từ mẫu này rồi (mỗi mẫu chỉ sinh 1 bài/lớp). Sửa bài đã sinh ở trang Bài tập.",
    };
  }

  const createdById = await resolveEmployeeId(sdb, gate.userId);
  const data = templateToAssignmentData(template, { classId, createdById, dueAt });

  // Câu hỏi gắn template (ngân hàng) — CLONE sang Question SỞ HỮU của bài giao.
  // Question.assignmentId (onDelete Cascade) ⇒ bài giao có câu hỏi riêng, đáp được.
  const links = await sdb.assignmentTemplateQuestion.findMany({
    where: { templateId },
    orderBy: { order: "asc" },
    select: {
      question: {
        select: {
          type: true,
          text: true,
          explanation: true,
          imageUrl: true,
          difficulty: true,
          points: true,
          timeLimitSec: true,
          correctAnswer: true,
          meta: true, // Parity 18/08 — payload soạn đề (điền khuyết/ghép cặp/sắp xếp)
          tags: true,
          curriculumId: true,
          courseId: true,
          lessonId: true,
          choices: {
            orderBy: { order: "asc" },
            select: { order: true, text: true, isCorrect: true, imageUrl: true },
          },
        },
      },
    },
  });

  try {
    const a = await sdb.$transaction(async (tx) => {
      const created = await tx.assignment.create({ data, select: { id: true } });

      // BGĐ 31/07 — copy tham chiếu file đề bài của template sang bài giao.
      if (template.attachments.length > 0) {
        await tx.assignmentAttachment.createMany({
          data: template.attachments.map((f) => ({
            assignmentId: created.id,
            fileUrl: f.fileUrl,
            fileName: f.fileName,
            fileSize: f.fileSize,
            mimeType: f.mimeType,
            uploadedById: f.uploadedById,
          })),
        });
      }

      // Clone từng câu hỏi ngân hàng → Question mới gắn assignmentId, isPublic=false
      // (bản sở hữu, không chia sẻ). KHÔNG copy questionCode (unique) → để null.
      // Giữ thứ tự link.order bằng cách tạo tuần tự trong cùng transaction.
      for (const { question: q } of links) {
        await tx.question.create({
          data: {
            type: q.type,
            text: q.text,
            explanation: q.explanation,
            imageUrl: q.imageUrl,
            difficulty: q.difficulty,
            points: q.points,
            timeLimitSec: q.timeLimitSec,
            correctAnswer: q.correctAnswer,
            meta: (q.meta ?? undefined) as Prisma.InputJsonValue | undefined,
            tags: q.tags,
            curriculumId: q.curriculumId,
            courseId: q.courseId,
            lessonId: q.lessonId,
            isPublic: false,
            assignmentId: created.id,
            choices: {
              create: q.choices.map((c) => ({
                order: c.order,
                text: c.text,
                isCorrect: c.isCorrect,
                imageUrl: c.imageUrl,
              })),
            },
          },
        });
      }

      return created;
    });

    revalidatePath("/assignments");
    revalidatePath(`/assignments/templates/${templateId}/edit`);
    return { ok: true, data: { assignmentId: a.id } };
  } catch (err) {
    // Race 2 người cùng sinh: unique (classId, templateId) → cùng thông báo thân thiện.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        ok: false,
        error: "Lớp này đã được sinh bài từ mẫu này rồi (mỗi mẫu chỉ sinh 1 bài/lớp).",
      };
    }
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}
