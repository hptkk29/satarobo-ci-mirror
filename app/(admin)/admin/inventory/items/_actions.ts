"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { z } from "zod";
import {
  inventoryItemSchema,
  type InventoryItemInput,
} from "@/lib/validators/inventory";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type Sdb = ReturnType<typeof scopedDb>;

// Cách ly cơ sở (A0-04): InventoryItem là catalog toàn cục (không scoped — pass-through);
// StockBalance ∈ SCOPED_MODELS → mutation theo centerId từ client phải guard passesScope.
async function requireRole(): Promise<
  | { ok: true; actor: Actor; sdb: Sdb }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("inventory:edit"))) {
    return { ok: false, error: "Không có quyền quản lý kho" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, actor, sdb: scopedDb(actor) };
}

export async function createItem(
  input: InventoryItemInput,
): Promise<Result<{ itemId: string }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const existing = await gate.sdb.inventoryItem.findUnique({
    where: { itemCode: data.itemCode },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: `Mã hàng "${data.itemCode}" đã tồn tại` };
  }

  // Center/OrgUnit ∈ SCOPE_EXEMPT — pass-through. Khởi tạo balance=0 cho MỌI cơ sở
  // là 1 phần của việc tạo catalog item (giữ nguyên hành vi, không phải IDOR ghi).
  const centers = await gate.sdb.center.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  // PR-C dual-write: map Center → OrgUnit(CENTER) để ghi kèm orgUnitId trên
  // StockBalance (scopedDb còn đọc centerId tới khi flip ở PR-D).
  const orgUnitRows = await gate.sdb.orgUnit.findMany({
    where: { centerId: { not: null }, deletedAt: null },
    select: { id: true, centerId: true },
  });
  const orgUnitByCenter = new Map(
    orgUnitRows.map((o) => [o.centerId as string, o.id]),
  );

  try {
    const created = await gate.sdb.$transaction(async (tx) => {
      const item = await tx.inventoryItem.create({
        data,
        select: { id: true },
      });
      if (centers.length > 0) {
        await tx.stockBalance.createMany({
          data: centers.map((c) => ({
            itemId: item.id,
            centerId: c.id,
            orgUnitId: orgUnitByCenter.get(c.id) ?? null,
            quantity: 0,
            reserved: 0,
          })),
        });
      }
      return item;
    });
    revalidatePath("/inventory/items");
    return { ok: true, data: { itemId: created.id } };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

export async function createItemAndRedirect(input: InventoryItemInput) {
  const res = await createItem(input);
  if (!res.ok) return res;
  redirect(`/inventory/items/${res.data!.itemId}/edit`);
}

export async function updateItem(
  id: string,
  input: InventoryItemInput,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = inventoryItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const current = await gate.sdb.inventoryItem.findUnique({
    where: { id },
    select: { itemCode: true },
  });
  if (!current) return { ok: false, error: "Không tìm thấy hàng" };

  if (data.itemCode !== current.itemCode) {
    const dup = await gate.sdb.inventoryItem.findUnique({
      where: { itemCode: data.itemCode },
      select: { id: true },
    });
    if (dup && dup.id !== id) {
      return { ok: false, error: `Mã hàng "${data.itemCode}" đã tồn tại` };
    }
  }

  try {
    await gate.sdb.inventoryItem.update({ where: { id }, data });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/inventory/items");
  revalidatePath(`/inventory/items/${id}/edit`);
  return { ok: true };
}

export async function deleteItem(id: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  // ⚠️ Integrity check TOÀN CỤC (mọi cơ sở, kể cả ngoài scope actor): đọc balances
  // qua nested include trên InventoryItem (catalog, không scoped) — nested include
  // KHÔNG bị auto-scope (AC7) nên vẫn thấy tồn ở cơ sở khác. Nếu scope check này
  // theo actor, CM có thể xoá item còn tồn ở cơ sở khác (mất dữ liệu kho).
  const itemWithStock = await gate.sdb.inventoryItem.findUnique({
    where: { id },
    select: {
      balances: {
        where: { OR: [{ quantity: { gt: 0 } }, { reserved: { gt: 0 } }] },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (itemWithStock && itemWithStock.balances.length > 0) {
    return {
      ok: false,
      error:
        "Còn tồn (quantity hoặc reserved > 0) ở ít nhất một cơ sở. Xuất hết hoặc giảm tồn về 0 trước khi xoá.",
    };
  }

  try {
    await gate.sdb.inventoryItem.delete({ where: { id } });
  } catch (err) {
    return {
      ok: false,
      error: `Không xoá được: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/inventory/items");
  return { ok: true };
}

export async function deleteItemAndRedirect(id: string): Promise<Result> {
  const res = await deleteItem(id);
  if (!res.ok) return res;
  redirect("/inventory/items");
}

const ThresholdSchema = z.object({
  itemId: z.string().min(1),
  centerId: z.string().min(1),
  minThreshold: z
    .union([z.coerce.number().int().min(0), z.null()])
    .optional()
    .transform((v) => (v === undefined ? null : v)),
});

export async function updateMinThreshold(
  input: z.infer<typeof ThresholdSchema>,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = ThresholdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Tham số không hợp lệ" };
  }

  // Cách ly cơ sở (ghi): StockBalance ∈ SCOPED_MODELS — chặn sửa ngưỡng cơ sở
  // ngoài tầm nhìn của actor (update không bị extension chặn nên guard tay).
  if (!passesScope("StockBalance", { centerId: parsed.data.centerId }, gate.actor)) {
    return { ok: false, error: "Không có quyền sửa tồn kho cơ sở này" };
  }

  try {
    await gate.sdb.stockBalance.update({
      where: {
        itemId_centerId: {
          itemId: parsed.data.itemId,
          centerId: parsed.data.centerId,
        },
      },
      data: { minThreshold: parsed.data.minThreshold },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath(`/inventory/items/${parsed.data.itemId}/edit`);
  return { ok: true };
}

// Initialize StockBalance=0 for a newly-active center across all items.
// Called manually after activating a center; safe to re-run thanks to
// skipDuplicates on the unique (itemId, centerId).
export async function syncBalancesForCenter(
  centerId: string,
): Promise<Result<{ created: number }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  // Cách ly cơ sở (ghi): chỉ khởi tạo balance cho cơ sở trong tầm nhìn của actor.
  if (!passesScope("StockBalance", { centerId }, gate.actor)) {
    return { ok: false, error: "Không có quyền khởi tạo tồn kho cơ sở này" };
  }

  const items = await gate.sdb.inventoryItem.findMany({ select: { id: true } });
  if (items.length === 0) return { ok: true, data: { created: 0 } };

  // PR-C dual-write: suy orgUnitId của cơ sở để ghi kèm (giữ centerId tới PR-D).
  const orgUnitId = await orgUnitIdForCenter(centerId);

  try {
    const result = await gate.sdb.stockBalance.createMany({
      data: items.map((i) => ({
        itemId: i.id,
        centerId,
        orgUnitId,
        quantity: 0,
        reserved: 0,
      })),
      skipDuplicates: true,
    });
    return { ok: true, data: { created: result.count } };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}
