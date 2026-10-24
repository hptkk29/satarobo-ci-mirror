import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  DollarSign,
  History,
  LayoutDashboard,
  Package,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { redirect } from "next/navigation";
import { getInventoryStats } from "@/lib/inventory-stats";
import { formatDateVN } from "@/lib/format/date";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kho — Tổng quan | Admin" };

function formatVnd(value: number): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(
    value,
  ) + " ₫";
}

function formatRelative(d: Date | null): string {
  if (!d) return "—";
  const diffDays = (Date.now() - new Date(d).getTime()) / 86400000;
  if (diffDays < 1) return "Hôm nay";
  if (diffDays < 7) return `${Math.floor(diffDays)} ngày trước`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} tuần trước`;
  return formatDateVN(d);
}

export default async function InventoryDashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("inventory:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const stats = await getInventoryStats();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <LayoutDashboard className="h-6 w-6 text-primary" />
            Tổng quan Kho
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Theo dõi tồn kho ZMROBO + linh kiện trên toàn hệ thống.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/inventory/items"
            className="rounded-md border border-border bg-card px-3 py-1.5 font-semibold text-foreground hover:bg-muted"
          >
            Mặt hàng →
          </Link>
          <Link
            href="/inventory/movements"
            className="rounded-md border border-border bg-card px-3 py-1.5 font-semibold text-foreground hover:bg-muted"
          >
            <History className="mr-1 inline h-3.5 w-3.5" />
            Lịch sử
          </Link>
          <Link
            href="/inventory/audit"
            className="rounded-md border border-border bg-card px-3 py-1.5 font-semibold text-foreground hover:bg-muted"
          >
            <ClipboardCheck className="mr-1 inline h-3.5 w-3.5" />
            Kiểm kê
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon={<Package className="h-5 w-5 text-state-info-ink" />}
          label="Mặt hàng active"
          value={String(stats.totalItems)}
          sub={`${stats.totalBalances} entry có tồn`}
        />
        <StatCard
          icon={<DollarSign className="h-5 w-5 text-state-success-ink" />}
          label="Tổng giá trị tồn"
          value={formatVnd(stats.totalStockValue)}
        />
        <StatCard
          icon={
            <AlertTriangle
              className={`h-5 w-5 ${stats.lowStockCount > 0 ? "text-state-danger-ink" : "text-muted-foreground"}`}
            />
          }
          label="Cảnh báo tồn thấp"
          value={String(stats.lowStockCount)}
          danger={stats.lowStockCount > 0}
        />
        <StatCard
          icon={<Activity className="h-5 w-5 text-primary" />}
          label="Giao dịch 7 ngày"
          value={String(stats.recentMovements)}
        />
      </div>

      {stats.lowStockAlerts.length > 0 && (
        <section className="overflow-hidden rounded-xl border-2 border-state-danger bg-card">
          <header className="flex items-center gap-2 border-b border-state-danger bg-state-danger-soft px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-state-danger-ink" />
            <h2 className="font-semibold text-state-danger-ink">
              Cảnh báo tồn thấp ({stats.lowStockAlerts.length} mục)
            </h2>
          </header>
          <div className="max-h-[400px] overflow-y-auto">
            <PhanTrangBang>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted border-b text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Mặt hàng</th>
                    <th className="px-4 py-2 text-left">Cơ sở</th>
                    <th className="px-4 py-2 text-right">Tồn</th>
                    <th className="px-4 py-2 text-right">Ngưỡng</th>
                    <th className="px-4 py-2 text-right">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.lowStockAlerts.slice(0, 50).map((a) => (
                    <tr
                      key={`${a.itemId}-${a.centerId}`}
                      className={
                        "border-b " +
                        (a.severity === "CRITICAL"
                          ? "bg-state-danger-soft"
                          : "bg-state-warning-soft/60")
                      }
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium text-foreground">
                          {a.itemName}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {a.itemCode}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{a.centerName}</td>
                      <td
                        className={`px-4 py-2 text-right font-bold tabular-nums ${ a.severity === "CRITICAL" ? "text-state-danger-ink" : "text-state-warning-ink" }`}
                      >
                        {a.quantity} {a.unit}
                        {a.severity === "CRITICAL" && (
                          <span className="ml-1 text-[10px] uppercase tracking-wider">
                            (Hết)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {a.threshold}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          href={`/inventory/items/${a.itemId}/edit`}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          Mở →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
            {stats.lowStockAlerts.length > 50 && (
              <p className="border-t border-border bg-muted py-2 text-center text-xs text-muted-foreground">
                Hiển thị 50 mục đầu tiên · Tổng: {stats.lowStockAlerts.length}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <header className="border-b border-border bg-muted px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Tồn kho theo cơ sở
          </h2>
        </header>
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cơ sở
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Mặt hàng có tồn
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tổng giá trị
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cảnh báo thấp
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hoạt động gần nhất
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.centers.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    Chưa có cơ sở nào có tồn kho.
                  </td>
                </tr>
              ) : (
                stats.centers.map((c) => (
                  <tr key={c.centerId} className="hover:bg-muted/60">
                    <td className="px-4 py-2 font-medium text-foreground">
                      {c.centerName}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-foreground">
                      {c.distinctItems}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-foreground">
                      {formatVnd(c.totalValue)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right tabular-nums ${ c.lowStockItems > 0 ? "font-bold text-state-danger-ink" : "text-muted-foreground" }`}
                    >
                      {c.lowStockItems}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                      {formatRelative(c.lastActivity)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        {icon}
      </div>
      <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold ${ danger ? "text-state-danger-ink" : "text-foreground" }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
