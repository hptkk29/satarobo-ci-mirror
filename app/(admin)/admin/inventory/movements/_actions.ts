"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import {
  receiptSchema,
  issueSchema,
  transferSchema,
  adjustmentSchema,
  type ReceiptInput,
  type IssueInput,
  type TransferInput,
  type AdjustmentInput,
} from "@/lib/validators/inventory";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * FIX-C4 — Lỗi nghiệp vụ mang MÃ/thông điệp để FE map (STOCK_INSUFFICIENT →
 * "Không đủ tồn"). Throw trong tx để rollback; catch trả `{ ok:false, error }`.
 */
class MovementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MovementError";
  }
}

type Sdb = ReturnType<typeof scopedDb>;

/**
 * FIX-C4 — Transaction Serializable + retry khi xung đột ghi (Prisma P2034 /
 * Postgres 40001). Dùng cho kiểm kê (đọc tồn → tính delta → ghi) phải nhất quán.
 * A0-04: chạy trên scopedDb — cast tx (extended client không structurally-assignable
 * vào Prisma.TransactionClient; runtime read-hook vẫn scope — tiền lệ students/classes).
 */
async function runSerializable<T>(
  sdb: Sdb,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sdb.$transaction(
        async (tx) => fn(tx as unknown as Prisma.TransactionClient),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      const isConflict =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2034";
      if (isConflict && attempt < 2) continue;
      throw err;
    }
  }
}

// Cách ly cơ sở (A0-04): StockBalance/StockMovement ∈ SCOPED_MODELS. Mọi movement
// đều gate bằng read StockBalance qua scopedDb (findUnique chống IDOR → cơ sở
// ngoài tầm nhìn trả null) TRƯỚC khi ghi — nên phần ghi trong tx giữ nguyên.
async function requireRole(): Promise<
  | { ok: true; userId: string; actor: Actor; sdb: Sdb }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("inventory:movement"))) {
    return { ok: false, error: "Không có quyền ghi nhận giao dịch kho" };
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

function revalidateAfterMovement(itemId: string) {
  revalidatePath("/inventory/items");
  revalidatePath("/inventory/movements");
  revalidatePath(`/inventory/items/${itemId}/edit`);
}

// ──────────────────────────────────────────────────────────────────────────
// RECEIPT — nhập kho
// ──────────────────────────────────────────────────────────────────────────

export async function recordReceipt(input: ReceiptInput): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  // Scope-gate (chống IDOR ghi): balance cơ sở ngoài tầm nhìn → null → chặn.
  const balance = await gate.sdb.stockBalance.findUnique({
    where: {
      itemId_centerId: { itemId: data.itemId, centerId: data.centerId },
    },
    select: { id: true },
  });
  if (!balance) {
    return {
      ok: false,
      error: "Chưa có bản ghi tồn kho cho cặp item × cơ sở. Mở item và Lưu để tự khởi tạo.",
    };
  }

  const totalCost =
    data.unitPrice !== null ? data.unitPrice * data.quantity : null;
  const performedById = await resolveEmployeeId(gate.sdb, gate.userId);

  try {
    await gate.sdb.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          itemId: data.itemId,
          centerId: data.centerId,
          type: "RECEIPT",
          quantity: data.quantity,
          unitPrice: data.unitPrice,
          totalCost,
          referenceType: "Supplier",
          referenceNote: data.referenceNote,
          notes: data.notes,
          performedById,
        },
      });
      await tx.stockBalance.update({
        where: {
          itemId_centerId: { itemId: data.itemId, centerId: data.centerId },
        },
        data: {
          quantity: { increment: data.quantity },
          lastReceiptAt: new Date(),
        },
      });
    });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidateAfterMovement(data.itemId);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// ISSUE — xuất kho
// ──────────────────────────────────────────────────────────────────────────

