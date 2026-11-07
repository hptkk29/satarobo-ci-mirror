// lib/lms/assignment.ts — R3-08: bài tập/quiz (6 loại nội dung + nộp LATE).
// R7-14: + auto-giao bài (HomeworkAssignment) khi buổi "Hoàn tất" theo exam gắn lesson.
// FL-R2 W5 (R2-LMS-4): + tự sinh Assignment từ AssignmentTemplate khi tạo lớp.
import type {
  AssignmentSubmission,
  Prisma,
  SubmissionStatus,
  QuestionType,
  QuestionDifficulty,
} from "@prisma/client";
import { db } from "@/lib/db";

/** C8.1 — 6 loại nội dung bài tập (registry; model dùng text/file + kind CLASSWORK/HOMEWORK). */
export const ASSIGNMENT_CONTENT_TYPES = ["IMAGE", "VIDEO", "FILE", "QUIZ", "TEXT", "PROJECT"] as const;
export type AssignmentContentType = (typeof ASSIGNMENT_CONTENT_TYPES)[number];

export function isValidContentType(t: string): t is AssignmentContentType {
  return (ASSIGNMENT_CONTENT_TYPES as readonly string[]).includes(t);
}

/** C8.3 — nộp trễ nếu vượt hạn. THUẦN. (Không hạn → không bao giờ trễ.) */
export function isLateSubmission(dueAt: Date | null | undefined, submittedAt: Date): boolean {
  return dueAt != null && submittedAt > dueAt;
}

/** Nộp bài (text/file) → LATE nếu quá hạn, ngược lại SUBMITTED. Idempotent theo (bài, HS). */
export async function submitAssignment(input: {
  assignmentId: string;
  studentId: string;
  textAnswer?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  now?: Date;
}): Promise<AssignmentSubmission> {
  const now = input.now ?? new Date();
  const assignment = await db.assignment.findUnique({
    where: { id: input.assignmentId },
    select: { dueAt: true },
  });
  const status: SubmissionStatus = isLateSubmission(assignment?.dueAt, now) ? "LATE" : "SUBMITTED";

  const existing = await db.assignmentSubmission.findFirst({
    where: { assignmentId: input.assignmentId, studentId: input.studentId },
  });
  const data = {
    textAnswer: input.textAnswer ?? null,
    fileUrl: input.fileUrl ?? null,
    fileName: input.fileName ?? null,
    submittedAt: now,
    status,
  };
  return existing
    ? db.assignmentSubmission.update({ where: { id: existing.id }, data })
    : db.assignmentSubmission.create({ data: { assignmentId: input.assignmentId, studentId: input.studentId, ...data } });
}

// ════════════════════════════════════════════════════════════════════════════
// R7-14 — Auto-giao bài (HomeworkAssignment) khi GV "Hoàn tất buổi".
//
// Nguồn bài = Exam PUBLISHED gắn Lesson của buổi (ClassSession.lessonId hoặc
// ClassSessionPlan.lessonId — R7-06). Giao cho mọi HV ĐANG HỌC (KHÔNG gồm PAUSED)
// tại thời điểm buổi hoàn tất → HV vào lớp SAU không bị back-assign (edge §6).
// IDEMPOTENT qua unique (classSessionId, examId, studentId) + createMany
// skipDuplicates → replay event / bấm 2 lần không giao trùng (AC2).
// ════════════════════════════════════════════════════════════════════════════

export type AssignMode = "NOW" | "DEFER" | "CUSTOM_DUE";

// HV "đang học" cho mục đích giao bài: KHÔNG gồm PAUSED (bảo lưu → không nhận bài mới).
const HOMEWORK_ACTIVE_STATUS = ["CONFIRMED", "STUDYING", "ACTIVE"] as const;

