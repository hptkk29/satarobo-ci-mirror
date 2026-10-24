import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { CurriculumForm } from "../_components/curriculum-form";

export const dynamic = "force-dynamic";

export default async function NewCurriculumPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("curriculum:create"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Nhóm 01 L1 — Course = catalog toàn cục, scopedDb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const courses = await sdb.course.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/curriculums"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Thêm giáo trình mới</h1>
      </div>

      {courses.length === 0 ? (
        <div className="rounded-xl border border-state-warning-soft bg-state-warning-soft p-4 text-sm text-state-warning-ink">
          Chưa có khoá học. Tạo khoá học trước tại{" "}
          <Link
            href="/courses"
            className="font-semibold underline hover:text-state-warning-ink"
          >
            /admin/courses
          </Link>
          .
        </div>
      ) : (
        <CurriculumForm courses={courses} />
      )}
    </div>
  );
}
