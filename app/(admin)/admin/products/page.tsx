import Link from "next/link";
import { Plus, Package2 } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  ProductCategory,
  ProductStatus,
  type Prisma,
  type Product,
} from "@prisma/client";
import {
  PRODUCT_CATEGORY_LABEL,
  PRODUCT_STATUS_LABEL,
  PRODUCT_STATUS_COLOR,
} from "@/lib/validators/product";
import { ChonSoDong } from "@/components/ui/chon-so-dong";
import { docSoDong } from "@/lib/ui/phan-trang";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";

export const metadata = { title: "Sản phẩm | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    q?: string;
    category?: string;
    status?: string;
    lowStock?: string;
    page?: string;
    size?: string;
  }>;
}

const CATEGORIES = Object.values(ProductCategory) as ProductCategory[];
const STATUSES = Object.values(ProductStatus) as ProductStatus[];

export default async function ProductsPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate list-level (nhiều sản phẩm) — không có 1 centerId cụ thể, không truyền target.
  if (!(await checkPermission("products:view"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // products:manage chỉ HO_ACCOUNTANT (GLOBAL) — không cần target.
  const canManage = await checkPermission("products:manage");
  // Product là catalog toàn cục (không scoped) — scopedDb pass-through.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const categoryParam = CATEGORIES.includes(sp.category as ProductCategory)
    ? (sp.category as ProductCategory)
    : undefined;
  const statusParam = STATUSES.includes(sp.status as ProductStatus)
    ? (sp.status as ProductStatus)
    : undefined;
  const lowStock = sp.lowStock === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const soDong = docSoDong(sp.size);

  const where: Prisma.ProductWhereInput = {};
  if (q) {
    where.OR = [
      { sku: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }
  if (categoryParam) where.category = categoryParam;
  if (statusParam) where.status = statusParam;

  // lowStock filter: stockOnHand <= minThreshold. Prisma doesn't support
  // field-to-field comparison in WHERE — workaround: fetch then JS-filter.
  // Acceptable for catalog sizes under a few hundred items.
  let products: Product[];
  let totalCount: number;

  if (lowStock) {
    const all = await sdb.product.findMany({
      where: { ...where, status: { in: ["ACTIVE", "PAUSED"] } },
      orderBy: { name: "asc" },
    });
    const filtered = all.filter((p) => p.stockOnHand <= p.minThreshold);
    totalCount = filtered.length;
    products = filtered.slice((page - 1) * soDong, page * soDong);
  } else {
    const [count, rows] = await Promise.all([
      sdb.product.count({ where }),
      sdb.product.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * soDong,
        take: soDong,
      }),
    ]);
    totalCount = count;
    products = rows;
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / soDong));

  function urlFor(
    p: Partial<{
      q: string;
      category: string;
      status: string;
      lowStock: string;
      page: number;
    }>,
  ): string {
    const u = new URLSearchParams();
    if (p.q) u.set("q", p.q);
    if (p.category) u.set("category", p.category);
    if (p.status) u.set("status", p.status);
    if (p.lowStock) u.set("lowStock", p.lowStock);
    if (p.page && p.page > 1) u.set("page", String(p.page));
    return `/products${u.toString() ? "?" + u.toString() : ""}`;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
            <Package2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Sản phẩm</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Catalog sản phẩm bán/cho thuê (kits, sensors, mission blocks,
              accessories)
            </p>
          </div>
        </div>
        {canManage && (
          <Link
            href="/products/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark"
          >
            <Plus className="h-4 w-4" />
            Thêm sản phẩm
          </Link>
        )}
      </div>

      {/* Quick filter chips */}
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link
          href={urlFor({
            q,
            category: categoryParam,
            status: statusParam,
          })}
          // Chip lọc nhanh: vẫn ở /products, chỉ bỏ/thêm `?lowStock`. Giữ chỗ đang xem.
          scroll={false}
          className={
            "rounded-full px-3 py-1 " +
            (!lowStock
              ? "bg-state-info-soft text-state-info-ink"
              : "border border-border bg-card text-muted-foreground hover:bg-muted")
          }
        >
          Tất cả
        </Link>
        <Link
          href={urlFor({
            q,
            category: categoryParam,
            status: statusParam,
            lowStock: "1",
          })}
          scroll={false}
          className={
            "rounded-full px-3 py-1 " +
            (lowStock
              ? "bg-primary-soft text-primary"
              : "border border-border bg-card text-muted-foreground hover:bg-muted")
          }
        >
          ⚠️ Sắp hết hàng
        </Link>
      </div>

      <form
        method="GET"
        className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
      >
        {lowStock && <input type="hidden" name="lowStock" value="1" />}
        <input
          name="q"
          defaultValue={q}
          placeholder="SKU hoặc tên..."
          className="lg:col-span-2 rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <select
          name="category"
          defaultValue={categoryParam ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Tất cả loại</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {PRODUCT_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={statusParam ?? ""}
          className="rounded-lg border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
        >
          <option value="">Tất cả trạng thái</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {PRODUCT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          Áp dụng
        </button>
      </form>

      <div className="mb-2 text-sm text-muted-foreground">
        {totalCount.toLocaleString("vi-VN")} sản phẩm
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  SKU
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tên
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Loại
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Giá bán
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Thuê/tháng
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tồn kho
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Trạng thái
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Không có sản phẩm nào
                  </td>
                </tr>
              ) : (
                products.map((p) => {
                  const isLow = p.stockOnHand <= p.minThreshold;
                  return (
                    <tr key={p.id} className="hover:bg-muted/60">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {p.sku}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        <Link
                          href={`/products/${p.id}`}
                          className="hover:underline"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {PRODUCT_CATEGORY_LABEL[p.category]}
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums">
                        {p.salePrice.toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-muted-foreground">
                        {p.rentalPricePerMonth != null
                          ? p.rentalPricePerMonth.toLocaleString("vi-VN")
                          : "—"}
                      </td>
                      <td
                        className={
                          "px-4 py-3 text-right text-sm tabular-nums " +
                          (isLow ? "font-bold text-primary" : "")
                        }
                      >
                        {p.stockOnHand}
                        {isLow && " ⚠️"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${PRODUCT_STATUS_COLOR[p.status]}`}
                        >
                          {PRODUCT_STATUS_LABEL[p.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canManage && (
                          <Link
                            href={`/products/${p.id}/edit`}
                            className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            Sửa
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalCount > 0 && (
        <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <ChonSoDong soDong={soDong} tong={totalCount} tenDonVi="sản phẩm" />
            <span>
              Trang {page}/{totalPages}
            </span>
          </div>
          <DieuHuongTrangLink
            trang={page}
            soTrang={totalPages}
            hrefCua={(n: number) =>
              urlFor({
                q,
                category: categoryParam,
                status: statusParam,
                lowStock: lowStock ? "1" : undefined,
                page: n,
              })
            }
          />
        </div>
      )}
    </div>
  );
}
