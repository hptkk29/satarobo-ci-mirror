// app/(teacher)/teacher/kho-bai-tap/_actions.ts — Site GV (L6): "Kho bài tập của tôi".
//
// GV TỰ SOẠN đề (8 loại câu hỏi — parity 18/08: trắc nghiệm 1/nhiều đáp án, Đúng/Sai,
// điền khuyết, trả lời ngắn, tự luận, ghép cặp, sắp xếp) → AssignmentTemplate của MÌNH;
// tự SỬA + XOÁ đề của mình. KHÁC assignments:create (TRAINING soạn kho toàn hệ thống).
//
// BẢO MẬT:
//   - Gate `assignments:author-own` (capability RIÊNG của GV — xem permissions.ts).
//   - Own-scope qua createdById: mọi đường tạo/sửa/xoá gắn/khớp ownerId (employeeId ?? userId).
//   - courseId (nếu chọn) phải là khoá của lớp GV phụ trách — chống gắn khoá lạ.
// AssignmentTemplate/Question/Choice ∉ SCOPED_MODELS → scopedDb pass-through (không
// cần centerId); cách ly ở đây là own-scope, KHÔNG phải cách ly cơ sở.
// KHÔNG import @/lib/db trần (ESLint chặn app/(teacher)/**) — đi qua scopedDb.
"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import {
  RICH_QUESTION_SELECT,
  choiceImageByOrder,
  prepareQuestionsForSave,
  richQuestionData,
  type RichQuestionRow,
  type SerializedQuestion,
} from "@/lib/assignments/question-content-db";
import { resolveTemplateOwnerId } from "./_owner";

// BGĐ 31/07 — file+ảnh GV upload trực tiếp (đã PUT lên R2 qua /api/admin/upload-url).
const attachmentSchema = z.object({
  fileUrl: z.string().url("URL tệp không hợp lệ"),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().nullable().optional(),
  mimeType: z.string().max(100).nullable().optional(),
});

// `questions` để z.unknown() — validate + clean + serialize qua prepareQuestionsForSave
// (nguồn sự thật chung của kho GV + thư viện admin, kèm thông điệp lỗi VI).
const baseSchema = z.object({
  title: z.string().trim().min(1, "Hãy nhập tiêu đề bài tập").max(200),
  // Parity: mô tả KHÔNG bắt buộc (cột DB non-null → lưu chuỗi rỗng).
  description: z.string().trim().max(2000).default(""),
  kind: z.enum(["HOMEWORK", "CLASSWORK"]).default("HOMEWORK"),
  // Khoá học của đề — null/"" = dùng chung mọi khoá (đề cũ trước parity đều null).
  courseId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
  totalPoints: z.coerce.number().min(0.1, "Thang điểm phải lớn hơn 0").max(1000).default(10),
  questions: z.unknown(),
  attachments: z.array(attachmentSchema).max(10, "Tối đa 10 tệp đính kèm").default([]),
});

const createSchema = baseSchema;
const updateSchema = baseSchema.extend({ templateId: z.string().min(1, "Thiếu mã đề") });

type SaveResult = { ok: true; templateId: string } | { ok: false; error: string };
type DeleteResult = { ok: true } | { ok: false; error: string };

/**
 * courseId → curriculumId (khung CT ACTIVE mới nhất của khoá) để lưu trên template.
 * AssignmentTemplate không có cột courseId — liên kết khoá đi qua curriculum.courseId.
 */
