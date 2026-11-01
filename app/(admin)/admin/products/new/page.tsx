import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ProductForm } from "../_components/product-form";

export const metadata = { title: "Thêm sản phẩm | Admin" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // products:manage chỉ HO_ACCOUNTANT (GLOBAL) — không cần target.
  if (!(await checkPermission("products:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }

  // ZMRoboKit là catalog toàn cục (không scoped) — scopedDb pass-through.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const zmroboKits = await sdb.zMRoboKit.findMany({
    where: { isPublished: true },
    select: { id: true, title: true, code: true },
    orderBy: { title: "asc" },
  });

  return (
    <div>
      <Link
        href="/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại danh sách
      </Link>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Thêm sản phẩm</h1>
      <ProductForm zmroboKits={zmroboKits} />
    </div>
  );
}