export async function recordIssue(input: IssueInput): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  // Scope-gate (chống IDOR ghi): balance cơ sở ngoài tầm nhìn → null → chặn.
  const balance = await gate.sdb.stockBalance.findUnique({
    where: {
      itemId_centerId: { itemId: data.itemId, centerId: data.centerId },
    },
    select: { quantity: true },
  });
  if (!balance) {
    return { ok: false, error: "Chưa có bản ghi tồn kho cho cặp item × cơ sở" };
  }

  const performedById = await resolveEmployeeId(gate.sdb, gate.userId);

  // FIX-C4 — decrement có điều kiện trong tx (guarded updateMany): chỉ trừ khi
  // tồn hiện tại >= số cần xuất. Nếu count === 0 ⇒ không đủ tồn (chống TOCTOU).
  try {
    await gate.sdb.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          itemId: data.itemId,
          centerId: data.centerId,
          type: "ISSUE",
          quantity: data.quantity,
          referenceType: data.referenceType,
          referenceId: data.referenceId,
          referenceNote: data.referenceNote,
          notes: data.notes,
          performedById,
        },
      });
      const updated = await tx.stockBalance.updateMany({
        where: {
          itemId: data.itemId,
          centerId: data.centerId,
          quantity: { gte: data.quantity },
        },
        data: {
          quantity: { decrement: data.quantity },
          lastIssueAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw new MovementError("STOCK_INSUFFICIENT");
      }
    });
  } catch (err) {
    if (err instanceof MovementError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidateAfterMovement(data.itemId);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
// TRANSFER — chuyển kho giữa centers
// ──────────────────────────────────────────────────────────────────────────

export async function recordTransfer(input: TransferInput): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  // Scope-gate (chống IDOR ghi): cả 2 đầu chuyển đọc qua scopedDb — cơ sở ngoài
  // tầm nhìn actor → null → chặn. Chuyển CHÉO cơ sở cần actor nhìn thấy cả 2 đầu
  // (HO/SUPER_ADMIN); CM center-scope chỉ chuyển giữa các cơ sở mình quản.
  const [fromBalance, toBalance] = await Promise.all([
    gate.sdb.stockBalance.findUnique({
      where: {
        itemId_centerId: { itemId: data.itemId, centerId: data.fromCenterId },
      },
      select: { quantity: true },
    }),
    gate.sdb.stockBalance.findUnique({
      where: {
        itemId_centerId: { itemId: data.itemId, centerId: data.toCenterId },
      },
      select: { id: true },
    }),
  ]);

  if (!fromBalance) {
    return { ok: false, error: "Bản ghi tồn kho cơ sở nguồn không tồn tại" };
  }
  if (!toBalance) {
    return {
      ok: false,
      error:
        "Cơ sở đích chưa có bản ghi tồn kho — mở mặt hàng và Lưu (hoặc kích hoạt cơ sở) để tự khởi tạo trước khi chuyển.",
    };
  }
  const performedById = await resolveEmployeeId(gate.sdb, gate.userId);

  // FIX-C4 — decrement có điều kiện ở cơ sở nguồn trong tx (chống TOCTOU âm kho).
  try {
    await gate.sdb.$transaction(async (tx) => {
      const outMove = await tx.stockMovement.create({
        data: {
          itemId: data.itemId,
          centerId: data.fromCenterId,
          type: "TRANSFER_OUT",
          quantity: data.quantity,
          referenceType: "Center",
          referenceId: data.toCenterId,
          notes: data.notes,
          performedById,
        },
        select: { id: true },
      });

      const inMove = await tx.stockMovement.create({
        data: {
          itemId: data.itemId,
          centerId: data.toCenterId,
          type: "TRANSFER_IN",
          quantity: data.quantity,
          transferPairId: outMove.id,
          referenceType: "Center",
          referenceId: data.fromCenterId,
          notes: data.notes,
          performedById,
        },
        select: { id: true },
      });

      await tx.stockMovement.update({
        where: { id: outMove.id },
        data: { transferPairId: inMove.id },
      });

      const decremented = await tx.stockBalance.updateMany({
        where: {
          itemId: data.itemId,
          centerId: data.fromCenterId,
          quantity: { gte: data.quantity },
        },
        data: {
          quantity: { decrement: data.quantity },
          lastIssueAt: new Date(),
        },
      });
      if (decremented.count === 0) {
        throw new MovementError("STOCK_INSUFFICIENT");
      }
      await tx.stockBalance.update({
        where: {
          itemId_centerId: {
            itemId: data.itemId,
            centerId: data.toCenterId,
          },
        },
        data: {
          quantity: { increment: data.quantity },
          lastReceiptAt: new Date(),
        },
      });
    });
  } catch (err) {
    if (err instanceof MovementError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidateAfterMovement(data.itemId);
  return { ok: true };
}


// ──────────────────────────────────────────────────────────────────────────
// ADJUSTMENT — kiểm kê (audit reconciliation)
// ──────────────────────────────────────────────────────────────────────────

export async function recordAdjustment(input: AdjustmentInput): Promise<Result> {
  const gate = await requireRole();
  if (!gate.ok) return gate;

  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const performedById = await resolveEmployeeId(gate.sdb, gate.userId);

  // FIX-C4 — đọc tồn + tính delta + ghi trong CÙNG tx (Serializable) để delta
  // nhất quán với tồn thực tại thời điểm ghi (chống lost-update giữa các phiếu).
  // Scope-gate nằm ngay trong tx: tx.stockBalance.findUnique chạy qua read-hook
  // của scopedDb → cơ sở ngoài tầm nhìn trả null → MovementError, rollback.
  try {
    await runSerializable(gate.sdb, async (tx) => {
      const balance = await tx.stockBalance.findUnique({
        where: {
          itemId_centerId: { itemId: data.itemId, centerId: data.centerId },
        },
        select: { quantity: true },
      });
      if (!balance) {
        throw new MovementError("Chưa có bản ghi tồn kho cho cặp item × cơ sở");
      }

      const delta = data.newQuantity - balance.quantity;
      if (delta === 0) {
        throw new MovementError("Số lượng không thay đổi");
      }

      const type =
        delta > 0
          ? ("ADJUSTMENT_INCREASE" as const)
          : ("ADJUSTMENT_DECREASE" as const);

      await tx.stockMovement.create({
        data: {
          itemId: data.itemId,
          centerId: data.centerId,
          type,
          quantity: Math.abs(delta),
          referenceType: "Audit",
          referenceNote: `Trước: ${balance.quantity} → Sau: ${data.newQuantity}`,
          notes: data.reason,
          performedById,
        },
      });
      await tx.stockBalance.update({
        where: {
          itemId_centerId: { itemId: data.itemId, centerId: data.centerId },
        },
        data: { quantity: data.newQuantity },
      });
    });
  } catch (err) {
    if (err instanceof MovementError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: `Lỗi cơ sở dữ liệu: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidateAfterMovement(data.itemId);
  revalidatePath("/inventory/dashboard");
  return { ok: true };
}

