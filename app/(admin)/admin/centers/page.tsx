import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, FileSpreadsheet, DoorOpen } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { NutXuat } from "@/components/admin/nut-xuat";
import { PageHeader } from "@/components/admin/ui/page-header";
import { TheCoSo } from "./_components/the-co-so";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cơ sở | Admin" };

// 01/10/2026 — chủ dự án gộp "Phòng học" vào "Cơ sở" và thiết kế lại cả hai: danh sách cơ sở
// là lưới thẻ (vài cơ sở, cần đọc địa chỉ + số liệu), mỗi thẻ dẫn vào trang cơ sở nơi quản lý
// phòng học. Màn /rooms vẫn sống cho ai cần xem phòng của mọi cơ sở một lượt.
export default async function CentersAdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // SEC-M01: gate quyền tường minh + lọc cơ sở theo tầm nhìn. Truyền centerId của user vào
  // target → role CENTER-scope (centers:view[CENTER]) KHÔNG bị khoá trang.
  if (!(await checkPermission("centers:view", { centerId: session.user.centerId ?? null })))
    redirect("/dashboard");
  const [coTheSua, xemPhong] = await Promise.all([
    checkPermission("centers:edit"),
    checkPermission("rooms:view", { centerId: session.user.centerId ?? null }),
  ]);

  // Center ∈ SCOPE_EXEMPT (ranh giới tenant) → sdb pass-through KHÔNG tự lọc → lọc TAY:
  // SUPER_ADMIN/HO-level thấy tất cả; role cơ sở chỉ thấy center trong visibleCenterIds.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const centerScope =
    actor.isSuperAdmin || actor.isHoLevel ? {} : { id: { in: actor.visibleCenterIds } };
  const centers = await sdb.center.findMany({
    where: centerScope,
    orderBy: [{ isActive: "desc" }, { displayOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      phone: true,
      email: true,
      isActive: true,
      _count: { select: { classes: true, students: true, employees: true, rooms: true } },
    },
  });
  const dangMo = centers.filter((c) => c.isActive).length;

  return (
    <div>
      <PageHeader
        title="Cơ sở"
        subtitle={`${dangMo}/${centers.length} cơ sở đang hoạt động · phòng học quản lý trong từng cơ sở`}
        actions={
          <>
            {xemPhong && (
              <Link
                href="/rooms"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                <DoorOpen className="size-4" aria-hidden />
                Tất cả phòng học
              </Link>
            )}
            <NutXuat ma="co-so" />
            {coTheSua && (
              <>
                <Link
                  href="/centers/import"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
                >
                  <FileSpreadsheet className="size-4" aria-hidden />
                  Import Excel
                </Link>
                <Link
                  href="/centers/new"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
                >
                  <Plus className="size-4" aria-hidden />
                  Thêm cơ sở
                </Link>
              </>
            )}
          </>
        }
      />

      {centers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          Chưa có cơ sở nào trong tầm nhìn của bạn.
          {coTheSua && (
            <>
              {" "}
              <Link href="/centers/new" className="text-primary hover:underline">
                Thêm cơ sở đầu tiên →
              </Link>
            </>
          )}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {centers.map((c) => (
            <TheCoSo
              key={c.id}
              coTheSua={coTheSua}
              c={{
                id: c.id,
                name: c.name,
                code: c.code,
                address: c.address,
                phone: c.phone,
                email: c.email,
                isActive: c.isActive,
                dem: c._count,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
