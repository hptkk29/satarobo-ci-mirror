import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import {
  QuestionForm,
  type QuestionFormValue,
} from "../../_components/question-form";
import { checkPermission } from "@/lib/auth/check-permission";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditQuestionPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("questions:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;

  // Nhóm 01 L1 — Question/Lesson/Curriculum = ngân hàng câu hỏi + giáo trình
  // toàn cục, scopedDb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [question, lessons, curriculums] = await Promise.all([
    sdb.question.findUnique({
      where: { id },
      include: {
        choices: { orderBy: { order: "asc" } },
      },
    }),
    sdb.lesson.findMany({
      where: { curriculum: { isActive: true } },
      include: { curriculum: { select: { name: true } } },
      orderBy: [{ curriculumId: "asc" }, { order: "asc" }],
      take: 500,
    }),
    sdb.curriculum.findMany({
      where: { isActive: true },
      include: { course: { select: { name: true } } },
      orderBy: [{ courseId: "asc" }, { version: "desc" }],
      take: 300,
    }),
  ]);

  if (!question) notFound();

  const formValue: QuestionFormValue = {
    id: question.id,
    questionCode: question.questionCode,
    type: question.type,
    text: question.text,
    explanation: question.explanation,
    imageUrl: question.imageUrl,
    difficulty: question.difficulty,
    tags: question.tags,
    curriculumId: question.curriculumId,
    courseId: question.courseId,
    points: question.points,
    timeLimitSec: question.timeLimitSec,
    lessonId: question.lessonId,
    correctAnswer: question.correctAnswer,
    choices: question.choices.map((c) => ({
      order: c.order,
      text: c.text,
      isCorrect: c.isCorrect,
      imageUrl: c.imageUrl,
    })),
    isPublic: question.isPublic,
    notes: question.notes,
  };

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/questions"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold text-foreground">
          Sửa câu hỏi:{" "}
          <span className="font-bold text-primary">
            {question.text.slice(0, 80)}
            {question.text.length > 80 ? "…" : ""}
          </span>
        </h1>
      </div>

      <QuestionForm
        question={formValue}
        lessons={lessons.map((l) => ({
          id: l.id,
          order: l.order,
          title: l.title,
          curriculumName: l.curriculum.name,
        }))}
        curriculums={curriculums.map((c) => ({
          id: c.id,
          label: `${c.course.name} — ${c.name} (v${c.version})`,
          courseId: c.courseId,
        }))}
      />
    </div>
  );
}
