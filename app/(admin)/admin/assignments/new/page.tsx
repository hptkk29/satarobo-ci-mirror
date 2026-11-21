import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { AssignmentForm } from "../_components/assignment-form";

export const dynamic = "force-dynamic";

export default async function NewAssignmentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("assignments:create"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Cách ly cơ sở: Class ∈ SCOPED_MODELS → dropdown lớp chỉ hiện lớp trong tầm nhìn
  // cơ sở của actor (CS1 không thấy lớp CS2). Lesson theo chương trình (toàn hệ thống)
  // → sdb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const [classes, lessons] = await Promise.all([
    sdb.class.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, classCode: true },
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
          href="/assignments"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Tạo bài tập mới</h1>
      </div>

      <AssignmentForm
        classes={classes}
        lessons={lessons.map((l) => ({
          id: l.id,
          order: l.order,
          title: l.title,
          curriculumName: l.curriculum.name,
        }))}
      />
    </div>
  );
}
