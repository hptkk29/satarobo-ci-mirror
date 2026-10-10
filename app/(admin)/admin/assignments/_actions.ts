"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { checkPermission, assertPermission } from "@/lib/auth/check-permission";
import { canManageSessionClass } from "@/app/(admin)/admin/sessions/[id]/_actions";
import { z } from "zod";
import {
  assignmentSchema,
  type AssignmentInput,
} from "@/lib/validators/assignment";
import { QuestionTypeEnum } from "@/lib/validators/question";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { RUBRIC_CRITERION_KEYS, RUBRIC_LEVEL_KEYS, rubricToScore } from "@/lib/rubric/criteria";
import { enqueueEmail } from "@/lib/email/queue";
import type { RubricCriterion, RubricLevel } from "@prisma/client";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type Sdb = ReturnType<typeof scopedDb>;

type GradeActor = {
  id: string;
  role: string;
  centerId: string | null;
  grants?: { action: string; grant: "ALLOW" | "DENY" }[];
};

// Loại B (Nhóm 01 L1) — Assignment/AssignmentSubmission/AssignmentDocument KHÔNG
// ∈ SCOPED_MODELS (không centerId) → scopedDb pass-through. Cách ly tay qua lớp
// của bài.
// Vá 24/07 — GHI/CHẤM đối xứng ĐỌC: scope per-model qua passesScope("Class"),
// role HO chỉ cross-center khi CÓ quyền classes:* scope ALL (Toại TRAINING@HO
// hết sửa/chấm bài tập lớp CS2). KHÔNG dùng cờ isHoLevel trần. classId của
// Assignment là bắt buộc — nhánh cls null (quan hệ hỏng) giữ rule cũ HO/SUPER.
function classCenterVisible(
  actor: Actor,
  cls: { centerId: string | null } | null | undefined,
): boolean {
  if (!cls) return actor.isSuperAdmin || actor.isHoLevel;
  return passesScope("Class", cls, actor);
}

async function requireRole(
  // Cổng THÔ (coarse) trước khi xét own-class. Mặc định "assignments:create" (soạn/
  // sửa/xoá/publish = TRAINING/Admin). CHẤM bài truyền "assignments:grade" để GV
  // (chỉ có grade, không có create) qua được — own-class do canGradeClassWork gác sau.
  permission: Parameters<typeof checkPermission>[0] = "assignments:create",
): Promise<
  | { ok: true; userId: string; user: GradeActor; actor: Actor; sdb: Sdb }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(permission))) {
    return { ok: false, error: "Không có quyền quản lý bài tập" };
  }
  const actor = await resolveActor(session.user.id);
  return {
    ok: true,
    userId: session.user.id ?? "",
    user: session.user,
    actor,
    sdb: scopedDb(actor),
  };
}

