import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { TemplateForm } from "../_components/template-form";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("assignments:create"))) {
    redirect("/assignments?error=unauthorized");
  }

  // Khung CT + buổi học toàn hệ thống (∉ SCOPED_MODELS → scopedDb pass-through).
  const sdb = scopedDb(await resolveActor(session.user.id));
  const [curricula, lessons] = await Promise.all([
    sdb.curriculum.findMany({
      where: { isActive: true },
      orderBy: [{ courseId: "asc" }, { version: "asc" }],
      select: { id: true, name: true, version: true },
      take: 200,
    }),
    sdb.lesson.findMany({
      where: { curriculum: { isActive: true } },
      include: { curriculum: { select: { name: true } } },
      orderBy: [{ curriculumId: "asc" }, { order: "asc" }],
      take: 500,
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/assignments/templates"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách mẫu
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Tạo mẫu bài tập mới</h1>
      </div>

      <TemplateForm
        curricula={curricula}
        lessons={lessons.map((l) => ({
          id: l.id,
          order: l.order,
          title: l.title,
          curriculumId: l.curriculumId,
          curriculumName: l.curriculum.name,
        }))}
      />
    </div>
  );
}
