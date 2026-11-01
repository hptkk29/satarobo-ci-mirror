"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { getEffectiveRoles } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { canManageSessionClass } from "@/app/(admin)/admin/sessions/[id]/_actions";
import { writeAudit } from "@/lib/audit/audit-log";
import { z } from "zod";
import {
  examSchema,
  ExamStatusEnum,
  type ExamInput,
} from "@/lib/validators/exam";
import {
  QuestionTypeEnum,
  QuestionDifficultyEnum,
} from "@/lib/validators/question";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type Sdb = ReturnType<typeof scopedDb>;

type SessionUser = {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  roles?: string[] | null;
  centerId?: string | null;
  grants?: { action: string; grant: "ALLOW" | "DENY" }[];
};

// LMS-2 / W1-2 — gate phân quyền CHẤM ĐIỂM: GV chỉ chấm bài thi của lớp mình
// dạy/trợ giảng (tái dùng canManageSessionClass: teacherId|assistantId == me);
// Đào tạo/Admin có quyền report-cards:review | training:manage chấm mọi lớp.
// Đề không gắn lớp (exam bank, classId null) → chỉ Đào tạo/Admin.
async function canGradeClassWork(
  user: SessionUser,
  cls: { teacherId: string | null; assistantId: string | null; centerId: string | null } | null,
): Promise<boolean> {
  if (
    cls &&
    (await canManageSessionClass(
      { id: user.id ?? "", role: user.role ?? "", centerId: user.centerId ?? null },
      cls,
    ))
  ) {
    return true;
  }
  return (
    (await checkPermission("report-cards:review")) ||
    (await checkPermission("training:manage"))
  );
}

async function requireRole(): Promise<
  | { ok: true; userId: string; user: SessionUser; actor: Actor; sdb: Sdb }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("exams:edit"))) {
    return { ok: false, error: "Không có quyền quản lý đề thi" };
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

// Loại B (Nhóm 01 L1) — Exam/ExamQuestion/ExamAttempt/ExamAnswer KHÔNG ∈
// SCOPED_MODELS → scopedDb pass-through. Cách ly tay qua lớp gắn đề. Đề NGÂN
// HÀNG (classId null) là nội dung dùng chung 2 cơ sở (câu 74a) → không chặn
// theo cơ sở, gate quyền riêng lo.
// Vá 24/07 — GHI/CHẤM đối xứng ĐỌC: scope per-model qua passesScope("Class"),
// role HO chỉ cross-center khi CÓ quyền classes:* scope ALL (Toại TRAINING@HO
// hết sửa đề/chấm lượt thi lớp CS2). KHÔNG dùng cờ isHoLevel trần.
function classCenterVisible(
  actor: Actor,
  cls: { centerId: string | null } | null | undefined,
): boolean {
  if (!cls) return true; // đề không gắn lớp — exam bank toàn cục (content chủ đích)
  return passesScope("Class", cls, actor);
}

/** Loại B — đề thi theo id từ client: lớp gắn đề (nếu có) phải trong tầm nhìn actor. */
async function examClassVisible(sdb: Sdb, actor: Actor, examId: string): Promise<boolean> {
  const e = await sdb.exam.findUnique({
    where: { id: examId },
    select: { class: { select: { centerId: true } } },
  });
  return !!e && classCenterVisible(actor, e.class);
}

// R7-13 AC1/AC4 — chỉ Đào tạo/Admin (CENTER_MANAGER/SUPER_ADMIN) được sửa đề đã PUBLISHED.
// GV (TEACHER) soạn DRAFT bình thường nhưng KHÔNG sửa/đổi trạng thái đề đã publish (T4).
function canEditPublished(user: SessionUser): boolean {
  const roles = getEffectiveRoles(user);
  return roles.includes("SUPER_ADMIN") || roles.includes("CENTER_MANAGER");
}

// R7-13 PR1 — cấu hình bổ sung của Exam. KHÔNG sửa lib/validators/exam.ts (ngoài
// phạm vi sở hữu ticket) → parse riêng ở đây rồi merge vào data ghi DB.
const SCORING_MODES = ["HIGHEST", "LATEST", "AVERAGE", "FIRST"] as const;
const nullableInt = (min: number) =>
  z.preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.coerce.number().int().min(min).nullable(),
  );

