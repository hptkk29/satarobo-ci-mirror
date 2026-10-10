import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { PackageListRow } from "./_components/package-list-row";
import { checkPermission } from "@/lib/auth/check-permission";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export default async function CoursePackagesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("course-packages:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Nhóm 01 L1 — CoursePackage/Course = catalog LMS toàn cục (không center-scope),
  // scopedDb pass-through; dùng để sạch whitelist db trần.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const packages = await sdb.coursePackage.findMany({
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      slug: true,
      code: true,
      name: true,
      level: true,
      lessons: true,
      priceOriginal: true,
      isPublished: true,
      isFeatured: true,
      // FL1-05 — khoá dạy liên kết (đọc qua relation).
      course: { select: { id: true, name: true, code: true } },
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gói khoá học (để bán)</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gói = đơn vị BÁN (giá, marketing) Sata1-8 và Combo. Mỗi gói liên kết một{" "}
            <span className="font-medium">Khoá dạy</span> (chương trình giảng) để tránh trùng lặp.
          </p>
        </div>
        <Link
          href="/course-packages/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          <Plus className="h-4 w-4" />
          Thêm gói
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Mã
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tên gói
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cấp độ
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Khoá dạy
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Giá
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Số buổi
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Trạng thái
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {packages.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Chưa có gói khoá học nào
                  </td>
                </tr>
              ) : (
                packages.map((pkg) => <PackageListRow key={pkg.id} pkg={pkg} />)
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
