import Link from "next/link";
import { notFound } from "next/navigation";
import { portalDb } from "@/lib/portal/db";
import { requireActiveStudent } from "@/lib/portal/session";
import { studentCanAccessExam } from "@/lib/lms/exam-access";
import { ExamTaking } from "@/app/(portal)/portal/bai-thi/[examId]/_components/exam-taking";
import { HvBatDauThi } from "@/components/portal/hv-bat-dau-thi";
import { HvThe, NUT_VIEN } from "@/components/portal/hv-ui";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Làm bài thi | Cổng học sinh Sata Robo", robots: { index: false } };

// Deterministic shuffle theo chuỗi (giữ thứ tự ổn định qua tải lại) — cùng thuật toán với trang làm bài của cổng phụ huynh.
function xaoTronCoHat<T>(arr: T[], hat: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < hat.length; i++) {
    h ^= hat.charCodeAt(i);
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
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// Làm bài thi trong Cổng học sinh. Dùng CHÍNH hành động bắt đầu / lưu đáp án / nộp bài của cổng phụ huynh (đã nhận `choHocSinh`),
// nên mọi luật (đề có thuộc lớp con không, hạn đóng, số lần làm, không lộ đáp án đúng) giữ nguyên.
export default async function HvBaiThiRoute({ params }: { params: Promise<{ examId: string }> }) {
  const { ctx, studentId } = await requireActiveStudent({ choHocSinh: true });
  const pdb = portalDb({ parentUserId: ctx.parentUserId, childIds: ctx.children.map((c) => c.id) });
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
        select: { id: true, order: true, points: true, question: { select: { type: true, text: true, choices: { select: { id: true, text: true, order: true } } } } },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!exam) notFound();
  if (!(await studentCanAccessExam({ studentId, examId: exam.id, classId: exam.classId }))) notFound();

  const dangLam = await pdb.examAttempt.findFirst({
    where: { examId, studentId, status: "IN_PROGRESS" },
    select: { id: true, startedAt: true },
  });

  if (!dangLam) {
    const gannhat = await pdb.examAttempt.findFirst({
      where: { examId, studentId },
      orderBy: { attemptNo: "desc" },
      select: { status: true, totalScore: true },
    });
    return (
      <>
        <Link href="/portal/hoc-sinh/bai-tap" className="self-start text-sm font-bold text-[var(--sr-purple-text)] no-underline">
          ← Bài tập & bài thi
        </Link>
        <HvThe vien="tim" className="max-w-[760px] gap-3 p-6">
          <div className="text-xs font-bold tracking-[0.06em] text-[var(--sr-purple-text)]">
            {gannhat ? "EM ĐÃ LÀM BÀI NÀY" : "LÀM TRÊN MÁY"}
          </div>
          <h1 className="m-0 break-words text-[22px] font-bold leading-[29px]">{exam.title}</h1>
          <div className="text-sm text-muted-foreground">
            {exam.durationMinutes} phút · {exam.examQuestions.length} câu · {exam.totalPoints} điểm
          </div>
          {gannhat?.totalScore != null && <div className="text-sm font-bold text-[var(--sr-success)]">Điểm lần gần nhất: {String(gannhat.totalScore).replace(".", ",")}</div>}
          <div className="flex flex-wrap items-center gap-3">
            <HvBatDauThi examId={exam.id} nhan={gannhat ? "Làm lại" : "Bắt đầu làm bài"} />
            <Link href="/portal/hoc-sinh/bai-tap" className={cn(NUT_VIEN, "h-[46px] text-sm")}>
              Để sau
            </Link>
          </div>
        </HvThe>
      </>
    );
  }

  const answers = await pdb.examAnswer.findMany({
    where: { attemptId: dangLam.id },
    select: { examQuestionId: true, selectedChoiceIds: true, textAnswer: true },
  });
  const answerMap = new Map(answers.map((a) => [a.examQuestionId, a]));
  // Hạn nộp = min(startedAt + thời lượng, closeAt).
  const theoGio = dangLam.startedAt.getTime() + exam.durationMinutes * 60_000;
  const han = exam.closeAt && exam.closeAt.getTime() < theoGio ? exam.closeAt.getTime() : theoGio;

  let cau = exam.examQuestions.map((eq) => {
    const a = answerMap.get(eq.id);
    let choices = [...eq.question.choices].sort((x, y) => x.order - y.order);
    if (exam.shuffleChoices) choices = xaoTronCoHat(choices, dangLam.id + eq.id);
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
  if (exam.shuffleQuestions) cau = xaoTronCoHat(cau, dangLam.id);

  return <ExamTaking attemptId={dangLam.id} title={exam.title} deadlineMs={han} totalPoints={exam.totalPoints} questions={cau} diSauKhiNop="/portal/hoc-sinh/bai-tap" />;
}
