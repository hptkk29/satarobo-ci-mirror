import Link from "next/link";
import { ChevronLeft, ClipboardCheck, Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { InventoryAuditStatus, type Prisma } from "@prisma/client";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kho — Kiểm kê | Admin" };

const STATUS_INFO: Record<
  InventoryAuditStatus,
  { label: string; color: string }
> = {
  DRAFT: { label: "Đang soạn", color: "bg-state-warning-soft text-state-warning-ink" },
  COMPLETED: { label: "Hoàn thành", color: "bg-state-success-soft text-state-success-ink" },
  CANCELLED: { label: "Đã huỷ", color: "bg-muted text-muted-foreground" },
};

const VALID_STATUSES = Object.values(InventoryAuditStatus);

function fmtDateTime(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface SearchParams {
  searchParams: Promise<{
    status?: string;
    centerId?: string;
  }>;
}

export default async function AuditListPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("inventory:audit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Cách ly cơ sở: InventoryAudit ∈ SCOPED_MODELS → scopedDb tự inject
  // `centerId IN visibleCenterIds` cho findMany (Center là exempt — pass-through).
  const sdb = scopedDb(await resolveActor(session.user.id));

  const sp = await searchParams;
  const statusFilter =
    sp.status && VALID_STATUSES.includes(sp.status as InventoryAuditStatus)
      ? (sp.status as InventoryAuditStatus)
      : undefined;
  const centerFilter = sp.centerId?.trim() || undefined;

  const where: Prisma.InventoryAuditWhereInput = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(centerFilter ? { centerId: centerFilter } : {}),
  };

  const [audits, centers] = await Promise.all([
    sdb.inventoryAudit.findMany({
      where,
      include: {
        center: { select: { name: true } },
        performedBy: { select: { fullName: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
    sdb.center.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { displayOrder: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/inventory/items"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại kho
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <ClipboardCheck className="h-6 w-6 text-primary" />
              Kiểm kê (Audit)
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {audits.length > 0
                ? `${audits.length} phiếu (tối đa 100 gần nhất)`
                : "Chưa có phiếu kiểm kê nào"}
            </p>
          </div>
          <Link
            href="/inventory/audit/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Tạo phiếu kiểm kê
          </Link>
        </div>
      </div>

      <form
        method="GET"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi trạng thái</option>
          {Object.entries(STATUS_INFO).map(([v, { label }]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="centerId"
          defaultValue={centerFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi cơ sở</option>
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Áp dụng bộ lọc
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Mã phiếu
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cơ sở
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Trạng thái
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Dòng
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Đã điều chỉnh
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  +/−
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Người làm
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Thời gian
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {audits.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có phiếu kiểm kê nào khớp bộ lọc.{" "}
                    <Link
                      href="/inventory/audit/new"
                      className="text-primary hover:underline"
                    >
                      Tạo mới →
                    </Link>
                  </td>
                </tr>
              ) : (
                audits.map((a) => {
                  const statusInfo = STATUS_INFO[a.status];
                  const isDraft = a.status === "DRAFT";
                  return (
                    <tr key={a.id} className="hover:bg-muted/60">
                      <td className="px-3 py-3 font-mono text-xs text-foreground tabular-nums">
                        {a.auditCode ?? a.id.slice(0, 8) + "…"}
                      </td>
                      <td className="px-3 py-3 text-sm text-foreground">
                        {a.center.name}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-sm tabular-nums text-foreground">
                        {a._count.items}
                      </td>
                      <td className="px-3 py-3 text-center text-sm tabular-nums font-semibold text-foreground">
                        {a.totalAdjusted}
                      </td>
                      <td className="px-3 py-3 text-center text-xs tabular-nums">
                        {a.totalIncreases > 0 && (
                          <span className="text-state-success-ink">
                            +{a.totalIncreases}
                          </span>
                        )}
                        {a.totalIncreases > 0 && a.totalDecreases > 0 && " / "}
                        {a.totalDecreases > 0 && (
                          <span className="text-state-danger-ink">
                            -{a.totalDecreases}
                          </span>
                        )}
                        {a.totalIncreases === 0 && a.totalDecreases === 0 && "—"}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {a.performedBy?.fullName ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">
                        {fmtDateTime(a.performedAt ?? a.createdAt)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {isDraft ? (
                          <Link
                            href={`/inventory/audit/${a.id}/edit`}
                            className="inline-flex items-center gap-1 rounded-md border border-state-warning px-2.5 py-1 text-xs font-semibold text-state-warning-ink hover:bg-state-warning-soft"
                          >
                            Tiếp tục →
                          </Link>
                        ) : (
                          <Link
                            href={`/inventory/audit/${a.id}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            Xem
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
