"use server";

import { revalidatePath } from "next/cache";
import { portalDb, portalTx } from "@/lib/portal/db";
import { requireActiveStudent } from "@/lib/portal/session";
import {
  studentCanAccessExam,
  markHomeworkAfterAttempt,
} from "@/lib/lms/exam-access";

// =============================================================================
// PORTAL EXAM ACTIONS — Phase T2.3
// Học sinh làm bài thi qua "site con". Mọi action verify attempt/exam thuộc
// activeSite.studentId (con đang chọn). LMS-12: cho thi lại tới exam.maxAttempts
// (mỗi lần = 1 ExamAttempt với attemptNo tăng dần).
// =============================================================================

type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/** Hạn nộp = min(startedAt + durationMinutes, exam.closeAt). */
function attemptDeadline(
  startedAt: Date,
  durationMinutes: number,
  closeAt: Date | null,
): Date {
  const byDuration = new Date(startedAt.getTime() + durationMinutes * 60_000);
  if (closeAt && closeAt.getTime() < byDuration.getTime()) return closeAt;
  return byDuration;
}

// Ownership đề thi: đề gắn lớp → enrollment active; đề DÙNG CHUNG (classId=null) →
// phải có HomeworkAssignment {studentId, examId} (trước đây chặn cứng `!classId →
// false` = ngõ cụt cho bài về nhà gắn exam dùng chung). Logic tách ra
// lib/lms/exam-access.ts (studentCanAccessExam) để test service-level.

export async function startAttempt(
  examId: string,
): Promise<ActionResult<{ attemptId: string }>> {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  const exam = await pdb.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      classId: true,
      status: true,
      openAt: true,
      closeAt: true,
      maxAttempts: true,
      _count: { select: { examQuestions: true } },
    },
  });
  if (!exam) return { ok: false, error: "Không tìm thấy đề thi" };
  if (
    !(await studentCanAccessExam({
      studentId,
      examId: exam.id,
      classId: exam.classId,
    }))
  ) {
    return {
      ok: false,
      error: "Đề thi không thuộc lớp hoặc chưa được giao cho con",
    };
  }
  if (exam.status !== "PUBLISHED") {
    return { ok: false, error: "Đề thi chưa mở" };
  }
  if (exam._count.examQuestions === 0) {
    return { ok: false, error: "Đề thi chưa có câu hỏi" };
  }
  const now = Date.now();
  if (exam.openAt && exam.openAt.getTime() > now) {
    return { ok: false, error: "Chưa đến giờ mở đề" };
  }
  if (exam.closeAt && exam.closeAt.getTime() < now) {
    return { ok: false, error: "Đề thi đã đóng" };
  }

  // LMS-12 (thi lại): nếu đang có bài DỞ → trả lại để làm tiếp (không tạo trùng).
  const inProgress = await pdb.examAttempt.findFirst({
    where: { examId, studentId, status: "IN_PROGRESS" },
    select: { id: true },
  });
  if (inProgress) {
    return { ok: true, attemptId: inProgress.id };
  }

  // Hết IN_PROGRESS → đếm số lần đã làm; chặn khi đã đạt maxAttempts.
  // maxAttempts null → mặc định 1 lần (đề cũ không cấu hình thi lại).
  const maxAttempts = exam.maxAttempts ?? 1;
  const count = await pdb.examAttempt.count({ where: { examId, studentId } });
  if (count >= maxAttempts) {
    return {
      ok: false,
      error: `Đã hết lượt làm bài (tối đa ${maxAttempts} lần)`,
    };
  }

  const created = await pdb.examAttempt.create({
    data: { examId, studentId, status: "IN_PROGRESS", attemptNo: count + 1 },
    select: { id: true },
  });
  return { ok: true, attemptId: created.id };
}

