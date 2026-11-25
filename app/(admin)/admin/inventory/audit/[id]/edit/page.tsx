import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import {
  BulkAuditForm,
  type AuditRowInit,
} from "../../_components/bulk-audit-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditAuditPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("inventory:audit"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { id } = await params;

  // Cách ly cơ sở: findUnique qua scopedDb — phiếu ngoài scope → null → notFound (chống IDOR).
  const sdb = scopedDb(await resolveActor(session.user.id));
  const audit = await sdb.inventoryAudit.findUnique({
    where: { id },
    include: {
      center: { select: { id: true, name: true } },
      items: true,
    },
  });
  if (!audit) notFound();
  if (audit.status !== "DRAFT") {
    redirect(`/inventory/audit/${id}`);
  }

  // Load every active item + this center's current balance.
  // InventoryItem là catalog (không scoped); balances đã filter tay theo
  // audit.centerId (nested include không auto-scope — AC7) và audit đã qua scope-gate.
  const items = await sdb.inventoryItem.findMany({
    where: { isActive: true },
    include: {
      balances: {
        where: { centerId: audit.centerId },
        select: { quantity: true },
      },
    },
    orderBy: [{ category: "asc" }, { itemCode: "asc" }],
  });

  // Map any existing draft lines to preserve user input across reloads.
  const existing = new Map(audit.items.map((line) => [line.itemId, line]));

  const rows: AuditRowInit[] = items.map((item) => {
    const draftLine = existing.get(item.id);
    const currentQty = item.balances[0]?.quantity ?? 0;
    return {
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.name,
      unit: item.unit,
      category: item.category,
      previousQty: draftLine?.previousQty ?? currentQty,
      actualQty: draftLine?.actualQty ?? currentQty,
      reason: draftLine?.reason ?? "",
    };
  });

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/inventory/audit"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="text-2xl font-bold text-foreground">
          Kiểm kê:{" "}
          <span className="font-bold text-primary">
            {audit.center.name}
          </span>
        </h1>
        {audit.notes && (
          <p className="mt-1 text-sm text-muted-foreground">{audit.notes}</p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-state-warning-soft bg-state-warning-soft p-4 text-sm text-state-warning-ink">
          Chưa có mặt hàng active nào. Tạo / kích hoạt mặt hàng trước tại{" "}
          <Link
            href="/inventory/items"
            className="font-semibold underline hover:text-state-warning-ink"
          >
            /admin/inventory/items
          </Link>
          .
        </div>
      ) : (
        <BulkAuditForm
          auditId={audit.id}
          centerName={audit.center.name}
          auditCode={audit.auditCode}
          rows={rows}
        />
      )}
    </div>
  );
}