/** THUẦN — hạn nộp theo mode: CUSTOM_DUE dùng hạn chọn; NOW = hôm nay + defaultDueDays. */
export function computeHomeworkDueAt(opts: {
  assignMode: AssignMode;
  now: Date;
  defaultDueDays: number | null;
  customDueAt?: Date | null;
}): Date | null {
  if (opts.assignMode === "CUSTOM_DUE") return opts.customDueAt ?? null;
  if (opts.defaultDueDays == null) return null; // exam không cấu hình hạn → không hạn
  const d = new Date(opts.now);
  d.setDate(d.getDate() + opts.defaultDueDays);
  return d;
}

export type AssignHomeworkResult = {
  created: number;
  examCount: number;
  studentCount: number;
  /** true = không giao gì (DEFER / không có exam / không HV active). */
  skipped: boolean;
};

/**
 * Giao bài cho 1 buổi đã dạy. Dùng chung cho handler `session.taught` (NOW/CUSTOM_DUE)
 * và nút "Giao bài" thủ công khi GV chọn DEFER. Idempotent + tự notify PH (dedupeKey).
 */
export async function assignHomeworkForSession(opts: {
  sessionId: string;
  /**
   * ⚠️ BẮT BUỘC — cố ý KHÔNG có mặc định.
   *
   * Trước 08/09/2026 đây là `assignMode?` với `?? "NOW"`. Mà `NOW` nghĩa là **giao bài
   * NGAY và bắn thông báo cho phụ huynh NGAY**. Một mặc định như thế ở tham số tuỳ chọn
   * là: người viết call site mới quên một dòng ⇒ tin nhắn bay tới phụ huynh, không lỗi,
   * không cảnh báo.
   *
   * Bỏ mặc định để `tsc` liệt kê từng call site và bắt mỗi nơi tự nói ý định. Đây là
   * luật đã ghi ở `docs/luat-doc-so-va-ket-luan.md`: *tham số có mặc định NGUY HIỂM
   * (gửi tin · ghi tiền · giao bài · xoá · mở rộng phạm vi nhìn) thì bỏ mặc định — để
   * trình biên dịch đếm hộ, vì mắt thấy 2 chỗ mà `tsc` thấy 6.*
   *
   * `DEFER` = chưa giao, chờ giáo viên bấm.
   */
  assignMode: AssignMode;
  customDueAt?: Date | null;
  assignedById?: string | null;
  now?: Date;
}): Promise<AssignHomeworkResult> {
  const assignMode: AssignMode = opts.assignMode;
  const now = opts.now ?? new Date();
  const empty: AssignHomeworkResult = { created: 0, examCount: 0, studentCount: 0, skipped: true };

  // DEFER → chưa giao; chờ GV bấm "Giao bài" (gọi lại hàm này với NOW/CUSTOM_DUE).
  if (assignMode === "DEFER") return empty;

  const session = await db.classSession.findUnique({
    where: { id: opts.sessionId },
    select: {
      id: true,
      classId: true,
      lessonId: true,
      plan: { select: { lessonId: true } },
      class: { select: { name: true, centerId: true } },
    },
  });
  if (!session) return empty;

  // Lesson của buổi: ưu tiên lessonId trực tiếp, fallback ClassSessionPlan (R7-06).
  const lessonId = session.lessonId ?? session.plan?.lessonId ?? null;
  if (!lessonId) return empty; // buổi không gắn lesson → hoàn tất bình thường, không giao gì

  // Exam PUBLISHED gắn lesson; loại exam của lớp khác (giữ exam dùng chung classId=null).
  const exams = await db.exam.findMany({
    where: {
      lessonId,
      status: "PUBLISHED",
      OR: [{ classId: null }, { classId: session.classId }],
    },
    select: { id: true, title: true, defaultDueDays: true },
  });
  if (exams.length === 0) return empty;

  const enrollments = await db.enrollment.findMany({
    where: { classId: session.classId, status: { in: [...HOMEWORK_ACTIVE_STATUS] } },
    select: { studentId: true, student: { select: { name: true, centerId: true } } },
  });
  if (enrollments.length === 0) {
    return { created: 0, examCount: exams.length, studentCount: 0, skipped: true };
  }

  const rows = exams.flatMap((exam) => {
    const dueAt = computeHomeworkDueAt({
      assignMode,
      now,
      defaultDueDays: exam.defaultDueDays,
      customDueAt: opts.customDueAt ?? null,
    });
    return enrollments.map((e) => ({
      classSessionId: session.id,
      examId: exam.id,
      studentId: e.studentId,
      dueAt,
      assignMode,
      assignedById: opts.assignedById ?? null,
    }));
  });

  // Idempotency: unique (classSessionId, examId, studentId) — skipDuplicates → replay-safe.
  const res = await db.homeworkAssignment.createMany({ data: rows, skipDuplicates: true });

  // Notify PH bài mới (idempotent theo buổi × HV). Không lộ nội dung — chỉ tổng quan.
  const examWord = exams.length > 1 ? `${exams.length} bài` : "1 bài";
  for (const e of enrollments) {
    await db.notification.upsert({
      where: { dedupeKey: `homework.assigned:${session.id}:${e.studentId}` },
      create: {
        title: "Bài tập mới",
        body: `Con ${e.student?.name ?? ""} có ${examWord} kiểm tra/bài tập mới của lớp ${session.class?.name ?? ""}.`,
        audience: "STUDENT",
        studentId: e.studentId,
        classId: session.classId,
        centerId: e.student?.centerId ?? session.class?.centerId ?? null,
        createdByName: "Hệ thống",
        dedupeKey: `homework.assigned:${session.id}:${e.studentId}`,
      },
      update: {},
    });
  }

  return { created: res.count, examCount: exams.length, studentCount: enrollments.length, skipped: false };
}