export async function saveAnswer(input: {
  attemptId: string;
  examQuestionId: string;
  selectedChoiceIds?: string[];
  textAnswer?: string | null;
}): Promise<ActionResult> {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  const attempt = await pdb.examAttempt.findUnique({
    where: { id: input.attemptId },
    select: {
      id: true,
      studentId: true,
      status: true,
      startedAt: true,
      exam: { select: { id: true, durationMinutes: true, closeAt: true } },
    },
  });
  if (!attempt || attempt.studentId !== studentId) {
    return { ok: false, error: "Không tìm thấy bài làm" };
  }
  if (attempt.status !== "IN_PROGRESS") {
    return { ok: false, error: "Bài làm đã nộp" };
  }
  const deadline = attemptDeadline(
    attempt.startedAt,
    attempt.exam.durationMinutes,
    attempt.exam.closeAt,
  );
  if (Date.now() > deadline.getTime()) {
    return { ok: false, error: "Đã hết giờ làm bài" };
  }

  // examQuestion phải thuộc đúng đề của attempt (chống chèn câu lạ).
  const eq = await pdb.examQuestion.findUnique({
    where: { id: input.examQuestionId },
    select: { id: true, examId: true },
  });
  if (!eq || eq.examId !== attempt.exam.id) {
    return { ok: false, error: "Câu hỏi không hợp lệ" };
  }

  const data = {
    selectedChoiceIds: input.selectedChoiceIds ?? [],
    textAnswer: input.textAnswer?.trim() || null,
  };
  await pdb.examAnswer.upsert({
    where: {
      attemptId_examQuestionId: {
        attemptId: input.attemptId,
        examQuestionId: input.examQuestionId,
      },
    },
    create: {
      attemptId: input.attemptId,
      examQuestionId: input.examQuestionId,
      ...data,
    },
    update: data,
  });
  return { ok: true };
}

export async function submitAttempt(
  attemptId: string,
): Promise<
  ActionResult<{ graded: boolean; late?: boolean; message?: string }>
> {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });

  const attempt = await pdb.examAttempt.findUnique({
    where: { id: attemptId },
    include: {
      answers: {
        include: {
          examQuestion: {
            include: { question: { include: { choices: true } } },
          },
        },
      },
      exam: {
        select: {
          id: true,
          passingScore: true,
          durationMinutes: true,
          closeAt: true,
          examQuestions: {
            include: { question: { select: { type: true } } },
          },
        },
      },
    },
  });
  if (!attempt || attempt.studentId !== studentId) {
    return { ok: false, error: "Không tìm thấy bài làm" };
  }
  if (attempt.status !== "IN_PROGRESS") {
    return { ok: false, error: "Bài làm đã nộp" };
  }

  // LMS-5: nộp TRỄ vẫn được FINALIZE (chấm theo các câu ĐÃ LƯU qua saveAnswer).
  // saveAnswer mới là cổng chặn deadline cho câu trả lời mới → submitAttempt
  // không nhận answer kèm, chỉ chấm những gì đã persist trước hạn. Dùng đúng
  // công thức deadline của saveAnswer để gắn cờ + thông báo VI khi quá hạn.
  const deadline = attemptDeadline(
    attempt.startedAt,
    attempt.exam.durationMinutes,
    attempt.exam.closeAt,
  );
  const lateSubmit = Date.now() > deadline.getTime();

  // Có câu tự luận (ESSAY/CODE) → chờ giáo viên chấm.
  const hasSubjective = attempt.exam.examQuestions.some(
    (eq) => eq.question.type === "ESSAY" || eq.question.type === "CODE",
  );

  let totalScore = 0;
  try {
    await portalTx(async (tx) => {
      for (const ans of attempt.answers) {
        const q = ans.examQuestion.question;
        // Mặc định cho ESSAY/CODE: chưa chấm (chờ giáo viên).
        let isCorrect: boolean | null = null;
        let score = 0;

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
        // ESSAY / CODE: giữ mặc định null/0 — giáo viên chấm tay sau.

        await tx.examAnswer.update({
          where: { id: ans.id },
          data: { isCorrect, score },
        });
        totalScore += score;
      }

      await tx.examAttempt.update({
        where: { id: attemptId },
        data: hasSubjective
          ? { status: "SUBMITTED", submittedAt: new Date() }
          : {
              status: "GRADED",
              submittedAt: new Date(),
              totalScore,
              passed: totalScore >= attempt.exam.passingScore,
              gradedAt: new Date(),
            },
      });

      // Bài về nhà (HomeworkAssignment) gắn đề này: ASSIGNED → SUBMITTED/GRADED,
      // cùng transaction nộp bài. Trước đây status đứng im vĩnh viễn → PH thấy
      // "Đã làm 0/N" dù HV đã nộp xong (lib/portal/learning + dashboard đọc h.status).
      await markHomeworkAfterAttempt(tx, {
        studentId,
        examId: attempt.exam.id,
        graded: !hasSubjective,
      });
    });
  } catch (err) {
    return {
      ok: false,
      error: `Nộp bài thất bại: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath("/portal/bai-thi");
  revalidatePath("/portal/ket-qua");
  revalidatePath(`/exams/${attempt.exam.id}/attempts`);
  return {
    ok: true,
    graded: !hasSubjective,
    late: lateSubmit,
    ...(lateSubmit
      ? { message: "Đã hết giờ — bài được nộp với các câu đã lưu" }
      : {}),
  };
}
