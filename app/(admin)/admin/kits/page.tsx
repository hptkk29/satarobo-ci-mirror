import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Package } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { KitListRow } from "./_components/kit-list-row";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";

export default async function KitsAdminPage() {
  // A0-04: layout admin đã gate auth; cần session để dựng actor cho scopedDb.
  // ZMRoboKit là catalog toàn cục (không scoped) — pass-through.
  const session = await auth();
  if (!session?.user) redirect("/login");
  const sdb = scopedDb(await resolveActor(session.user.id));

  const kits = await sdb.zMRoboKit.findMany({
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      subtitle: true,
      brand: true,
      series: true,
      code: true,
      priceDisplay: true,
      mainImage: true,
      galleryImages: true,
      isAvailable: true,
      isPublished: true,
    },
  });

  const publishedCount = kits.filter((k) => k.isPublished).length;
  const unavailableCount = kits.filter((k) => !k.isAvailable).length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-black text-foreground">
            <Package className="h-7 w-7 text-primary" />
            Học Cụ (ZMRobo Kits)
          </h1>
          <p className="mt-1 text-muted-foreground">
            Quản lý catalog kit · {publishedCount}/{kits.length} published
            {unavailableCount > 0 && (
              <span className="ml-2 text-state-danger-ink">· {unavailableCount} hết hàng</span>
            )}
          </p>
        </div>
        <Link
          href="/kits/new"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 font-bold text-white shadow-md hover:bg-primary-dark"
        >
          <Plus className="h-5 w-5" />
          Thêm Kit
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <PhanTrangBang cuonNgang>
          <table className="w-full">
            <thead className="border-b border-border bg-muted text-left">
              <tr>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">Sản phẩm</th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">Brand / Series</th>
                <th className="p-4 text-center text-xs font-bold uppercase tracking-wider text-foreground">Thư viện ảnh</th>
                <th className="p-4 text-xs font-bold uppercase tracking-wider text-foreground">Giá</th>
                <th className="p-4 text-center text-xs font-bold uppercase tracking-wider text-foreground">Trạng thái</th>
                <th className="p-4 text-right text-xs font-bold uppercase tracking-wider text-foreground">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {kits.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-muted-foreground">
                    Chưa có kit nào.{" "}
                    <Link href="/kits/new" className="text-primary hover:underline">
                      Thêm kit đầu tiên →
                    </Link>
                  </td>
                </tr>
              ) : (
                kits.map((k) => <KitListRow key={k.id} kit={k} />)
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
