import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  assertDocx,
  parseDocx,
  validateQuestions,
} from "@/lib/exams/docx-import";

export const runtime = "nodejs";

// POST /admin/exams/import-word/parse  (multipart/form-data: file)
// Parse .docx → preview JSON (câu hỏi + validation + ảnh data-url tạm).
// KHÔNG ghi DB ở bước này (đẩy R2 + upsert ở bước confirm).
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body không hợp lệ (cần multipart/form-data)" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Thiếu file" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    // >10MB → khuyến nghị job nền (xem confirm). Bản hiện tại xử lý đồng bộ.
    return NextResponse.json(
      { ok: false, error: "File > 10MB — tách nhỏ hoặc dùng đường import nền (chưa bật)." },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    assertDocx(file.name, file.type, bytes);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "File không hợp lệ" },
      { status: 400 },
    );
  }

  let parsed;
  try {
    parsed = await parseDocx(bytes);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Không đọc được file .docx" },
      { status: 400 },
    );
  }

  // Đối chiếu code đã có trong DB (đánh dấu sẽ-cập-nhật, không phải lỗi).
  const codes = parsed.questions.map((q) => q.questionCode).filter(Boolean);
  const existing =
    codes.length > 0
      ? await sdb.question.findMany({
          where: { questionCode: { in: codes } },
          select: { questionCode: true },
        })
      : [];
  const existingCodes = new Set(
    existing.map((e) => e.questionCode).filter((c): c is string => !!c),
  );

  const validated = validateQuestions(parsed.questions, existingCodes);

  // Ảnh → data-url tạm cho preview.
  const media: Record<string, string> = {};
  for (const [rId, m] of Object.entries(parsed.media)) {
    media[rId] = `data:${m.mime};base64,${m.base64}`;
  }

  return NextResponse.json({
    ok: true,
    data: {
      questions: validated,
      media,
      summary: {
        total: validated.length,
        valid: validated.filter((q) => q.valid).length,
        invalid: validated.filter((q) => !q.valid).length,
        largeFile: validated.length > 50,
      },
    },
  });
}
