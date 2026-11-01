import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { ProductForm } from "../../_components/product-form";

export const metadata = { title: "Sửa sản phẩm | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // products:manage chỉ HO_ACCOUNTANT (GLOBAL) — không cần target.
  if (!(await checkPermission("products:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;
  // Product/ZMRoboKit là catalog toàn cục (không scoped) — scopedDb pass-through.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const [product, zmroboKits] = await Promise.all([
    sdb.product.findUnique({ where: { id } }),
    sdb.zMRoboKit.findMany({
      where: { isPublished: true },
      select: { id: true, title: true, code: true },
      orderBy: { title: "asc" },
    }),
  ]);

  if (!product) notFound();

  return (
    <div>
      <Link
        href={`/products/${product.id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Quay lại chi tiết
      </Link>
      <h1 className="mb-1 text-2xl font-bold text-foreground">{product.name}</h1>
      <p className="mb-6 font-mono text-sm text-muted-foreground">{product.sku}</p>
      <ProductForm product={product} zmroboKits={zmroboKits} />
    </div>
  );
}
