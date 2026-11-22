import Link from "next/link";
import { ChevronLeft, History } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { StockMovementType, type Prisma } from "@prisma/client";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";

const TYPE_INFO: Record<
  StockMovementType,
  { label: string; color: string; sign: "+" | "-" }
> = {
  RECEIPT: { label: "Nhập", color: "bg-state-success-soft text-state-success-ink", sign: "+" },
  ISSUE: { label: "Xuất", color: "bg-state-danger-soft text-state-danger-ink", sign: "-" },
  TRANSFER_OUT: {
    label: "Chuyển đi",
    color: "bg-state-warning-soft text-state-warning-ink",
    sign: "-",
  },
  TRANSFER_IN: {
    label: "Nhận về",
    color: "bg-state-info-soft text-state-info-ink",
    sign: "+",
  },
  ADJUSTMENT_INCREASE: {
    label: "Kiểm kê thừa",
    color: "bg-primary-soft text-primary",
    sign: "+",
  },
  ADJUSTMENT_DECREASE: {
    label: "Kiểm kê thiếu",
    color: "bg-primary-soft text-primary",
    sign: "-",
  },
};

const VALID_TYPES = Object.values(StockMovementType);

function fmtDateTime(d: Date) {
  return new Date(d).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtVnd(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

interface SearchParams {
  searchParams: Promise<{
    type?: string;
    itemId?: string;
    centerId?: string;
    from?: string;
    to?: string;
  }>;
}

export default async function MovementsPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("inventory:movement"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // Cách ly cơ sở: StockMovement ∈ SCOPED_MODELS → findMany tự inject
  // `centerId IN visibleCenterIds` (InventoryItem catalog / Center exempt — pass-through).
  const sdb = scopedDb(await resolveActor(session.user.id));

  const sp = await searchParams;
  const typeFilter =
    sp.type && VALID_TYPES.includes(sp.type as StockMovementType)
      ? (sp.type as StockMovementType)
      : undefined;
  const itemFilter = sp.itemId?.trim() || undefined;
  const centerFilter = sp.centerId?.trim() || undefined;

  const fromDate = sp.from ? new Date(sp.from) : null;
  const toDate = sp.to ? new Date(sp.to) : null;
  const dateRange: Prisma.DateTimeFilter | undefined =
    fromDate || toDate
      ? {
          ...(fromDate && !Number.isNaN(fromDate.getTime())
            ? { gte: fromDate }
            : {}),
          ...(toDate && !Number.isNaN(toDate.getTime())
            ? // include end-of-day
              {
                lte: new Date(
                  toDate.getFullYear(),
                  toDate.getMonth(),
                  toDate.getDate(),
                  23,
                  59,
                  59,
                ),
              }
            : {}),
        }
      : undefined;

  const where: Prisma.StockMovementWhereInput = {
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(itemFilter ? { itemId: itemFilter } : {}),
    ...(centerFilter ? { centerId: centerFilter } : {}),
    ...(dateRange ? { performedAt: dateRange } : {}),
  };

  const [movements, items, centers] = await Promise.all([
    sdb.stockMovement.findMany({
      where,
      include: {
        item: { select: { itemCode: true, name: true, unit: true } },
        center: { select: { name: true } },
        performedBy: { select: { fullName: true } },
        transferPair: {
          include: { center: { select: { name: true } } },
        },
      },
      orderBy: { performedAt: "desc" },
      take: 200,
    }),
    sdb.inventoryItem.findMany({
      orderBy: { itemCode: "asc" },
      select: { id: true, itemCode: true, name: true },
      take: 500,
    }),
    sdb.center.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/inventory/items"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại kho
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <History className="h-6 w-6 text-primary" />
          Lịch sử giao dịch kho
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {movements.length > 0
            ? `${movements.length} phiếu (tối đa 200 gần nhất)`
            : "Chưa có giao dịch nào khớp bộ lọc"}
        </p>
      </div>

      <form
        method="GET"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6"
      >
        <select
          name="type"
          defaultValue={typeFilter ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi loại</option>
          {Object.entries(TYPE_INFO).map(([v, { label }]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="itemId"
          defaultValue={itemFilter ?? ""}
          className="lg:col-span-2 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Mọi mặt hàng</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.itemCode} — {i.name}
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
        <input
          type="date"
          name="from"
          defaultValue={sp.from ?? ""}
          placeholder="Từ"
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <input
          type="date"
          name="to"
          defaultValue={sp.to ?? ""}
          placeholder="Đến"
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 sm:col-span-2 lg:col-span-6"
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
                  Thời gian
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Loại
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Mặt hàng
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cơ sở
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  SL
                </th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tiền
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tham chiếu
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Người làm
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {movements.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có giao dịch kho nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                movements.map((m) => {
                  const info = TYPE_INFO[m.type];
                  const pairCenterName = m.transferPair?.center?.name;
                  const referenceText =
                    (m.type === "TRANSFER_OUT" && pairCenterName
                      ? `→ ${pairCenterName}`
                      : m.type === "TRANSFER_IN" && pairCenterName
                        ? `← ${pairCenterName}`
                        : m.referenceNote) || "—";
                  return (
                    <tr key={m.id} className="hover:bg-muted/60">
                      <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">
                        {fmtDateTime(m.performedAt)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${info.color}`}
                        >
                          {info.label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-foreground text-sm">
                          {m.item.name}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {m.item.itemCode}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-muted-foreground">
                        {m.center.name}
                      </td>
                      <td
                        className={`px-3 py-3 text-right text-sm tabular-nums font-bold ${ info.sign === "+" ? "text-state-success-ink" : "text-state-danger-ink" }`}
                      >
                        {info.sign}
                        {m.quantity} {m.item.unit}
                      </td>
                      <td className="px-3 py-3 text-right text-xs tabular-nums text-muted-foreground">
                        {m.totalCost !== null
                          ? fmtVnd(m.totalCost)
                          : m.unitPrice !== null
                            ? fmtVnd(m.unitPrice)
                            : "—"}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground max-w-[200px]">
                        <div className="line-clamp-2">{referenceText}</div>
                        {m.notes && (
                          <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                            {m.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {m.performedBy?.fullName ?? "—"}
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
