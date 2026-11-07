import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

// R7-13 — xem trước đề: render ảnh đề bài + ảnh đáp án (Question.imageUrl / Choice.imageUrl).
export default async function ExamPreviewPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("exams:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;
  const sdb = scopedDb(await resolveActor(session.user.id));
  const exam = await sdb.exam.findUnique({
    where: { id },
    include: {
      examQuestions: {
        orderBy: { order: "asc" },
        include: {
          question: {
            include: { choices: { orderBy: { order: "asc" } } },
          },
        },
      },
    },
  });
  if (!exam) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/exams/${id}/builder`}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại builder
        </Link>
        <h1 className="text-2xl font-bold text-foreground">
          Xem trước: <span className="text-primary">{exam.title}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {exam.examQuestions.length} câu · {exam.totalPoints} điểm ·{" "}
          {exam.durationMinutes}′
        </p>
      </div>

      <ol className="space-y-5">
        {exam.examQuestions.map((eq, i) => {
          const q = eq.question;
          return (
            <li
              key={eq.id}
              className="rounded-xl border border-border bg-card p-5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold text-foreground">
                  Câu {i + 1}.{" "}
                  <span className="whitespace-pre-line font-normal">{q.text}</span>
                </p>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {eq.points} điểm
                </span>
              </div>

              {q.imageUrl && (
                <img
                  src={q.imageUrl}
                  alt={`ảnh câu ${i + 1}`}
                  className="mt-3 max-h-60 rounded-lg border border-border"
                />
              )}

              {q.choices.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {q.choices.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-sm">
                      <span className="font-bold text-muted-foreground">
                        {String.fromCharCode(64 + c.order)}.
                      </span>
                      <div>
                        <span
                          className={
                            c.isCorrect ? "font-semibold text-state-success-ink" : ""
                          }
                        >
                          {c.text}
                          {c.isCorrect && " ✓"}
                        </span>
                        {c.imageUrl && (
                          <img
                            src={c.imageUrl}
                            alt={`ảnh đáp án ${c.order}`}
                            className="mt-1 max-h-32 rounded border border-border"
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
