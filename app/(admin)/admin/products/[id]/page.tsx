import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { Button } from "@/components/ui/button";
import {
  PRODUCT_CATEGORY_LABEL,
  PRODUCT_STATUS_LABEL,
  PRODUCT_STATUS_COLOR,
  PRODUCT_MOVEMENT_TYPE_LABEL,
} from "@/lib/validators/product";
import { AdjustStockButton } from "../_components/adjust-stock-button";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Chi tiết sản phẩm | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function ProductDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate trước khi fetch — products:view/manage không có centerId để scope theo (GLOBAL).
  if (!(await checkPermission("products:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // products:manage chỉ HO_ACCOUNTANT (GLOBAL) — không cần target.
  const canManage = await checkPermission("products:manage");
  const { id } = await params;

  // Product/ProductMovement là catalog + sổ kho SP toàn cục (không scoped) — pass-through.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const product = await sdb.product.findUnique({
    where: { id },
    include: {
      movements: { orderBy: { createdAt: "desc" }, take: 50 },
      zmroboKit: { select: { id: true, title: true, slug: true } },
    },
  });
  if (!product) notFound();

  const isLowStock = product.stockOnHand <= product.minThreshold;

  return (
    <div className="max-w-5xl space-y-6">
      <Link
        href="/products"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại danh sách
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{product.name}</h1>
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${PRODUCT_STATUS_COLOR[product.status]}`}
            >
              {PRODUCT_STATUS_LABEL[product.status]}
            </span>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            SKU: <span className="font-mono">{product.sku}</span> ·{" "}
            {PRODUCT_CATEGORY_LABEL[product.category]}
          </div>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <AdjustStockButton
              productId={product.id}
              currentStock={product.stockOnHand}
            />
            <Link href={`/products/${product.id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="h-4 w-4" />
                Sửa
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div
          className={
            "rounded-xl border p-4 " +
            (isLowStock
              ? "border-primary-soft bg-primary-soft"
              : "border-border bg-muted")
          }
        >
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Tồn kho
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {product.stockOnHand}
            {isLowStock && " ⚠️"}
          </div>
          <div className="text-xs text-muted-foreground">
            Ngưỡng cảnh báo: {product.minThreshold}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-state-info-soft p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Giá bán
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {product.salePrice.toLocaleString("vi-VN")}
          </div>
          <div className="text-xs text-muted-foreground">VND</div>
        </div>
        {product.rentalPricePerMonth != null && (
          <div className="rounded-xl border border-border bg-primary-soft p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Giá thuê/tháng
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">
              {product.rentalPricePerMonth.toLocaleString("vi-VN")}
            </div>
            <div className="text-xs text-muted-foreground">VND</div>
          </div>
        )}
        {product.costPrice != null && canManage && (
          <div className="rounded-xl border border-border bg-muted p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Giá vốn (nội bộ)
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums">
              {product.costPrice.toLocaleString("vi-VN")}
            </div>
          </div>
        )}
      </div>

      {product.description && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Mô tả
          </h2>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {product.description}
          </p>
        </section>
      )}

      {product.zmroboKit && (
        <section className="rounded-xl border border-border bg-card p-5 text-sm">
          🔗 Liên kết catalog kit:{" "}
          <Link
            href={`/kits/${product.zmroboKit.id}/edit`}
            className="text-state-info-ink hover:underline"
          >
            {product.zmroboKit.title}
          </Link>
        </section>
      )}

      {product.notes && (
        <section className="rounded-xl border border-state-warning-soft bg-state-warning-soft p-4 text-sm text-state-warning-ink">
          <strong>Ghi chú:</strong> {product.notes}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Lịch sử nhập / xuất ({product.movements.length})
        </h2>
        {product.movements.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/50 p-8 text-center">
            <p className="text-sm text-muted-foreground">Chưa có biến động kho</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <PhanTrangBang cuonNgang>
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Thời gian
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Loại
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Số lượng
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Trước → Sau
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Lý do
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Người
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {product.movements.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/60">
                      <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {PRODUCT_MOVEMENT_TYPE_LABEL[m.type]}
                      </td>
                      <td
                        className={
                          "px-3 py-2 text-right font-mono " +
                          (m.quantity > 0 ? "text-state-success-ink" : "text-state-danger-ink")
                        }
                      >
                        {m.quantity > 0 ? "+" : ""}
                        {m.quantity}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                        {m.stockBeforeMovement} → {m.stockAfterMovement}
                      </td>
                      <td className="px-3 py-2 text-xs text-foreground">
                        {m.reason ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-foreground">
                        {m.createdByName}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          </div>
        )}
      </section>
    </div>
  );
}