async function resolveCurriculumId(
  sdb: ReturnType<typeof scopedDb>,
  courseId: string | null,
): Promise<string | null> {
  if (!courseId) return null;
  const cur = await sdb.curriculum.findFirst({
    where: { courseId, status: "ACTIVE" },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  return cur?.id ?? null;
}

/** Khoá được phép gắn = khoá của các lớp GV đang phụ trách. */
async function assertCourseAllowed(
  sdb: ReturnType<typeof scopedDb>,
  assignedClassIds: ReadonlySet<string>,
  courseId: string | null,
): Promise<string | null> {
  if (!courseId) return null;
  const cls = await sdb.class.findFirst({
    where: { id: { in: [...assignedClassIds] }, courseId },
    select: { id: true },
  });
  return cls ? null : "Khoá học không thuộc lớp bạn phụ trách";
}

/**
 * Tạo Question (+Choice) cho từng câu và link vào template theo thứ tự.
 * `richById` (đường SỬA): hàng cũ theo id — chép lại field giàu (ảnh/điểm/giải
 * thích/khung CT + ảnh đáp án) để round-trip editor không làm rụng dữ liệu.
 */
async function createTemplateQuestions(
  tx: Prisma.TransactionClient,
  templateId: string,
  questions: SerializedQuestion[],
  employeeId: string | null,
  richById?: Map<string, RichQuestionRow>,
): Promise<void> {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const old = richById?.get(q.sourceId);
    const choiceImg = choiceImageByOrder(old);
    const created = await tx.question.create({
      data: {
        type: q.type,
        text: q.text,
        correctAnswer: q.correctAnswer,
        meta: q.meta,
        isPublic: false,
        authorId: employeeId, // FK Employee — null nếu GV chưa gắn hồ sơ nhân sự
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
}

function revalidateKho(): void {
  revalidatePath("/kho-bai-tap");
  revalidatePath("/teacher/kho-bai-tap");
  revalidatePath("/cham-bai");
  revalidatePath("/teacher/cham-bai");
}

/**
 * Tạo 1 AssignmentTemplate do GV tự soạn + các Question (+Choice) + link
 * AssignmentTemplateQuestion theo thứ tự — TẤT CẢ trong 1 transaction.
 */
export async function createOwnTemplateAction(input: unknown): Promise<SaveResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  if (!(await checkPermission("assignments:author-own"))) {
    return { ok: false, error: "Không có quyền soạn bài" };
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const prepared = prepareQuestionsForSave(data.questions);
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const { ownerId, employeeId } = await resolveTemplateOwnerId(sdb, session.user.id);

  const courseErr = await assertCourseAllowed(sdb, actor.assignedClassIds, data.courseId);
  if (courseErr) return { ok: false, error: courseErr };
  const curriculumId = await resolveCurriculumId(sdb, data.courseId);

  let templateId: string;
  try {
    templateId = await sdb.$transaction(async (tx) => {
      const tpl = await tx.assignmentTemplate.create({
        data: {
          title: data.title,
          description: data.description,
          kind: data.kind,
          curriculumId,
          totalPoints: data.totalPoints,
          allowText: true,
          allowFile: true,
          createdById: ownerId, // CHỦ SỞ HỮU — khớp filter "Kho của tôi"
        },
        select: { id: true },
      });

      // BGĐ 31/07 — file+ảnh đề bài GV upload trực tiếp.
      if (data.attachments.length > 0) {
        await tx.assignmentAttachment.createMany({
          data: data.attachments.map((f) => ({
            templateId: tpl.id,
            fileUrl: f.fileUrl,
            fileName: f.fileName,
            fileSize: f.fileSize ?? null,
            mimeType: f.mimeType ?? null,
            uploadedById: session.user.id,
          })),
        });
      }

      // scopedDb là client $extends → cast về TransactionClient chuẩn (pattern
      // session-sync.ts) cho helper dùng chung.
      await createTemplateQuestions(
        tx as unknown as Prisma.TransactionClient,
        tpl.id,
        prepared.questions,
        employeeId,
      );
      return tpl.id;
    });
  } catch (err) {
    console.error("[createOwnTemplateAction]", err);
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không lưu được bài" };
  }

  try {
    const { actorId, actorName } = getAuditActor(session);
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "assignments",
      entityType: "AssignmentTemplate",
      entityId: templateId,
      action: "assignment-template.authored-by-teacher",
      newValues: { title: data.title, kind: data.kind, questions: prepared.questions.length },
    });
  } catch (err) {
    console.error("[createOwnTemplateAction] audit:", err);
  }

  revalidateKho();
  return { ok: true, templateId };
}

/**
 * Sửa 1 đề GV tự soạn (parity: nút bút chì trong kho). CHỈ đề của MÌNH. Câu hỏi
 * thay TOÀN BỘ (xoá link + Question mồ côi cũ, tạo bộ mới) — bài ĐÃ GIAO không ảnh
 * hưởng vì câu hỏi của bài giao là bản CLONE riêng (assignmentId set).
 */
export async function updateOwnTemplateAction(input: unknown): Promise<SaveResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  if (!(await checkPermission("assignments:author-own"))) {
    return { ok: false, error: "Không có quyền soạn bài" };
  }

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const prepared = prepareQuestionsForSave(data.questions);
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const { ownerId, employeeId } = await resolveTemplateOwnerId(sdb, session.user.id);

  const tpl = await sdb.assignmentTemplate.findUnique({
    where: { id: data.templateId },
    select: {
      id: true,
      createdById: true,
      title: true,
      curriculum: { select: { id: true, courseId: true } },
    },
  });
  if (!tpl) return { ok: false, error: "Không tìm thấy đề" };
  if (tpl.createdById !== ownerId) {
    return { ok: false, error: "Chỉ sửa được đề bạn tự soạn" };
  }

  // GIỮ NGUYÊN khoá cũ khi không đổi — kể cả khi GV không còn dạy khoá đó (kỳ sau
  // đổi lớp): sửa tiêu đề không được âm thầm biến đề thành "mọi khoá".
  let curriculumId: string | null;
  if (data.courseId && data.courseId === (tpl.curriculum?.courseId ?? null)) {
    curriculumId = tpl.curriculum?.id ?? null;
  } else {
    const courseErr = await assertCourseAllowed(sdb, actor.assignedClassIds, data.courseId);
    if (courseErr) return { ok: false, error: courseErr };
    curriculumId = await resolveCurriculumId(sdb, data.courseId);
  }

  try {
    await sdb.$transaction(async (tx) => {
      await tx.assignmentTemplate.update({
        where: { id: data.templateId },
        data: {
          title: data.title,
          description: data.description,
          kind: data.kind,
          curriculumId,
          totalPoints: data.totalPoints,
        },
      });

      // Thay toàn bộ câu hỏi: gỡ link cũ + dọn Question mồ côi (assignmentId null).
      const links = await tx.assignmentTemplateQuestion.findMany({
        where: { templateId: data.templateId },
        select: { questionId: true },
      });
      const qids = links.map((l) => l.questionId);
      // Hàng cũ → chép lại field giàu cho câu chỉ-bị-sửa (xem createTemplateQuestions).
      const oldRich: RichQuestionRow[] = qids.length
        ? await tx.question.findMany({
            where: { id: { in: qids } },
            select: RICH_QUESTION_SELECT,
          })
        : [];
      const richById = new Map(oldRich.map((r) => [r.id, r]));
      await tx.assignmentTemplateQuestion.deleteMany({
        where: { templateId: data.templateId },
      });
      if (qids.length > 0) {
        await tx.question.deleteMany({
          // CHỈ dọn câu RIÊNG của đề (isPublic=false) — câu NGÂN HÀNG (public, gắn qua
          // picker admin cũ) chỉ bị gỡ link, KHÔNG xoá (tránh cascade mất khỏi mẫu khác
          // + kẹt FK ExamQuestion Restrict làm GV không sửa/xoá được đề của mình).
          where: { id: { in: qids }, isPublic: false, assignmentId: null },
        });
      }

      await createTemplateQuestions(
        tx as unknown as Prisma.TransactionClient,
        data.templateId,
        prepared.questions,
        employeeId,
        richById,
      );

      // BGĐ 31/07 — file mới (nếu có) APPEND vào đề; file cũ giữ nguyên.
      if (data.attachments.length > 0) {
        await tx.assignmentAttachment.createMany({
          data: data.attachments.map((f) => ({
            templateId: data.templateId,
            fileUrl: f.fileUrl,
            fileName: f.fileName,
            fileSize: f.fileSize ?? null,
            mimeType: f.mimeType ?? null,
            uploadedById: session.user.id,
          })),
        });
      }
    });
  } catch (err) {
    console.error("[updateOwnTemplateAction]", err);
    return { ok: false, error: "Lỗi cơ sở dữ liệu — không lưu được thay đổi" };
  }

  try {
    const { actorId, actorName } = getAuditActor(session);
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "assignments",
      entityType: "AssignmentTemplate",
      entityId: data.templateId,
      action: "assignment-template.updated-by-teacher",
      newValues: { title: data.title, kind: data.kind, questions: prepared.questions.length },
    });
  } catch (err) {
    console.error("[updateOwnTemplateAction] audit:", err);
  }

  revalidateKho();
  return { ok: true, templateId: data.templateId };
}

