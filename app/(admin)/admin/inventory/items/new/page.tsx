import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { redirect } from "next/navigation";
import { ItemForm } from "../_components/item-form";

export const dynamic = "force-dynamic";

export default async function NewInventoryItemPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("inventory:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/inventory/items"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại kho
        </Link>
        <h1 className="text-2xl font-bold text-foreground">Thêm mặt hàng mới</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sau khi tạo, hệ thống sẽ tự khởi tạo tồn = 0 cho mọi cơ sở đang hoạt
          động.
        </p>
      </div>

      <ItemForm />
    </div>
  );
}
