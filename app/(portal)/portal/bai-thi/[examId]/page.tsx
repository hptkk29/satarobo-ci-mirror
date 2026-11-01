import { notFound, redirect } from "next/navigation";
import { portalDb } from "@/lib/portal/db";
import { requireActiveStudent } from "@/lib/portal/session";
import { studentCanAccessExam } from "@/lib/lms/exam-access";
import { ExamTaking } from "./_components/exam-taking";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Làm bài thi | Sata Robo",
  robots: { index: false },
};

// Deterministic shuffle seeded bằng chuỗi (giữ thứ tự ổn định qua reload).
function seededShuffle<T>(arr: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rng = () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Props {
  params: Promise<{ examId: string }>;
}

export default async function ExamTakingPage({ params }: Props) {
  const { ctx, studentId } = await requireActiveStudent();
  const pdb = portalDb({
    parentUserId: ctx.parentUserId,
    childIds: ctx.children.map((c) => c.id),
  });
  const { examId } = await params;

  const exam = await pdb.exam.findUnique({
    where: { id: examId },
    select: {
      id: true,
      title: true,
      classId: true,
      durationMinutes: true,
      totalPoints: true,
      shuffleQuestions: true,
      shuffleChoices: true,
      closeAt: true,
      examQuestions: {
        select: {
          id: true,
          order: true,
          points: true,
          question: {
            select: {
              type: true,
              text: true,
              choices: { select: { id: true, text: true, order: true } },
            },
          },
        },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!exam) notFound();

  // Access: đề gắn lớp → con đang học lớp đó; đề DÙNG CHUNG (classId=null) → phải
  // có HomeworkAssignment giao cho con (trước đây chặn cứng → bài về nhà gắn exam
  // dùng chung thành ngõ cụt). Cùng luật với startAttempt (lib/lms/exam-access).
  if (
    !(await studentCanAccessExam({
      studentId,
      examId: exam.id,
      classId: exam.classId,
    }))
  ) {
    redirect("/portal/bai-thi");
  }

  // LMS-12 (thi lại): nhiều attempt/đề → ưu tiên bài ĐANG LÀM; nếu không có thì
  // lấy lần mới nhất (attemptNo desc) để quyết định điều hướng.
  const attempt =
    (await pdb.examAttempt.findFirst({
      where: { examId, studentId, status: "IN_PROGRESS" },
      select: { id: true, status: true, startedAt: true },
    })) ??
    (await pdb.examAttempt.findFirst({
      where: { examId, studentId },
      orderBy: { attemptNo: "desc" },
      select: { id: true, status: true, startedAt: true },
    }));
  if (!attempt) redirect("/portal/bai-thi");
  if (attempt.status !== "IN_PROGRESS") redirect("/portal/ket-qua");

  const answers = await pdb.examAnswer.findMany({
    where: { attemptId: attempt.id },
    select: { examQuestionId: true, selectedChoiceIds: true, textAnswer: true },
  });
  const answerMap = new Map(answers.map((a) => [a.examQuestionId, a]));

  // Hạn nộp = min(startedAt + duration, closeAt).
  const byDuration =
    attempt.startedAt.getTime() + exam.durationMinutes * 60_000;
  const deadlineMs =
    exam.closeAt && exam.closeAt.getTime() < byDuration
      ? exam.closeAt.getTime()
      : byDuration;

  let questions = exam.examQuestions.map((eq) => {
    const a = answerMap.get(eq.id);
    let choices = [...eq.question.choices].sort((x, y) => x.order - y.order);
    if (exam.shuffleChoices)
      choices = seededShuffle(choices, attempt.id + eq.id);
    return {
      eqId: eq.id,
      type: eq.question.type,
      text: eq.question.text,
      points: eq.points,
      choices: choices.map((c) => ({ id: c.id, text: c.text })),
      initialSelected: a?.selectedChoiceIds ?? [],
      initialText: a?.textAnswer ?? "",
    };
  });
  if (exam.shuffleQuestions) questions = seededShuffle(questions, attempt.id);

  return (
    <ExamTaking
      attemptId={attempt.id}
      title={exam.title}
      deadlineMs={deadlineMs}
      totalPoints={exam.totalPoints}
      questions={questions}
    />
  );
}