/**
 * Xoá 1 đề GV tự soạn. CHỈ đề của MÌNH (createdById = ownerId) — chặn xoá đề
 * admin/Đào tạo. Dọn luôn Question mồ côi (assignmentId null) + Choice (cascade).
 * Bài ĐÃ GIAO cho lớp (Assignment) không ảnh hưởng: câu hỏi đã được CLONE sang bản
 * riêng (assignmentId set) + Assignment.templateId onDelete=SetNull.
 */
export async function deleteOwnTemplateAction(templateId: string): Promise<DeleteResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!templateId) return { ok: false, error: "Thiếu mã đề" };

  if (!(await checkPermission("assignments:author-own"))) {
    return { ok: false, error: "Không có quyền" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const { ownerId } = await resolveTemplateOwnerId(sdb, session.user.id);

  const tpl = await sdb.assignmentTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, createdById: true, title: true },
  });
  if (!tpl) return { ok: false, error: "Không tìm thấy đề" };
  if (tpl.createdById !== ownerId) {
    return { ok: false, error: "Chỉ xoá được đề bạn tự soạn" };
  }

  try {
    await sdb.$transaction(async (tx) => {
      const links = await tx.assignmentTemplateQuestion.findMany({
        where: { templateId },
        select: { questionId: true },
      });
      // Xoá template → cascade AssignmentTemplateQuestion; Assignment.templateId → null.
      await tx.assignmentTemplate.delete({ where: { id: templateId } });
      const qids = links.map((l) => l.questionId);
      if (qids.length > 0) {
        // Chỉ dọn câu hỏi mồ côi của template (chưa gắn Assignment nào) — cascade Choice.
        await tx.question.deleteMany({
          // CHỈ dọn câu RIÊNG của đề (isPublic=false) — câu NGÂN HÀNG (public, gắn qua
          // picker admin cũ) chỉ bị gỡ link, KHÔNG xoá (tránh cascade mất khỏi mẫu khác
          // + kẹt FK ExamQuestion Restrict làm GV không sửa/xoá được đề của mình).
          where: { id: { in: qids }, isPublic: false, assignmentId: null },
        });
      }
    });
  } catch (err) {
    console.error("[deleteOwnTemplateAction]", err);
    return { ok: false, error: "Lỗi — không xoá được đề" };
  }

  try {
    const { actorId, actorName } = getAuditActor(session);
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "assignments",
      entityType: "AssignmentTemplate",
      entityId: templateId,
      action: "assignment-template.deleted-by-teacher",
      oldValues: { title: tpl.title },
    });
  } catch (err) {
    console.error("[deleteOwnTemplateAction] audit:", err);
  }

  revalidateKho();
  return { ok: true };
}
