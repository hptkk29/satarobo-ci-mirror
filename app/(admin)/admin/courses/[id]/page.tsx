import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { Badge } from "@/components/ui/badge";
import { CourseBasicsForm } from "./_components/course-basics-form";
import { DiscountSection, type DiscountRow } from "./_components/discount-section";
import { HocBuSection } from "./_components/hoc-bu-section";
import { hocPhanCuaKhoa } from "@/lib/hoc-bu/dong-can-bu";

export const dynamic = "force-dynamic";

function toDateInput(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("courses:view"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const canEdit = await checkPermission("courses:edit");
  // R2-LMS-1 — quản lý gói bán ngay trong chi tiết khoá dạy (gộp UI "Khoá học").
  const canEditPackages = await checkPermission("course-packages:edit");

  // Course là catalog toàn hệ thống (không center-scoped); scopedDb pass-through.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const course = await sdb.course.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      ageRange: true,
      level: true,
      price: true,
      isActive: true,
      choPhepHocBu: true,
      discounts: {
        orderBy: [{ active: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          type: true,
          value: true,
          note: true,
          conditions: true,
          active: true,
          validFrom: true,
          validTo: true,
        },
      },
    },
  });

  if (!course) notFound();

  // R3: gói bán (CoursePackage) liên kết với khoá dạy này — reverse của CoursePackage.courseId.
  // CoursePackage là catalog toàn hệ thống (không center-scoped); read thuần qua sdb pass-through.
  const linkedPackages = await sdb.coursePackage.findMany({
    where: { courseId: id },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      level: true,
      priceOriginal: true,
      isPublished: true,
    },
  });

  // Học bù — học phần đếm từ giáo trình đang dùng + lượt đã khai (docs/hoc-bu/DAC-TA.md).
  const [baiGiaoTrinh, luotDaKhai] = await Promise.all([
    sdb.lesson.findMany({
      where: { archivedAt: null, curriculum: { courseId: id, isActive: true } },
      select: { moduleCode: true, order: true },
    }),
    sdb.courseModuleMakeupQuota.findMany({
      where: { courseId: id },
      select: { moduleCode: true, luotBu: true },
    }),
  ]);
  const hocPhan = hocPhanCuaKhoa(baiGiaoTrinh, new Map(luotDaKhai.map((q) => [q.moduleCode, q.luotBu])));

  const discounts: DiscountRow[] = course.discounts.map((d) => ({
    id: d.id,
    type: d.type,
    value: d.value,
    note: d.note,
    conditions: d.conditions,
    active: d.active,
    validFrom: toDateInput(d.validFrom),
    validTo: toDateInput(d.validTo),
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/courses"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Danh sách khoá dạy
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{course.name}</h1>
          {course.isActive ? (
            <Badge className="bg-state-success-soft text-state-success-ink hover:bg-state-success-soft-hover">Hoạt động</Badge>
          ) : (
            <Badge className="bg-muted text-foreground hover:bg-muted">Tắt</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">/{course.slug}</p>
      </div>

      {canEdit ? (
        <CourseBasicsForm course={course} />
      ) : (
        <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Thông tin khoá học</h2>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Độ tuổi</dt>
              <dd className="font-medium">{course.ageRange || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Trình độ</dt>
              <dd className="font-medium">{course.level || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Giá niêm yết</dt>
              <dd className="font-medium">
                {course.price != null ? `${course.price.toLocaleString("vi-VN")}đ` : "—"}
              </dd>
            </div>
          </dl>
        </div>
      )}

      <DiscountSection courseId={course.id} discounts={discounts} canEdit={canEdit} />

      <HocBuSection
        courseId={course.id}
        choPhepHocBu={course.choPhepHocBu}
        hocPhan={hocPhan}
        canEdit={canEdit}
      />

      {/* R2-LMS-1: gói bán liên kết — quản lý ngay tại chi tiết khoá (gộp UI "Khoá học").
          Gói = đơn vị BÁN (giá), khoá dạy = đơn vị GIẢNG. CRUD gói tái dùng /course-packages. */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Gói bán liên kết</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Các gói bán (giá) trỏ về khoá dạy này. Gói = đơn vị BÁN, khoá dạy = đơn vị GIẢNG.
            </p>
          </div>
          {canEditPackages && (
            <Link
              href={`/course-packages/new?courseId=${course.id}`}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
            >
              + Thêm gói bán
            </Link>
          )}
        </div>
        {linkedPackages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có gói bán nào liên kết khoá dạy này.</p>
        ) : (
          <ul className="divide-y divide-border">
            {linkedPackages.map((pkg) => (
              <li key={pkg.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{pkg.code}</span>
                <span className="font-medium text-foreground">{pkg.name}</span>
                {pkg.level ? <span className="text-muted-foreground">· {pkg.level}</span> : null}
                <span className="text-muted-foreground">
                  ·{" "}
                  {pkg.priceOriginal != null
                    ? `${pkg.priceOriginal.toLocaleString("vi-VN")}đ`
                    : "—"}
                </span>
                {pkg.isPublished ? (
                  <Badge className="bg-state-success-soft text-state-success-ink hover:bg-state-success-soft-hover">Đã đăng</Badge>
                ) : (
                  <Badge className="bg-muted text-foreground hover:bg-muted">Nháp</Badge>
                )}
                {canEditPackages && (
                  <Link
                    href={`/course-packages/${pkg.id}/edit`}
                    className="ml-auto rounded-md border border-border px-2 py-0.5 text-xs font-semibold text-foreground hover:bg-muted"
                  >
                    Sửa
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
