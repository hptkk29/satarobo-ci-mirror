"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { centerIdForOrgUnit } from "@/lib/org/org-service";
import {
  startAuditSchema,
  saveAuditDraftSchema,
  type StartAuditInput,
  type SaveAuditDraftInput,
} from "@/lib/validators/inventory";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

type Sdb = ReturnType<typeof scopedDb>;

// Cách ly cơ sở (A0-04): InventoryAudit ∈ SCOPED_MODELS — đọc qua scopedDb(actor)
// (findUnique chống IDOR chéo cơ sở); ghi guard bằng passesScope trước khi tạo.
async function requireRole(): Promise<
  | { ok: true; userId: string; actor: Actor; sdb: Sdb }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("inventory:audit"))) {
    return { ok: false, error: "Không có quyền kiểm kê" };
  }
  const actor = await resolveActor(session.user.id);
  return { ok: true, userId: session.user.id ?? "", actor, sdb: scopedDb(actor) };
}

async function resolveEmployeeId(sdb: Sdb, userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    // User ∈ SCOPE_EXEMPT (identity) — scopedDb pass-through.
    const u = await sdb.user.findUnique({
      where: { id: userId },
      select: { employeeId: true },
    });
    return u?.employeeId ?? null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// startAudit — create DRAFT row, redirect to edit
// ──────────────────────────────────────────────────────────────────────────

export async function startAudit(
  input: StartAuditInput,
): Promise<Result<{ auditId: string }>> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = startAuditSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  if (data.auditCode) {
    // Dup-check qua scopedDb: phiếu trùng ở cơ sở ngoài scope → null, nhưng unique
    // constraint DB vẫn chặn ở create (trả lỗi DB thay vì message thân thiện).
    const dup = await gate.sdb.inventoryAudit.findUnique({
      where: { auditCode: data.auditCode },
      select: { id: true },
    });
    if (dup) {
      return { ok: false, error: `Mã phiếu "${data.auditCode}" đã tồn tại` };
    }
  }

  // PR-C: orgUnitId là nguồn chính; centerId suy ra để dual-write (HO loại khỏi
  // picker nên CENTER luôn có centerId — guard để chắc chắn còn ràng buộc NOT NULL).
  const orgUnitId = data.orgUnitId;
  const centerId = await centerIdForOrgUnit(orgUnitId);
  if (!centerId) {
    return { ok: false, error: "Đơn vị không hợp lệ (không gắn cơ sở kho)" };
  }

  // Cách ly cơ sở (ghi): chỉ tạo phiếu kiểm kê cho cơ sở trong tầm nhìn của actor.
  if (!passesScope("InventoryAudit", { centerId }, gate.actor)) {
    return { ok: false, error: "Không có quyền kiểm kê cơ sở này" };
  }

  try {
    const audit = await gate.sdb.inventoryAudit.create({
      data: {
        centerId,
        orgUnitId,
        auditCode: data.auditCode,
        notes: data.notes,
        status: "DRAFT",
      },
      select: { id: true },
    });
    revalidatePath("/inventory/audit");
    return { ok: true, data: { auditId: audit.id } };
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
}

export async function startAuditAndRedirect(input: StartAuditInput) {
  const res = await startAudit(input);
  if (!res.ok) return res;
  redirect(`/inventory/audit/${res.data!.auditId}/edit`);
}

// ──────────────────────────────────────────────────────────────────────────
// saveAuditDraft — delete-and-recreate audit lines for the given audit
// ──────────────────────────────────────────────────────────────────────────

export async function saveAuditDraft(
  input: SaveAuditDraftInput,
): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = saveAuditDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { auditId, lines } = parsed.data;

  // findUnique qua scopedDb: phiếu ngoài scope cơ sở → null (chống IDOR).
  const audit = await gate.sdb.inventoryAudit.findUnique({
    where: { id: auditId },
    select: { status: true },
  });
  if (!audit) return { ok: false, error: "Phiếu kiểm kê không tồn tại" };
  if (audit.status !== "DRAFT") {
    return { ok: false, error: "Chỉ phiếu DRAFT mới sửa được" };
  }

  // Dedupe by itemId so a stray duplicate row doesn't blow up the unique
  // (auditId, itemId) constraint inside the transaction.
  const byItem = new Map<string, (typeof lines)[number]>();
  for (const line of lines) byItem.set(line.itemId, line);
  const deduped = Array.from(byItem.values());

  try {
    await gate.sdb.$transaction(async (tx) => {
      await tx.inventoryAuditItem.deleteMany({ where: { auditId } });
      if (deduped.length === 0) return;
      await tx.inventoryAuditItem.createMany({
        data: deduped.map((line) => ({
          auditId,
          itemId: line.itemId,
          previousQty: line.previousQty,
          actualQty: line.actualQty,
          delta: line.actualQty - line.previousQty,
          reason: line.reason,
        })),
      });
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath(`/inventory/audit/${auditId}/edit`);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// submitAudit — create ADJUSTMENT movements + update balances atomically,
// then flip status to COMPLETED with snapshot stats.
// ──────────────────────────────────────────────────────────────────────────

export async function submitAudit(auditId: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  // findUnique qua scopedDb: phiếu ngoài scope cơ sở → null (chống IDOR).
  const audit = await gate.sdb.inventoryAudit.findUnique({
    where: { id: auditId },
    include: { items: true },
  });
  if (!audit) return { ok: false, error: "Phiếu kiểm kê không tồn tại" };
  if (audit.status !== "DRAFT") {
    return { ok: false, error: "Chỉ phiếu DRAFT mới submit được" };
  }
  if (audit.items.length === 0) {
    return { ok: false, error: "Phiếu chưa có dòng nào — quay lại lưu nháp trước" };
  }

  // Validate reason on every non-zero delta row.
  for (const line of audit.items) {
    if (line.delta !== 0) {
      if (!line.reason || line.reason.trim().length < 5) {
        return {
          ok: false,
          error:
            "Mỗi dòng có Δ ≠ 0 phải có lý do ≥ 5 ký tự. Quay lại Lưu nháp, điền lý do, rồi Submit.",
        };
      }
    }
  }

  const performedById = await resolveEmployeeId(gate.sdb, gate.userId);
  const now = new Date();

  let totalAdjusted = 0;
  let totalIncreases = 0;
  let totalDecreases = 0;

  try {
    // Giữ NGUYÊN cấu trúc transaction (movement + balance + audit atomic) — chỉ đổi
    // nguồn client. audit đã qua scope-gate nên audit.centerId thuộc tầm nhìn actor.
    await gate.sdb.$transaction(async (tx) => {
      for (const line of audit.items) {
        if (line.delta === 0) continue;
        totalAdjusted += 1;
        const absDelta = Math.abs(line.delta);
        if (line.delta > 0) totalIncreases += absDelta;
        else totalDecreases += absDelta;

        const movement = await tx.stockMovement.create({
          data: {
            itemId: line.itemId,
            centerId: audit.centerId,
            type:
              line.delta > 0
                ? "ADJUSTMENT_INCREASE"
                : "ADJUSTMENT_DECREASE",
            quantity: absDelta,
            referenceType: "InventoryAudit",
            referenceId: audit.id,
            referenceNote: `Kiểm kê: ${line.previousQty} → ${line.actualQty}`,
            notes: line.reason ?? `Audit ${audit.auditCode ?? audit.id}`,
            performedById,
            performedAt: now,
          },
          select: { id: true },
        });

        await tx.stockBalance.update({
          where: {
            itemId_centerId: {
              itemId: line.itemId,
              centerId: audit.centerId,
            },
          },
          data: { quantity: line.actualQty },
        });

        await tx.inventoryAuditItem.update({
          where: { id: line.id },
          data: { movementId: movement.id },
        });
      }

      await tx.inventoryAudit.update({
        where: { id: auditId },
        data: {
          status: "COMPLETED",
          performedById,
          performedAt: now,
          totalItems: audit.items.length,
          totalAdjusted,
          totalIncreases,
          totalDecreases,
        },
      });
    });
  } catch (err) {
    return {
      ok: false,
      error: `Submit thất bại: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath("/inventory/audit");
  revalidatePath(`/inventory/audit/${auditId}`);
  revalidatePath(`/inventory/audit/${auditId}/edit`);
  revalidatePath("/inventory/dashboard");
  revalidatePath("/inventory/movements");
  revalidatePath("/inventory/items");
  return { ok: true };
}

export async function submitAuditAndRedirect(auditId: string) {
  const res = await submitAudit(auditId);
  if (!res.ok) return res;
  redirect(`/inventory/audit/${auditId}`);
}

// ──────────────────────────────────────────────────────────────────────────
// cancelAudit — DRAFT → CANCELLED (no movement / balance side effects)
// ──────────────────────────────────────────────────────────────────────────

export async function cancelAudit(auditId: string): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  // findUnique qua scopedDb: phiếu ngoài scope cơ sở → null (chống IDOR).
  const audit = await gate.sdb.inventoryAudit.findUnique({
    where: { id: auditId },
    select: { status: true },
  });
  if (!audit) return { ok: false, error: "Phiếu không tồn tại" };
  if (audit.status !== "DRAFT") {
    return { ok: false, error: "Chỉ phiếu DRAFT mới huỷ được" };
  }

  try {
    await gate.sdb.inventoryAudit.update({
      where: { id: auditId },
      data: { status: "CANCELLED" },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }
  revalidatePath("/inventory/audit");
  revalidatePath(`/inventory/audit/${auditId}/edit`);
  return { ok: true };
}

export async function cancelAuditAndRedirect(auditId: string): Promise<Result> {
  const res = await cancelAudit(auditId);
  if (!res.ok) return res;
  redirect("/inventory/audit");
}