// ════════════════════════════════════════════════════════════════════════════
// FL-R2 W5 (R2-LMS-4) — Tự sinh Assignment (bài tập về nhà) từ AssignmentTemplate
// khi TẠO LỚP. Template = "ngân hàng" gắn Lesson (khung CT). Khi lớp pin giáo trình
// + sinh ClassSessionPlan, ta sinh 1 Assignment (DRAFT) cho mỗi template gắn các
// Lesson của lớp, CLONE câu hỏi template → Question mới (KHÔNG đụng câu hỏi gốc).
// Idempotent: 1 template → tối đa 1 Assignment/lớp (unique [classId,templateId] +
// query-check + catch P2002). DRAFT để GV duyệt/publish trước khi giao HV.
// ════════════════════════════════════════════════════════════════════════════

/** Câu hỏi nguồn (từ template) — shape select dùng để CLONE. */
export type TemplateSourceQuestion = {
  type: QuestionType;
  text: string;
  explanation: string | null;
  imageUrl: string | null;
  difficulty: QuestionDifficulty;
  tags: string[];
  curriculumId: string | null;
  courseId: string | null;
  points: number | null;
  timeLimitSec: number | null;
  lessonId: string | null;
  correctAnswer: string | null;
  /** Parity 18/08 — payload soạn đề (FILL_BLANK/MATCHING/ORDERING/ui) PHẢI theo bản clone. */
  meta: unknown;
  isPublic: boolean;
  notes: string | null;
  choices: { order: number; text: string; isCorrect: boolean; imageUrl: string | null }[];
};

/**
 * THUẦN (test được) — dựng data Question CLONE để nest-create dưới Assignment.
 * KHÔNG copy `questionCode` (unique toàn hệ thống → clone phải để null), KHÔNG copy
 * id/authorId/assignmentId. Choices clone theo order/text/isCorrect/imageUrl.
 */