// LMS-2 / W1-2 — gate phân quyền CHẤM ĐIỂM: GV chỉ chấm bài của lớp mình
// dạy/trợ giảng (tái dùng canManageSessionClass: teacherId|assistantId == me);
// Đào tạo/Admin có quyền report-cards:review | training:manage chấm mọi lớp.
// Bài không gắn lớp (null) → chỉ Đào tạo/Admin.
async function canGradeClassWork(
  user: GradeActor,
  cls: { teacherId: string | null; assistantId: string | null; centerId: string | null } | null,
): Promise<boolean> {
  if (cls && (await canManageSessionClass(user, cls))) return true;
  return (
    (await checkPermission("report-cards:review")) ||
    (await checkPermission("training:manage"))
  );
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

/** Loại B — bài tập theo id từ client: xác minh lớp của bài thuộc tầm nhìn actor. */
async function assignmentClassVisible(
  sdb: Sdb,
  actor: Actor,
  assignmentId: string,
): Promise<boolean> {
  const a = await sdb.assignment.findUnique({
    where: { id: assignmentId },
    select: { class: { select: { centerId: true } } },
  });
  return !!a && classCenterVisible(actor, a.class);
}

// ──────────────────────────────────────────────────────────────────────────
// Assignment CRUD
// ──────────────────────────────────────────────────────────────────────────

export async function createAssignment(
  input: AssignmentInput,
): Promise<Result<{ assignmentId: string }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  // Loại B — lớp của bài tập mới phải thuộc tầm nhìn actor (sdb.class auto-scope
  // → lớp ngoài cơ sở trả null).
  const cls = await gate.sdb.class.findUnique({
    where: { id: data.classId },
    select: { centerId: true },
  });
  if (!cls || !classCenterVisible(gate.actor, cls)) {
    return { ok: false, error: "Lớp không tồn tại hoặc ngoài phạm vi cơ sở" };
  }

  const createdById = await resolveEmployeeId(gate.sdb, gate.userId);

  try {
    const a = await gate.sdb.assignment.create({
      data: { ...data, createdById },
      select: { id: true },
    });
    revalidatePath("/assignments");
    return { ok: true, data: { assignmentId: a.id } };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

export async function createAssignmentAndRedirect(input: AssignmentInput) {
  const res = await createAssignment(input);
  if (!res.ok) return res;
  redirect(`/assignments/${res.data!.assignmentId}/edit`);
}

export async function updateAssignment(
  id: string,
  input: AssignmentInput,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  // Loại B — bài hiện tại + lớp đích (nếu đổi) đều phải trong tầm nhìn actor.
  if (!(await assignmentClassVisible(gate.sdb, gate.actor, id))) {
    return { ok: false, error: "Không tìm thấy bài tập" };
  }
  const targetCls = await gate.sdb.class.findUnique({
    where: { id: parsed.data.classId },
    select: { centerId: true },
  });
  if (!targetCls || !classCenterVisible(gate.actor, targetCls)) {
    return { ok: false, error: "Lớp không tồn tại hoặc ngoài phạm vi cơ sở" };
  }

  try {
    await gate.sdb.assignment.update({ where: { id }, data: parsed.data });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/assignments");
  revalidatePath(`/assignments/${id}/edit`);
  return { ok: true };
}

export async function deleteAssignment(id: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  // Loại B — chống IDOR xoá bài tập của lớp cơ sở khác.
  if (!(await assignmentClassVisible(gate.sdb, gate.actor, id))) {
    return { ok: false, error: "Không tìm thấy bài tập" };
  }

  const submitted = await gate.sdb.assignmentSubmission.count({
    where: {
      assignmentId: id,
      status: { in: ["SUBMITTED", "LATE", "GRADED"] },
    },
  });
  if (submitted > 0) {
    return {
      ok: false,
      error: `Có ${submitted} HS đã nộp — không thể xoá. Đổi sang ARCHIVED thay vì xoá.`,
    };
  }

  try {
    // AssignmentDocument auto-cascades; AssignmentSubmission needs manual cleanup
    // (it's RESTRICT-on-delete to protect graded history; here we cleared above).
    await gate.sdb.$transaction([
      gate.sdb.assignmentSubmission.deleteMany({ where: { assignmentId: id } }),
      gate.sdb.assignment.delete({ where: { id } }),
    ]);
  } catch (err) {
    return {
      ok: false,
      error: `Không xoá được: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/assignments");
  return { ok: true };
}

export async function deleteAssignmentAndRedirect(id: string): Promise<Result> {
  const res = await deleteAssignment(id);
  if (!res.ok) return res;
  redirect("/assignments");
}

// ──────────────────────────────────────────────────────────────────────────
// Attach / Detach Document
// ──────────────────────────────────────────────────────────────────────────

const AttachSchema = z.object({
  assignmentId: z.string().min(1),
  documentId: z.string().min(1),
});

export async function attachDocument(
  input: z.infer<typeof AttachSchema>,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = AttachSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Tham số không hợp lệ" };
  const { assignmentId, documentId } = parsed.data;

  // Loại B — chống IDOR đính tài liệu vào bài tập của lớp cơ sở khác.
  if (!(await assignmentClassVisible(gate.sdb, gate.actor, assignmentId))) {
    return { ok: false, error: "Không tìm thấy bài tập" };
  }

  const existing = await gate.sdb.assignmentDocument.findUnique({
    where: { assignmentId_documentId: { assignmentId, documentId } },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "Tài liệu đã đính kèm" };

  try {
    await gate.sdb.assignmentDocument.create({ data: { assignmentId, documentId } });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath(`/assignments/${assignmentId}/edit`);
  return { ok: true };
}

export async function detachDocument(
  assignmentDocumentId: string,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const ad = await gate.sdb.assignmentDocument.findUnique({
    where: { id: assignmentDocumentId },
    select: { assignmentId: true },
  });
  if (!ad) return { ok: false, error: "Không tìm thấy bản ghi" };

  // Loại B — chống IDOR gỡ tài liệu của bài tập lớp cơ sở khác.
  if (!(await assignmentClassVisible(gate.sdb, gate.actor, ad.assignmentId))) {
    return { ok: false, error: "Không tìm thấy bản ghi" };
  }

  try {
    await gate.sdb.assignmentDocument.delete({ where: { id: assignmentDocumentId } });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath(`/assignments/${ad.assignmentId}/edit`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Publish: auto-create AssignmentSubmission for every enrolled student
// ──────────────────────────────────────────────────────────────────────────

export async function publishAssignment(
  assignmentId: string,
): Promise<Result<{ created: number }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const assignment = await gate.sdb.assignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, classId: true, status: true, class: { select: { centerId: true } } },
  });
  if (!assignment) return { ok: false, error: "Không tìm thấy bài tập" };
  // Loại B — chống IDOR publish bài tập của lớp cơ sở khác.
  if (!classCenterVisible(gate.actor, assignment.class)) {
    return { ok: false, error: "Không tìm thấy bài tập" };
  }
  if (assignment.status !== "DRAFT") {
    return {
      ok: false,
      error: `Chỉ DRAFT mới publish được (hiện: ${assignment.status})`,
    };
  }

  const enrollments = await gate.sdb.enrollment.findMany({
    where: {
      classId: assignment.classId,
      status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
    },
    select: { studentId: true },
  });
  if (enrollments.length === 0) {
    return {
      ok: false,
      error:
        "Lớp chưa có HS active (CONFIRMED/STUDYING/ACTIVE). Đăng ký HS vào lớp trước.",
    };
  }

  try {
    await gate.sdb.$transaction([
      gate.sdb.assignmentSubmission.createMany({
        data: enrollments.map((e) => ({
          assignmentId,
          studentId: e.studentId,
          status: "NOT_SUBMITTED" as const,
        })),
        skipDuplicates: true,
      }),
      gate.sdb.assignment.update({
        where: { id: assignmentId },
        data: { status: "PUBLISHED" },
      }),
    ]);
  } catch (err) {
    return {
      ok: false,
      error: `Publish thất bại: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/assignments");
  revalidatePath(`/assignments/${assignmentId}/edit`);
  return { ok: true, data: { created: enrollments.length } };
}

// ──────────────────────────────────────────────────────────────────────────
// Status change (DRAFT → PUBLISHED handled separately; this covers
// CLOSED / ARCHIVED transitions plus reopening to DRAFT if no submissions).
// ──────────────────────────────────────────────────────────────────────────

const ChangeStatusSchema = z.object({
  assignmentId: z.string().min(1),
  status: z.enum(["CLOSED", "ARCHIVED"]),
});

export async function changeAssignmentStatus(
  input: z.infer<typeof ChangeStatusSchema>,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = ChangeStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Tham số không hợp lệ" };

  // Loại B — chống IDOR đổi trạng thái bài tập của lớp cơ sở khác.
  if (!(await assignmentClassVisible(gate.sdb, gate.actor, parsed.data.assignmentId))) {
    return { ok: false, error: "Không tìm thấy bài tập" };
  }

  try {
    await gate.sdb.assignment.update({
      where: { id: parsed.data.assignmentId },
      data: { status: parsed.data.status },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/assignments");
  revalidatePath(`/assignments/${parsed.data.assignmentId}/edit`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Record submission (admin enters HS submission manually from Zalo/offline)
// ──────────────────────────────────────────────────────────────────────────

const RecordSubmissionSchema = z.object({
  submissionId: z.string().min(1),
  textAnswer: z.string().nullable().optional(),
  fileUrl: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  fileSize: z.coerce.number().int().nullable().optional(),
  mimeType: z.string().nullable().optional(),
});

export async function recordSubmission(
  input: z.infer<typeof RecordSubmissionSchema>,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = RecordSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const textAnswer = data.textAnswer?.trim() || null;
  const fileUrl = data.fileUrl?.trim() || null;
  if (!textAnswer && !fileUrl) {
    return { ok: false, error: "Cần ít nhất 1 trong textAnswer hoặc file" };
  }

  const submission = await gate.sdb.assignmentSubmission.findUnique({
    where: { id: data.submissionId },
    include: {
      assignment: { select: { dueAt: true, class: { select: { centerId: true } } } },
    },
  });
  if (!submission) return { ok: false, error: "Không tìm thấy submission" };
  // Loại B — chống IDOR ghi bài nộp cho lớp cơ sở khác.
  if (!classCenterVisible(gate.actor, submission.assignment.class)) {
    return { ok: false, error: "Không tìm thấy submission" };
  }

  const now = new Date();
  const isLate =
    submission.assignment.dueAt && now > submission.assignment.dueAt;

  try {
    await gate.sdb.assignmentSubmission.update({
      where: { id: data.submissionId },
      data: {
        textAnswer,
        fileUrl,
        fileName: data.fileName?.trim() || null,
        fileSize: data.fileSize ?? null,
        mimeType: data.mimeType?.trim() || null,
        submittedAt: now,
        status: isLate ? "LATE" : "SUBMITTED",
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath(`/assignments/${submission.assignmentId}/edit`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Grade submission
// ──────────────────────────────────────────────────────────────────────────

const GradeSchema = z.object({
  submissionId: z.string().min(1),
  score: z.coerce.number().min(0, "Điểm >= 0"),
  feedback: z.string().nullable().optional(),
});

export async function gradeSubmission(
  input: z.infer<typeof GradeSchema>,
): Promise<Result> {
  const gate = await requireRole("assignments:grade");
  if (!gate.ok) return gate;

  const parsed = GradeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const submission = await gate.sdb.assignmentSubmission.findUnique({
    where: { id: data.submissionId },
    include: {
      assignment: {
        select: {
          totalPoints: true,
          class: { select: { teacherId: true, assistantId: true, centerId: true } },
        },
      },
    },
  });
  if (!submission) return { ok: false, error: "Không tìm thấy submission" };
  // Loại B — lớp của bài phải trong tầm nhìn cơ sở actor (chặn review/training
  // cross-center của actor center-scope), sau đó mới xét quyền chấm.
  if (!classCenterVisible(gate.actor, submission.assignment.class)) {
    return { ok: false, error: "Không tìm thấy submission" };
  }
  if (!(await canGradeClassWork(gate.user, submission.assignment.class))) {
    return { ok: false, error: "Không có quyền chấm bài ngoài lớp phụ trách" };
  }
  if (submission.status === "NOT_SUBMITTED") {
    return { ok: false, error: "HS chưa nộp — không thể chấm" };
  }
  if (data.score > submission.assignment.totalPoints) {
    return {
      ok: false,
      error: `Điểm vượt totalPoints (${submission.assignment.totalPoints})`,
    };
  }

  const graderEmployeeId = await resolveEmployeeId(gate.sdb, gate.userId);

  try {
    await gate.sdb.assignmentSubmission.update({
      where: { id: data.submissionId },
      data: {
        score: data.score,
        feedback: data.feedback?.trim() || null,
        status: "GRADED",
        gradedAt: new Date(),
        gradedById: graderEmployeeId,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath(`/assignments/${submission.assignmentId}/edit`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// #14.4 — Bộ câu hỏi trong bài tập (Question gắn assignmentId)
// Lưu ý: schema Question CHỈ thêm `assignmentId` (không có cột points/order).
// Vì vậy points/order được nhận trong input để khớp hợp đồng nhưng KHÔNG lưu;
// thứ tự hiển thị dựa theo createdAt.
// ──────────────────────────────────────────────────────────────────────────

async function requireAssignmentEdit(): Promise<
  | { ok: true; userId: string; actor: Actor; sdb: Sdb }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("assignments:edit");
  } catch {
    return { ok: false, error: "Không có quyền chỉnh sửa bài tập" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, userId: session.user.id ?? "", actor, sdb: scopedDb(actor) };
}

// questionCode là @unique (nullable) — sinh mã riêng cho câu hỏi trong bài tập.
async function generateAssignmentQuestionCode(sdb: Sdb): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = `AQ-${Date.now().toString(36).toUpperCase()}${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
    const dup = await sdb.question.findUnique({
      where: { questionCode: code },
      select: { id: true },
    });
    if (!dup) return code;
  }
  return `AQ-${Date.now().toString(36).toUpperCase()}${Math.random()
    .toString(36)
    .slice(2, 10)
    .toUpperCase()}`;
}

const AQChoiceSchema = z.object({
  text: z.string().trim().min(1, "Nội dung lựa chọn không được trống"),
  isCorrect: z.coerce.boolean().default(false),
});

const AQBaseShape = {
  text: z.string().trim().min(1, "Nội dung câu hỏi bắt buộc"),
  type: QuestionTypeEnum,
  correctAnswer: z.union([z.string(), z.null()]).optional(),
  choices: z.array(AQChoiceSchema).default([]),
  // Nhận nhưng KHÔNG lưu (Question chưa có cột points/order).
  points: z.coerce.number().optional(),
  order: z.coerce.number().int().optional(),
};

function refineAQ(
  d: { type: string; choices: { isCorrect: boolean }[] },
  ctx: z.RefinementCtx,
) {
  if (d.type === "MULTIPLE_CHOICE") {
    if (d.choices.length < 2 || d.choices.length > 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices"],
        message: "Trắc nghiệm cần 2 đến 6 lựa chọn",
      });
    }
    if (!d.choices.some((c) => c.isCorrect)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices"],
        message: "Cần ít nhất 1 đáp án đúng",
      });
    }
  } else if (d.type === "TRUE_FALSE") {
    if (d.choices.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices"],
        message: "Đúng/Sai cần đúng 2 lựa chọn",
      });
    }
    if (d.choices.filter((c) => c.isCorrect).length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices"],
        message: "Đúng/Sai cần đúng 1 đáp án đúng",
      });
    }
  }
}

const AddAQSchema = z
  .object({ assignmentId: z.string().min(1), ...AQBaseShape })
  .superRefine(refineAQ);

const UpdateAQSchema = z.object(AQBaseShape).superRefine(refineAQ);

function buildChoices(
  type: string,
  choices: { text: string; isCorrect: boolean }[],
) {
  if (type !== "MULTIPLE_CHOICE" && type !== "TRUE_FALSE") return [];
  return choices.map((c, i) => ({
    order: i + 1,
    text: c.text,
    isCorrect: c.isCorrect,
  }));
}

export async function addAssignmentQuestion(
  input: z.infer<typeof AddAQSchema>,
): Promise<Result<{ questionId: string }>> {
  const gate = await requireAssignmentEdit();
  if (!gate.ok) return gate;

  const parsed = AddAQSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const assignment = await gate.sdb.assignment.findUnique({
    where: { id: data.assignmentId },
    select: { id: true, class: { select: { centerId: true } } },
  });
  if (!assignment) return { ok: false, error: "Không tìm thấy bài tập" };
  // Loại B — chống IDOR thêm câu hỏi vào bài tập của lớp cơ sở khác.
  if (!classCenterVisible(gate.actor, assignment.class)) {
    return { ok: false, error: "Không tìm thấy bài tập" };
  }

  const authorEmployeeId = await resolveEmployeeId(gate.sdb, gate.userId);
  const useChoices = data.type === "MULTIPLE_CHOICE" || data.type === "TRUE_FALSE";
  const choices = buildChoices(data.type, data.choices);
  const correctAnswer = useChoices ? null : data.correctAnswer?.trim() || null;

  try {
    const code = await generateAssignmentQuestionCode(gate.sdb);
    const q = await gate.sdb.$transaction(async (tx) => {
      const created = await tx.question.create({
        data: {
          questionCode: code,
          assignmentId: data.assignmentId,
          type: data.type,
          text: data.text,
          correctAnswer,
          authorId: authorEmployeeId,
          isPublic: false,
        },
        select: { id: true },
      });
      if (choices.length > 0) {
        await tx.choice.createMany({
          data: choices.map((c) => ({ questionId: created.id, ...c })),
        });
      }
      return created;
    });
    revalidatePath(`/assignments/${data.assignmentId}/edit`);
    return { ok: true, data: { questionId: q.id } };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

export async function updateAssignmentQuestion(
  id: string,
  input: z.infer<typeof UpdateAQSchema>,
): Promise<Result> {
  const gate = await requireAssignmentEdit();
  if (!gate.ok) return gate;

  const parsed = UpdateAQSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const current = await gate.sdb.question.findUnique({
    where: { id },
    select: {
      assignmentId: true,
      assignment: { select: { class: { select: { centerId: true } } } },
    },
  });
  if (!current) return { ok: false, error: "Không tìm thấy câu hỏi" };
  if (!current.assignmentId) {
    return { ok: false, error: "Câu hỏi này không thuộc bài tập nào" };
  }
  // Loại B — chống IDOR sửa câu hỏi thuộc bài tập của lớp cơ sở khác.
  if (!classCenterVisible(gate.actor, current.assignment?.class ?? null)) {
    return { ok: false, error: "Không tìm thấy câu hỏi" };
  }

  const useChoices = data.type === "MULTIPLE_CHOICE" || data.type === "TRUE_FALSE";
  const choices = buildChoices(data.type, data.choices);
  const correctAnswer = useChoices ? null : data.correctAnswer?.trim() || null;

  try {
    await gate.sdb.$transaction(async (tx) => {
      await tx.choice.deleteMany({ where: { questionId: id } });
      await tx.question.update({
        where: { id },
        data: {
          type: data.type,
          text: data.text,
          correctAnswer,
        },
      });
      if (choices.length > 0) {
        await tx.choice.createMany({
          data: choices.map((c) => ({ questionId: id, ...c })),
        });
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath(`/assignments/${current.assignmentId}/edit`);
  return { ok: true };
}

export async function deleteAssignmentQuestion(id: string): Promise<Result> {
  const gate = await requireAssignmentEdit();
  if (!gate.ok) return gate;

  const current = await gate.sdb.question.findUnique({
    where: { id },
    select: {
      assignmentId: true,
      assignment: { select: { class: { select: { centerId: true } } } },
    },
  });
  if (!current) return { ok: false, error: "Không tìm thấy câu hỏi" };
  // Loại B — câu hỏi gắn bài tập: lớp của bài phải trong tầm nhìn actor.
  if (
    current.assignmentId &&
    !classCenterVisible(gate.actor, current.assignment?.class ?? null)
  ) {
    return { ok: false, error: "Không tìm thấy câu hỏi" };
  }

  try {
    // Choice cascades via onDelete: Cascade.
    await gate.sdb.question.delete({ where: { id } });
  } catch (err) {
    return {
      ok: false,
      error: `Không xoá được: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  if (current.assignmentId) {
    revalidatePath(`/assignments/${current.assignmentId}/edit`);
  }
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Cụm C3 — Chấm bài theo rubric robotics (6 tiêu chí, nhận xét BẮT BUỘC)
// ──────────────────────────────────────────────────────────────────────────

const RubricGradeSchema = z.object({
  submissionId: z.string().min(1),
  scores: z
    .array(
      z.object({
        criterion: z.enum(RUBRIC_CRITERION_KEYS as [string, ...string[]]),
        level: z.enum(RUBRIC_LEVEL_KEYS as [string, ...string[]]),
      }),
    )
    .length(RUBRIC_CRITERION_KEYS.length, "Phải chấm đủ 6 tiêu chí"),
  feedback: z.string().trim().min(5, "Nhận xét là bắt buộc (tối thiểu 5 ký tự)"),
  sendEmail: z.boolean().optional(),
});

export async function gradeSubmissionRubric(
  input: z.infer<typeof RubricGradeSchema>,
): Promise<Result> {
  const gate = await requireRole("assignments:grade");
  if (!gate.ok) return gate;

  const parsed = RubricGradeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  // Mỗi tiêu chí chỉ chấm 1 lần.
  const seen = new Set(data.scores.map((s) => s.criterion));
  if (seen.size !== RUBRIC_CRITERION_KEYS.length) {
    return { ok: false, error: "Tiêu chí bị trùng hoặc thiếu" };
  }

  const submission = await gate.sdb.assignmentSubmission.findUnique({
    where: { id: data.submissionId },
    include: {
      assignment: {
        select: {
          title: true,
          class: { select: { teacherId: true, assistantId: true, centerId: true } },
        },
      },
      student: { select: { name: true, parentUser: { select: { email: true, name: true } } } },
    },
  });
  if (!submission) return { ok: false, error: "Không tìm thấy submission" };
  // Loại B — lớp của bài phải trong tầm nhìn cơ sở actor trước khi xét quyền chấm.
  if (!classCenterVisible(gate.actor, submission.assignment.class)) {
    return { ok: false, error: "Không tìm thấy submission" };
  }
  if (!(await canGradeClassWork(gate.user, submission.assignment.class))) {
    return { ok: false, error: "Không có quyền chấm bài ngoài lớp phụ trách" };
  }
  if (submission.status === "NOT_SUBMITTED") {
    return { ok: false, error: "HS chưa nộp — không thể chấm" };
  }

  const score = rubricToScore(
    data.scores.map((s) => ({ criterion: s.criterion as RubricCriterion, level: s.level as RubricLevel })),
  );
  const graderEmployeeId = await resolveEmployeeId(gate.sdb, gate.userId);

  try {
    await gate.sdb.$transaction(async (tx) => {
      await tx.submissionRubricScore.deleteMany({ where: { submissionId: data.submissionId } });
      await tx.submissionRubricScore.createMany({
        data: data.scores.map((s) => ({
          submissionId: data.submissionId,
          criterion: s.criterion as RubricCriterion,
          level: s.level as RubricLevel,
        })),
      });
      await tx.assignmentSubmission.update({
        where: { id: data.submissionId },
        data: {
          score: score ?? undefined,
          feedback: data.feedback,
          status: "GRADED",
          gradedAt: new Date(),
          gradedById: graderEmployeeId,
        },
      });
    });
  } catch (err) {
    return { ok: false, error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}` };
  }

  // Email tuỳ chọn cho phụ huynh (A2 — chỉ enqueue, không gửi ngay).
  if (data.sendEmail && submission.student.parentUser?.email) {
    await enqueueEmail({
      to: submission.student.parentUser.email,
      toName: submission.student.parentUser.name ?? undefined,
      // B1.5: template DB (admin sửa) — inline dưới là fallback.
      templateKey: "RUBRIC_GRADED",
      vars: {
        parentName: submission.student.parentUser.name ?? "quý phụ huynh",
        studentName: submission.student.name,
        assignmentTitle: submission.assignment.title,
        scoreText: String(score ?? "—"),
        feedback: data.feedback,
      },
      subject: `Kết quả chấm bài: ${submission.assignment.title} — ${submission.student.name}`,
      bodyText: `Bài "${submission.assignment.title}" của bé ${submission.student.name} đã được chấm.\nĐiểm: ${score ?? "—"}/10.\nNhận xét: ${data.feedback}\nXem chi tiết rubric tại cổng học viên.`,
      context: { type: "RUBRIC_GRADED", id: data.submissionId },
    }).catch(() => {});
  }

  revalidatePath(`/assignments/${submission.assignmentId}/edit`);
  return { ok: true };
}
