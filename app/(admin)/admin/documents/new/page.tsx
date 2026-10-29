import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { DocumentForm } from "../_components/document-form";

export const dynamic = "force-dynamic";

export default async function NewDocumentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("documents:upload"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Nhóm 01 L1 — Lesson = học liệu toàn cục, scopedDb pass-through.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const lessons = await sdb.lesson.findMany({
    where: { curriculum: { isActive: true } },
    include: { curriculum: { select: { name: true } } },
    orderBy: [{ curriculumId: "asc" }, { order: "asc" }],
    take: 500,
  });

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/documents"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold text-foreground">
          Tải lên tài liệu giảng dạy
        </h1>
      </div>

      <DocumentForm
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