export function cloneQuestionForAssignment(q: TemplateSourceQuestion) {
  return {
    type: q.type,
    text: q.text,
    explanation: q.explanation,
    imageUrl: q.imageUrl,
    difficulty: q.difficulty,
    tags: q.tags,
    curriculumId: q.curriculumId,
    courseId: q.courseId,
    points: q.points,
    timeLimitSec: q.timeLimitSec,
    lessonId: q.lessonId,
    correctAnswer: q.correctAnswer,
    // Prisma JsonValue đọc ra là unknown; null DB → bỏ qua (cột nullable).
    meta: (q.meta ?? undefined) as Prisma.InputJsonValue | undefined,
    isPublic: q.isPublic,
    notes: q.notes,
    choices: {
      create: q.choices.map((c) => ({
        order: c.order,
        text: c.text,
        isCorrect: c.isCorrect,
        imageUrl: c.imageUrl,
      })),
    },
  };
}

export type GenerateAssignmentsResult = {
  created: number;
  templateCount: number;
  skipped: number;
};

/**
 * Sinh Assignment (DRAFT) cho 1 lớp từ template gắn các Lesson của lớp (qua
 * ClassSessionPlan đã pin). Best-effort + idempotent. createdById=null (hệ thống).
 */
export async function generateAssignmentsFromTemplates(opts: {
  classId: string;
}): Promise<GenerateAssignmentsResult> {
  const plans = await db.classSessionPlan.findMany({
    where: { classId: opts.classId },
    select: { lessonId: true },
  });
  const lessonIds = [...new Set(plans.map((p) => p.lessonId).filter((x): x is string => !!x))];
  if (lessonIds.length === 0) return { created: 0, templateCount: 0, skipped: 0 };

  const templates = await db.assignmentTemplate.findMany({
    where: { lessonId: { in: lessonIds } },
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
      templateQuestions: {
        orderBy: { order: "asc" },
        select: {
          question: {
            select: {
              type: true,
              text: true,
              explanation: true,
              imageUrl: true,
              difficulty: true,
              tags: true,
              curriculumId: true,
              courseId: true,
              points: true,
              timeLimitSec: true,
              lessonId: true,
              correctAnswer: true,
              meta: true, // Parity 18/08 — payload soạn đề theo bản clone
              isPublic: true,
              notes: true,
              choices: {
                orderBy: { order: "asc" },
                select: { order: true, text: true, isCorrect: true, imageUrl: true },
              },
            },
          },
        },
      },
    },
  });
  if (templates.length === 0) return { created: 0, templateCount: 0, skipped: 0 };

  // Idempotent: bỏ template đã có Assignment cho lớp này.
  const existing = await db.assignment.findMany({
    where: { classId: opts.classId, templateId: { in: templates.map((t) => t.id) } },
    select: { templateId: true },
  });
  const done = new Set(existing.map((e) => e.templateId));

  let created = 0;
  let skipped = 0;
  for (const t of templates) {
    if (done.has(t.id)) {
      skipped++;
      continue;
    }
    try {
      await db.assignment.create({
        data: {
          class: { connect: { id: opts.classId } },
          ...(t.lessonId ? { lesson: { connect: { id: t.lessonId } } } : {}),
          template: { connect: { id: t.id } },
          title: t.title,
          description: t.description,
          instructions: t.instructions,
          kind: t.kind,
          totalPoints: t.totalPoints,
          allowText: t.allowText,
          allowFile: t.allowFile,
          status: "DRAFT",
          questions: {
            create: t.templateQuestions.map((tq) => cloneQuestionForAssignment(tq.question)),
          },
          attachments: {
            create: t.attachments.map((f) => ({
              fileUrl: f.fileUrl,
              fileName: f.fileName,
              fileSize: f.fileSize,
              mimeType: f.mimeType,
              uploadedById: f.uploadedById,
            })),
          },
        },
      });
      created++;
    } catch (err: unknown) {
      // P2002 unique (classId, templateId) — đã sinh song song → coi như skip (idempotent).
      if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002") {
        skipped++;
        continue;
      }
      console.error("[generateAssignmentsFromTemplates] template", t.id, err);
    }
  }
  return { created, templateCount: templates.length, skipped };
}
