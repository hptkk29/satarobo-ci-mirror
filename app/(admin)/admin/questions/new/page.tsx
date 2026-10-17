import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { QuestionForm } from "../_components/question-form";

export const dynamic = "force-dynamic";

export default async function NewQuestionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("questions:author"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Nhóm 01 L1 — Lesson/Curriculum = giáo trình toàn cục, scopedDb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [lessons, curriculums] = await Promise.all([
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

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/questions"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Thêm câu hỏi mới</h1>
      </div>

      <QuestionForm
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
