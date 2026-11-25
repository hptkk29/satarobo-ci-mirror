import { redirect, notFound } from "next/navigation";
import { Package } from "lucide-react";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { isScormEnabled } from "@/lib/flags";
import { isScormProcessingStale, SCORM_STALE_ERROR } from "@/lib/scorm/stale";
import { ScormManager, type CourseNode } from "./_components/scorm-manager";
import { PageHelp } from "@/components/admin/ui/page-help";

export const metadata = { title: "SCORM / Học liệu tương tác | Admin" };
export const dynamic = "force-dynamic";

export default async function ScormPage() {
  if (!isScormEnabled()) notFound();
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("training:manage"))) redirect("/dashboard");

  // Course/Curriculum/Lesson/ScormPackage không center-scoped → scopedDb pass-through
  // (đúng rule R6-F1). Quyền đã chặn ở training:manage.
  const sdb = scopedDb(await resolveActor(session.user.id));

  // Khoá dạy được → khung chương trình ĐANG DÙNG (ACTIVE, bản mới nhất) → các buổi.
  const courses = await sdb.course.findMany({
    where: { isTeachable: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      curriculums: {
        where: { status: "ACTIVE" },
        orderBy: { version: "desc" },
        take: 1,
        select: {
          name: true,
          lessons: {
            where: { archivedAt: null },
            orderBy: { order: "asc" },
            select: { id: true, order: true, title: true },
          },
        },
      },
    },
  });

  const lessonIds = courses.flatMap(
    (c) => c.curriculums[0]?.lessons.map((l) => l.id) ?? [],
  );

  // Gói/giáo án của tất cả buổi đang hiển thị — gộp theo buổi ở dưới.
  const packages = lessonIds.length
    ? await sdb.scormPackage.findMany({
        where: { lessonId: { in: lessonIds } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          lessonId: true,
          name: true,
          kind: true,
          status: true,
          version: true,
          isActiveForLesson: true,
          sizeBytes: true,
          fileCount: true,
          scormVersion: true,
          error: true,
          createdAt: true,
        },
      })
    : [];

  type Pkg = (typeof packages)[number];
  const byLesson = new Map<string, Pkg[]>();
  for (const p of packages) {
    const arr = byLesson.get(p.lessonId) ?? [];
    arr.push(p);
    byLesson.set(p.lessonId, arr);
  }

  // Mỗi buổi có tối đa: 1 giáo án đang dùng (PUBLISHED+active) + 1 bản đang xử lý
  // (UPLOADING/PROCESSING) + 1 bản lỗi (FAILED) tạm thời cần dọn.
  const courseNodes: CourseNode[] = courses.map((c) => {
    const cur = c.curriculums[0];
    return {
      id: c.id,
      name: c.name,
      code: c.code,
      curriculumName: cur?.name ?? null,
      lessons: (cur?.lessons ?? []).map((l) => {
        const pkgs = byLesson.get(l.id) ?? [];
        const active =
          pkgs.find((p) => p.isActiveForLesson && p.status === "PUBLISHED") ??
          null;
        // QA 20/07 — bản UPLOADING/PROCESSING quá 15 phút = KẸT (upload đứt/process
        // treo): không hiện "Đang xử lý…" vĩnh viễn nữa mà đưa sang khối bản lỗi
        // để admin bấm "Dọn" và đẩy lại.
        const processing = pkgs.filter(
          (p) => p.status === "UPLOADING" || p.status === "PROCESSING",
        );
        const pending =
          processing.find(
            (p) => !isScormProcessingStale(p.status, p.createdAt),
          ) ?? null;
        const stale =
          processing.find((p) =>
            isScormProcessingStale(p.status, p.createdAt),
          ) ?? null;
        const failedPkg = pkgs.find((p) => p.status === "FAILED") ?? null;
        const failed =
          failedPkg ??
          (stale
            ? { id: stale.id, name: stale.name, error: SCORM_STALE_ERROR }
            : null);
        return {
          lessonId: l.id,
          order: l.order,
          title: l.title,
          giaoAn: active
            ? {
                id: active.id,
                name: active.name,
                kind: active.kind,
                version: active.version,
                sizeBytes: active.sizeBytes,
                fileCount: active.fileCount,
                scormVersion: active.scormVersion,
              }
            : null,
          pending: pending
            ? { id: pending.id, name: pending.name, status: pending.status }
            : null,
          failed: failed
            ? { id: failed.id, name: failed.name, error: failed.error }
            : null,
        };
      }),
    };
  });

  return (
    <div className="max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Package className="h-6 w-6 text-primary" /> SCORM / Học liệu tương
          tác
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Giáo án của từng buổi học
        </p>
      </div>

      <PageHelp>
        <p>
          Chọn khoá học → buổi học để xem hoặc đổi giáo án. Mỗi buổi chỉ giữ 1
          giáo án (PDF slide hoặc gói SCORM) — đẩy bản mới sẽ thay (xoá) bản cũ
          sau khi xử lý xong.
        </p>
      </PageHelp>

      <ScormManager courses={courseNodes} />
    </div>
  );
}