const examConfigExtraSchema = z.object({
  maxAttempts: nullableInt(1).optional().transform((v) => v ?? null),
  defaultDueDays: nullableInt(0).optional().transform((v) => v ?? null),
  scoringMode: z
    .preprocess(
      (v) => (v === "" || v == null ? null : v),
      z.enum(SCORING_MODES).nullable(),
    )
    .optional()
    .transform((v) => v ?? null),
  showResultAfterSubmit: z.coerce.boolean().optional(),
});

type ExamConfigExtra = {
  maxAttempts: number | null;
  defaultDueDays: number | null;
  scoringMode: (typeof SCORING_MODES)[number] | null;
  showResultAfterSubmit?: boolean;
};

function parseConfigExtra(input: unknown): ExamConfigExtra {
  const r = examConfigExtraSchema.safeParse(input ?? {});
  if (!r.success) {
    return { maxAttempts: null, defaultDueDays: null, scoringMode: null };
  }
  const out: ExamConfigExtra = {
    maxAttempts: r.data.maxAttempts,
    defaultDueDays: r.data.defaultDueDays,
    scoringMode: r.data.scoringMode,
  };
  if (r.data.showResultAfterSubmit !== undefined) {
    out.showResultAfterSubmit = r.data.showResultAfterSubmit;
  }
  return out;
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
// Exam CRUD
// ──────────────────────────────────────────────────────────────────────────

export async function createExam(
  input: ExamInput,
): Promise<Result<{ examId: string }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = examSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  if (data.examCode) {
    const dup = await gate.sdb.exam.findUnique({
      where: { examCode: data.examCode },
      select: { id: true },
    });
    if (dup) return { ok: false, error: `Mã đề "${data.examCode}" đã tồn tại` };
  }

  // Loại B — nếu đề gắn lớp: lớp phải trong tầm nhìn actor (sdb.class auto-scope).
  if (data.classId) {
    const cls = await gate.sdb.class.findUnique({
      where: { id: data.classId },
      select: { centerId: true },
    });
    if (!cls || !classCenterVisible(gate.actor, cls)) {
      return { ok: false, error: "Lớp không tồn tại hoặc ngoài phạm vi cơ sở" };
    }
  }

  const createdById = await resolveEmployeeId(gate.sdb, gate.userId);
  const config = parseConfigExtra(input);

  try {
    const e = await gate.sdb.exam.create({
      data: { ...data, ...config, createdById },
      select: { id: true },
    });
    await writeAudit({
      actor: { id: gate.user.id ?? null, name: gate.user.name ?? "?" },
      module: "exams",
      entityType: "Exam",
      entityId: e.id,
      action: "CREATE",
      newValues: { ...data, ...config },
    });
    revalidatePath("/exams");
    return { ok: true, data: { examId: e.id } };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

export async function createExamAndRedirect(input: ExamInput) {
  const res = await createExam(input);
  if (!res.ok) return res;
  redirect(`/exams/${res.data!.examId}/builder`);
}

export async function updateExam(
  id: string,
  input: ExamInput,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = examSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const current = await gate.sdb.exam.findUnique({
    where: { id },
    select: { examCode: true, status: true, class: { select: { centerId: true } } },
  });
  if (!current) return { ok: false, error: "Đề thi không tồn tại" };

  // Loại B — đề gắn lớp cơ sở khác → chặn (chống IDOR sửa chéo cơ sở).
  if (!classCenterVisible(gate.actor, current.class)) {
    return { ok: false, error: "Đề thi không tồn tại" };
  }
  // Đổi lớp gắn đề → lớp đích cũng phải trong tầm nhìn actor.
  if (data.classId) {
    const targetCls = await gate.sdb.class.findUnique({
      where: { id: data.classId },
      select: { centerId: true },
    });
    if (!targetCls || !classCenterVisible(gate.actor, targetCls)) {
      return { ok: false, error: "Lớp không tồn tại hoặc ngoài phạm vi cơ sở" };
    }
  }

  // Published-edit guard (AC1/T4): GV không sửa đề đã publish.
  if (current.status === "PUBLISHED" && !canEditPublished(gate.user)) {
    return {
      ok: false,
      error: "Đề đã publish — chỉ Đào tạo/Admin được sửa.",
    };
  }
  // GV cũng không được tự publish (chỉ Đào tạo/Admin chuyển sang PUBLISHED).
  if (
    data.status === "PUBLISHED" &&
    current.status !== "PUBLISHED" &&
    !canEditPublished(gate.user)
  ) {
    return {
      ok: false,
      error: "Chỉ Đào tạo/Admin được publish đề.",
    };
  }

  if (data.examCode && data.examCode !== current.examCode) {
    const dup = await gate.sdb.exam.findUnique({
      where: { examCode: data.examCode },
      select: { id: true },
    });
    if (dup && dup.id !== id) {
      return { ok: false, error: `Mã đề "${data.examCode}" đã tồn tại` };
    }
  }

  const config = parseConfigExtra(input);
  try {
    await gate.sdb.exam.update({ where: { id }, data: { ...data, ...config } });
    await writeAudit({
      actor: { id: gate.user.id ?? null, name: gate.user.name ?? "?" },
      module: "exams",
      entityType: "Exam",
      entityId: id,
      action: "UPDATE",
      newValues: { ...data, ...config },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath("/exams");
  revalidatePath(`/exams/${id}/builder`);
  return { ok: true };
}

export async function deleteExam(id: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  // Loại B — chống IDOR xoá đề của lớp cơ sở khác.
  if (!(await examClassVisible(gate.sdb, gate.actor, id))) {
    return { ok: false, error: "Đề thi không tồn tại" };
  }

  const attempts = await gate.sdb.examAttempt.count({ where: { examId: id } });
  if (attempts > 0) {
    return {
      ok: false,
      error: `Đề thi có ${attempts} lần làm bài — không thể xoá. Đổi sang ARCHIVED thay vì xoá.`,
    };
  }

  try {
    await gate.sdb.exam.delete({ where: { id } });
  } catch (err) {
    return {
      ok: false,
      error: `Không xoá được: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/exams");
  return { ok: true };
}

export async function deleteExamAndRedirect(id: string): Promise<Result> {
  const res = await deleteExam(id);
  if (!res.ok) return res;
  redirect("/exams");
}

// ──────────────────────────────────────────────────────────────────────────
// ExamQuestion management
// ──────────────────────────────────────────────────────────────────────────

const AddQuestionSchema = z.object({
  examId: z.string().min(1),
  questionId: z.string().min(1),
  points: z.coerce.number().min(0).default(1),
});

export async function addQuestionToExam(
  input: z.infer<typeof AddQuestionSchema>,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = AddQuestionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { examId, questionId, points } = parsed.data;

  // Loại B — chống IDOR thêm câu hỏi vào đề của lớp cơ sở khác.
  if (!(await examClassVisible(gate.sdb, gate.actor, examId))) {
    return { ok: false, error: "Đề thi không tồn tại" };
  }

  const existing = await gate.sdb.examQuestion.findUnique({
    where: { examId_questionId: { examId, questionId } },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "Câu hỏi đã có trong đề" };

  try {
    const count = await gate.sdb.examQuestion.count({ where: { examId } });
    await gate.sdb.examQuestion.create({
      data: { examId, questionId, order: count + 1, points },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath(`/exams/${examId}/builder`);
  return { ok: true };
}

export async function removeQuestionFromExam(
  examQuestionId: string,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const eq = await gate.sdb.examQuestion.findUnique({
    where: { id: examQuestionId },
    select: { examId: true, order: true },
  });
  if (!eq) return { ok: false, error: "Không tìm thấy bản ghi" };

  // Loại B — chống IDOR gỡ câu hỏi khỏi đề của lớp cơ sở khác.
  if (!(await examClassVisible(gate.sdb, gate.actor, eq.examId))) {
    return { ok: false, error: "Không tìm thấy bản ghi" };
  }

  try {
    await gate.sdb.$transaction(async (tx) => {
      await tx.examQuestion.delete({ where: { id: examQuestionId } });
      // Renumber: bring higher orders down by 1 to keep dense sequence
      const higher = await tx.examQuestion.findMany({
        where: { examId: eq.examId, order: { gt: eq.order } },
        orderBy: { order: "asc" },
        select: { id: true, order: true },
      });
      // 2-pass to dodge the unique (examId, order) constraint
      for (let i = 0; i < higher.length; i++) {
        await tx.examQuestion.update({
          where: { id: higher[i].id },
          data: { order: -(higher[i].order) },
        });
      }
      for (let i = 0; i < higher.length; i++) {
        await tx.examQuestion.update({
          where: { id: higher[i].id },
          data: { order: higher[i].order - 1 },
        });
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath(`/exams/${eq.examId}/builder`);
  return { ok: true };
}

export async function updateExamQuestionPoints(
  examQuestionId: string,
  points: number,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;
  if (!Number.isFinite(points) || points < 0) {
    return { ok: false, error: "Điểm phải >= 0" };
  }

  // Loại B — chống IDOR sửa điểm câu hỏi của đề lớp cơ sở khác.
  const cur = await gate.sdb.examQuestion.findUnique({
    where: { id: examQuestionId },
    select: { examId: true },
  });
  if (!cur || !(await examClassVisible(gate.sdb, gate.actor, cur.examId))) {
    return { ok: false, error: "Không tìm thấy bản ghi" };
  }

  try {
    const eq = await gate.sdb.examQuestion.update({
      where: { id: examQuestionId },
      data: { points },
      select: { examId: true },
    });
    revalidatePath(`/exams/${eq.examId}/builder`);
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  return { ok: true };
}

// Reorder questions inside an exam (2-pass to avoid unique conflict).
export async function reorderExamQuestions({
  examId,
  examQuestionIds,
}: {
  examId: string;
  examQuestionIds: string[];
}): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  if (!Array.isArray(examQuestionIds) || examQuestionIds.length === 0) {
    return { ok: false, error: "Danh sách rỗng" };
  }

  // Loại B — chống IDOR sắp xếp câu hỏi của đề lớp cơ sở khác.
  if (!(await examClassVisible(gate.sdb, gate.actor, examId))) {
    return { ok: false, error: "Đề thi không tồn tại" };
  }

  const found = await gate.sdb.examQuestion.findMany({
    where: { id: { in: examQuestionIds }, examId },
    select: { id: true },
  });
  if (found.length !== examQuestionIds.length) {
    return { ok: false, error: "Có câu hỏi không thuộc đề thi này" };
  }

  try {
    await gate.sdb.$transaction(async (tx) => {
      for (let i = 0; i < examQuestionIds.length; i++) {
        await tx.examQuestion.update({
          where: { id: examQuestionIds[i] },
          data: { order: -(i + 1) },
        });
      }
      for (let i = 0; i < examQuestionIds.length; i++) {
        await tx.examQuestion.update({
          where: { id: examQuestionIds[i] },
          data: { order: i + 1 },
        });
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: `Reorder thất bại: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath(`/exams/${examId}/builder`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Auto-generate exam questions from filter (random over-fetch + shuffle)
// ──────────────────────────────────────────────────────────────────────────

const AutoGenSchema = z.object({
  examId: z.string().min(1),
  lessonId: z.string().nullable().optional(),
  type: QuestionTypeEnum.nullable().optional(),
  difficulty: QuestionDifficultyEnum.nullable().optional(),
  tags: z.array(z.string()).default([]),
  count: z.coerce.number().int().min(1).max(100),
  defaultPoints: z.coerce.number().min(0).default(1),
});

export async function autoGenerateExamQuestions(
  input: z.infer<typeof AutoGenSchema>,
): Promise<Result<{ added: number }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = AutoGenSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { examId, count, defaultPoints } = parsed.data;

  // Loại B — chống IDOR sinh câu hỏi cho đề của lớp cơ sở khác.
  if (!(await examClassVisible(gate.sdb, gate.actor, examId))) {
    return { ok: false, error: "Đề thi không tồn tại" };
  }

  const existing = await gate.sdb.examQuestion.findMany({
    where: { examId },
    select: { questionId: true },
  });
  const existingIds = existing.map((e) => e.questionId);

  const where: Record<string, unknown> = { isPublic: true };
  if (parsed.data.lessonId) where.lessonId = parsed.data.lessonId;
  if (parsed.data.type) where.type = parsed.data.type;
  if (parsed.data.difficulty) where.difficulty = parsed.data.difficulty;
  if (parsed.data.tags.length > 0) where.tags = { hasSome: parsed.data.tags };
  if (existingIds.length > 0) where.id = { notIn: existingIds };

  const candidates = await gate.sdb.question.findMany({
    where,
    select: { id: true },
    take: count * 3,
  });

  if (candidates.length === 0) {
    return { ok: false, error: "Không có câu hỏi nào khớp filter" };
  }

  // Fisher-Yates shuffle
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picked = shuffled.slice(0, count);

  const startOrder = existing.length;
  try {
    await gate.sdb.examQuestion.createMany({
      data: picked.map((q, idx) => ({
        examId,
        questionId: q.id,
        order: startOrder + idx + 1,
        points: defaultPoints,
      })),
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath(`/exams/${examId}/builder`);
  return { ok: true, data: { added: picked.length } };
}

// ──────────────────────────────────────────────────────────────────────────
// Grade attempt
// ──────────────────────────────────────────────────────────────────────────

export async function gradeAttempt(attemptId: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const attempt = await gate.sdb.examAttempt.findUnique({
    where: { id: attemptId },
    include: {
      answers: {
        include: {
          examQuestion: {
            include: {
              question: { include: { choices: true } },
            },
          },
        },
      },
      exam: {
        select: {
          id: true,
          passingScore: true,
          class: { select: { teacherId: true, assistantId: true, centerId: true } },
        },
      },
    },
  });
  if (!attempt) return { ok: false, error: "Không tìm thấy bài làm" };
  // Loại B — lớp gắn đề phải trong tầm nhìn cơ sở actor trước khi xét quyền chấm.
  if (!classCenterVisible(gate.actor, attempt.exam.class)) {
    return { ok: false, error: "Không tìm thấy bài làm" };
  }
  if (!(await canGradeClassWork(gate.user, attempt.exam.class))) {
    return { ok: false, error: "Không có quyền chấm bài ngoài lớp phụ trách" };
  }
  if (attempt.status === "IN_PROGRESS") {
    return { ok: false, error: "Bài làm chưa được nộp (IN_PROGRESS)" };
  }

  const graderEmployeeId = await resolveEmployeeId(gate.sdb, gate.userId);

  let totalScore = 0;
  try {
    await gate.sdb.$transaction(async (tx) => {
      for (const ans of attempt.answers) {
        const q = ans.examQuestion.question;
        let isCorrect: boolean | null = ans.isCorrect;
        let score: number = ans.score ?? 0;

        if (q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE") {
          const correctIds = q.choices
            .filter((c) => c.isCorrect)
            .map((c) => c.id)
            .sort();
          const selectedIds = [...ans.selectedChoiceIds].sort();
          isCorrect =
            correctIds.length > 0 &&
            correctIds.length === selectedIds.length &&
            correctIds.every((id, i) => id === selectedIds[i]);
          score = isCorrect ? ans.examQuestion.points : 0;
        } else if (q.type === "SHORT_ANSWER") {
          const correct = (q.correctAnswer ?? "").trim().toLowerCase();
          const submitted = (ans.textAnswer ?? "").trim().toLowerCase();
          isCorrect = correct.length > 0 && correct === submitted;
          score = isCorrect ? ans.examQuestion.points : 0;
        }
        // ESSAY / CODE: keep existing isCorrect + score (manual grading)

        await tx.examAnswer.update({
          where: { id: ans.id },
          data: { isCorrect, score },
        });
        totalScore += score;
      }

      await tx.examAttempt.update({
        where: { id: attemptId },
        data: {
          status: "GRADED",
          totalScore,
          passed: totalScore >= attempt.exam.passingScore,
          gradedAt: new Date(),
          gradedById: graderEmployeeId,
        },
      });
    });
  } catch (err) {
    return {
      ok: false,
      error: `Chấm bài thất bại: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath("/exams");
  revalidatePath(`/exams/${attempt.exam.id}/attempts`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Manual grade for a single answer (ESSAY / CODE / override auto-grade)
// ──────────────────────────────────────────────────────────────────────────

const ManualGradeSchema = z.object({
  examAnswerId: z.string().min(1),
  isCorrect: z.boolean().nullable(),
  score: z.coerce.number().min(0),
  graderNote: z.string().nullable().optional(),
});

export async function manualGradeAnswer(
  input: z.infer<typeof ManualGradeSchema>,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = ManualGradeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const ans = await gate.sdb.examAnswer.findUnique({
    where: { id: parsed.data.examAnswerId },
    select: {
      examQuestion: { select: { points: true } },
      attemptId: true,
      attempt: {
        select: {
          exam: {
            select: { class: { select: { teacherId: true, assistantId: true, centerId: true } } },
          },
        },
      },
    },
  });
  if (!ans) return { ok: false, error: "Không tìm thấy bài trả lời" };
  // Loại B — lớp gắn đề phải trong tầm nhìn cơ sở actor trước khi xét quyền chấm.
  if (!classCenterVisible(gate.actor, ans.attempt.exam.class)) {
    return { ok: false, error: "Không tìm thấy bài trả lời" };
  }
  if (!(await canGradeClassWork(gate.user, ans.attempt.exam.class))) {
    return { ok: false, error: "Không có quyền chấm bài ngoài lớp phụ trách" };
  }
  if (parsed.data.score > ans.examQuestion.points) {
    return {
      ok: false,
      error: `Điểm vượt quá điểm tối đa của câu (${ans.examQuestion.points})`,
    };
  }

  try {
    await gate.sdb.examAnswer.update({
      where: { id: parsed.data.examAnswerId },
      data: {
        isCorrect: parsed.data.isCorrect,
        score: parsed.data.score,
        graderNote: parsed.data.graderNote?.trim() || null,
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  // Caller is expected to recompute totals via gradeAttempt or refresh.
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Quick status change (DRAFT → PUBLISHED → CLOSED → ARCHIVED)
// ──────────────────────────────────────────────────────────────────────────

const ChangeStatusSchema = z.object({
  examId: z.string().min(1),
  status: ExamStatusEnum,
});

export async function changeExamStatus(
  input: z.infer<typeof ChangeStatusSchema>,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = ChangeStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  // T4 — GV không publish / sửa trạng thái đề đã publish.
  const cur = await gate.sdb.exam.findUnique({
    where: { id: parsed.data.examId },
    select: { status: true, class: { select: { centerId: true } } },
  });
  if (!cur) return { ok: false, error: "Đề thi không tồn tại" };
  // Loại B — chống IDOR đổi trạng thái đề của lớp cơ sở khác.
  if (!classCenterVisible(gate.actor, cur.class)) {
    return { ok: false, error: "Đề thi không tồn tại" };
  }
  const touchesPublished =
    parsed.data.status === "PUBLISHED" || cur.status === "PUBLISHED";
  if (touchesPublished && !canEditPublished(gate.user)) {
    return { ok: false, error: "Chỉ Đào tạo/Admin được publish/đổi trạng thái đề đã publish." };
  }

  try {
    await gate.sdb.exam.update({
      where: { id: parsed.data.examId },
      data: { status: parsed.data.status },
    });
    await writeAudit({
      actor: { id: gate.user.id ?? null, name: gate.user.name ?? "?" },
      module: "exams",
      entityType: "Exam",
      entityId: parsed.data.examId,
      action: "UPDATE",
      newValues: { status: parsed.data.status },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/exams");
  revalidatePath(`/exams/${parsed.data.examId}/builder`);
  return { ok: true };
}
