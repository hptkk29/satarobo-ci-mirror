import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import {
  ItemForm,
  type BalanceRow,
  type ItemFormValue,
} from "../../_components/item-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditInventoryItemPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("inventory:edit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;

  const actor = await resolveActor(session.user.id);
  // Cách ly cơ sở: StockBalance ∈ SCOPED_MODELS → findMany tự inject
  // `centerId IN visibleCenterIds` (InventoryItem là catalog — pass-through).
  const sdb = scopedDb(actor);
  const [item, balances, selectableOrgUnits] = await Promise.all([
    sdb.inventoryItem.findUnique({ where: { id } }),
    sdb.stockBalance.findMany({
      where: { itemId: id },
      include: { center: { select: { name: true, displayOrder: true } } },
      orderBy: { center: { displayOrder: "asc" } },
    }),
    // PR-C: nguồn cơ sở qua OrgUnit tree (loại HO). Giữ id = centerId vì StockBalance
    // + movement (Nhập/Xuất/Chuyển) còn khoá theo centerId tới khi flip ở PR-D.
    getSelectableOrgUnits(actor, { types: ["CENTER"] }),
  ]);

  if (!item) notFound();

  const allCenters = selectableOrgUnits
    .filter((o) => o.centerId)
    .map((o) => ({ id: o.centerId as string, name: o.name }));

  const formValue: ItemFormValue = {
    id: item.id,
    itemCode: item.itemCode,
    name: item.name,
    description: item.description,
    category: item.category,
    unit: item.unit,
    pricePerUnit: item.pricePerUnit,
    supplier: item.supplier,
    defaultMinThreshold: item.defaultMinThreshold,
    imageUrl: item.imageUrl,
    tags: item.tags,
    isActive: item.isActive,
    notes: item.notes,
  };

  const balanceRows: BalanceRow[] = balances.map((b) => ({
    id: b.id,
    centerId: b.centerId,
    centerName: b.center.name,
    quantity: b.quantity,
    reserved: b.reserved,
    minThreshold: b.minThreshold,
  }));

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/inventory/items"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại kho
        </Link>
        <h1 className="text-2xl font-bold text-foreground">
          Sửa mặt hàng:{" "}
          <span className="font-bold text-primary">{item.name}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">{item.itemCode}</p>
      </div>

      <ItemForm
        item={formValue}
        balances={balanceRows}
        allCenters={allCenters}
      />
    </div>
  );
}
