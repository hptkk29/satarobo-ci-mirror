import Link from "next/link";
import {
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  Plus,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { InventoryCategory, type Prisma } from "@prisma/client";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NutXuat } from "@/components/admin/nut-xuat";

export const dynamic = "force-dynamic";

const CATEGORY_INFO: Record<InventoryCategory, { label: string; color: string }> = {
  MAINBOARD: { label: "Bo mạch", color: "bg-state-info-soft text-state-info-ink" },
  SENSOR: { label: "Cảm biến", color: "bg-state-info-soft text-state-info-ink" },
  MOTOR: { label: "Động cơ", color: "bg-primary-soft text-primary" },
  BATTERY: { label: "Pin", color: "bg-state-warning-soft text-state-warning-ink" },
  MECHANICAL: { label: "Cơ khí", color: "bg-muted text-foreground" },
  WIRE: { label: "Dây", color: "bg-state-warning-soft text-state-warning-ink" },
  TOOL: { label: "Dụng cụ", color: "bg-primary-soft text-primary" },
  CONSUMABLE: { label: "Vật tư", color: "bg-primary-soft text-primary" },
  ROBOSIM: { label: "Robosim", color: "bg-state-success-soft text-state-success-ink" },
  OTHER: { label: "Khác", color: "bg-muted text-muted-foreground" },
};

const VALID_CATEGORIES = Object.values(InventoryCategory);

interface SearchParams {
  searchParams: Promise<{
    q?: string;
    category?: string;
    isActive?: string;
  }>;
}

export default async function InventoryItemsPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("inventory:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const categoryFilter =
    sp.category && VALID_CATEGORIES.includes(sp.category as InventoryCategory)
      ? (sp.category as InventoryCategory)
      : undefined;
  // Default: only active. Pass isActive=all to see everything.
  const activeFilter: boolean | undefined =
    sp.isActive === "all" ? undefined : sp.isActive === "false" ? false : true;

  const where: Prisma.InventoryItemWhereInput = {
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(activeFilter !== undefined ? { isActive: activeFilter } : {}),
    ...(q
      ? {
          OR: [
            { itemCode: { contains: q, mode: "insensitive" as const } },
            { name: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  // Cách ly cơ sở: InventoryItem là catalog (không scoped), nhưng balances
  // (StockBalance ∈ SCOPED_MODELS) là nested include KHÔNG auto-scope (AC7)
  // → filter tay theo tầm nhìn cơ sở của actor (tổng tồn chỉ tính cơ sở nhìn thấy).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const visibleCenters = getModelVisibleCenterIds("StockBalance", actor);
  const balanceWhere =
    visibleCenters === "ALL" ? undefined : { centerId: { in: visibleCenters } };

  const items = await sdb.inventoryItem.findMany({
    where,
    include: {
      balances: {
        where: balanceWhere,
        select: {
          quantity: true,
          reserved: true,
          minThreshold: true,
          centerId: true,
        },
      },
    },
    orderBy: [{ category: "asc" }, { itemCode: "asc" }],
    take: 200,
  });

  const itemsView = items.map((item) => {
    const totalStock = item.balances.reduce((sum, b) => sum + b.quantity, 0);
    const totalReserved = item.balances.reduce(
      (sum, b) => sum + b.reserved,
      0,
    );
    const lowStockCount = item.balances.filter(
      (b) =>
        b.quantity < (b.minThreshold ?? item.defaultMinThreshold),
    ).length;
    return { ...item, totalStock, totalReserved, lowStockCount };
  });

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Boxes className="h-6 w-6 text-primary" />
            Kho — Học cụ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {itemsView.length > 0 ? `${itemsView.length} mặt hàng` : "Chưa có mặt hàng nào"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/inventory/items/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Thêm hàng
          </Link>
          <NutXuat ma="hoc-cu" />
          <Link
            href="/inventory/items/import"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Import Excel
          </Link>
          <Link
            href="/inventory/movements"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <History className="h-4 w-4" />
            Lịch sử
          </Link>
          <Link
            href="/inventory/audit"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <ClipboardCheck className="h-4 w-4" />
            Kiểm kê
          </Link>
          <Link
            href="/inventory/dashboard"
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary-soft bg-card px-4 py-2 text-sm font-semibold text-primary hover:bg-primary-soft"
          >
            <LayoutDashboard className="h-4 w-4" />
            Tổng quan
          </Link>
        </div>
      </div>

      <form
        method="GET"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Tìm mã hàng / tên..."
          className="lg:col-span-2 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <select
          name="category"
          defaultValue={categoryFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi danh mục</option>
          {Object.entries(CATEGORY_INFO).map(([v, { label }]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="isActive"
          defaultValue={sp.isActive ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Đang sử dụng (mặc định)</option>
          <option value="false">Không sử dụng</option>
          <option value="all">Tất cả</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 sm:col-span-2 lg:col-span-4"
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
                  Ảnh
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Mã / Tên
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Danh mục
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Đơn vị
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tổng tồn
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Đã đặt
                </th>
                <th className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cảnh báo
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {itemsView.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có mặt hàng nào khớp bộ lọc.{" "}
                    <Link
                      href="/inventory/items/new"
                      className="text-primary hover:underline"
                    >
                      Thêm hàng →
                    </Link>
                  </td>
                </tr>
              ) : (
                itemsView.map((item) => {
                  const catInfo = CATEGORY_INFO[item.category];
                  return (
                    <tr key={item.id} className="hover:bg-muted/60">
                      <td className="px-3 py-3">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="h-10 w-10 rounded border border-border object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground">
                            no img
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-foreground">{item.name}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {item.itemCode}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${catInfo.color}`}
                        >
                          {catInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-sm text-muted-foreground">
                        {item.unit}
                      </td>
                      <td className="px-3 py-3 text-right text-sm tabular-nums font-semibold text-foreground">
                        {item.totalStock}
                      </td>
                      <td className="px-3 py-3 text-right text-sm tabular-nums text-muted-foreground">
                        {item.totalReserved}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {item.lowStockCount > 0 ? (
                          <span className="inline-flex rounded-full bg-state-danger-soft px-2 py-0.5 text-xs font-semibold text-state-danger-ink">
                            {item.lowStockCount} cơ sở
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          href={`/inventory/items/${item.id}/edit`}
                          className="inline-flex items-center gap-1 rounded-md border border-primary-soft px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary-soft"
                        >
                          Sửa
                        </Link>
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
