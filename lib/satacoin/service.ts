import { db } from "@/lib/db";
import type { SataCoinTxType } from "@prisma/client";

// =============================================================================
// Cụm C4 — SataCoin: sổ cái BẤT BIẾN. KHÔNG sửa/xoá giao dịch. Điều chỉnh =
// ghi giao dịch đảo (REVERSAL). Số dư = SUM(amount). KHÔNG blockchain.
// =============================================================================

/** Số dư = tổng amount của mọi giao dịch học viên. */
export async function getBalance(studentId: string): Promise<number> {
  const agg = await db.sataCoinTransaction.aggregate({
    where: { studentId },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0;
}

export async function listTransactions(studentId: string, limit = 100) {
  return db.sataCoinTransaction.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      amount: true,
      type: true,
      reason: true,
      note: true,
      ruleCode: true,
      reversedTxId: true,
      createdAt: true,
    },
  });
}

/** Ghi 1 giao dịch mới (append-only). amount âm = trừ. */
export async function recordTransaction(params: {
  studentId: string;
  amount: number;
  type: SataCoinTxType;
  reason: string;
  note?: string | null;
  ruleCode?: string | null;
  createdById?: string | null;
}): Promise<{ ok: boolean; error?: string; txId?: string }> {
  if (!Number.isInteger(params.amount) || params.amount === 0) {
    return { ok: false, error: "Số coin phải là số nguyên khác 0" };
  }
  const student = await db.student.findFirst({
    where: { id: params.studentId, deletedAt: null },
    select: { id: true, centerId: true },
  });
  if (!student) return { ok: false, error: "Không tìm thấy học viên" };

  // Không cho số dư âm khi trừ.
  if (params.amount < 0) {
    const bal = await getBalance(params.studentId);
    if (bal + params.amount < 0) return { ok: false, error: `Số dư không đủ (hiện ${bal})` };
  }

  const tx = await db.sataCoinTransaction.create({
    data: {
      studentId: params.studentId,
      amount: params.amount,
      type: params.type,
      reason: params.reason,
      note: params.note ?? null,
      ruleCode: params.ruleCode ?? null,
      centerId: student.centerId,
      createdById: params.createdById ?? null,
    },
    select: { id: true },
  });
  return { ok: true, txId: tx.id };
}

/** Cộng coin theo rule đang bật. */
export async function grantByRule(params: {
  studentId: string;
  ruleCode: string;
  note?: string | null;
  createdById?: string | null;
}): Promise<{ ok: boolean; error?: string; txId?: string }> {
  const rule = await db.sataCoinRule.findFirst({ where: { code: params.ruleCode, isActive: true } });
  if (!rule) return { ok: false, error: "Rule không tồn tại hoặc đã tắt" };
  return recordTransaction({
    studentId: params.studentId,
    amount: rule.amount,
    type: "EARN",
    reason: rule.code,
    ruleCode: rule.code,
    note: params.note ?? rule.label,
    createdById: params.createdById,
  });
}

/**
 * Điều chỉnh = ĐẢO 1 giao dịch (immutable). Tạo giao dịch REVERSAL với amount
 * âm/đối của giao dịch gốc, gắn reversedTxId. KHÔNG sửa giao dịch gốc.
 */
export async function reverseTransaction(
  txId: string,
  createdById: string | null,
  note?: string | null,
): Promise<{ ok: boolean; error?: string; reversalId?: string }> {
  const orig = await db.sataCoinTransaction.findUnique({ where: { id: txId } });
  if (!orig) return { ok: false, error: "Không tìm thấy giao dịch" };
  if (orig.type === "REVERSAL") return { ok: false, error: "Không thể đảo một giao dịch đảo" };

  // Đã bị đảo trước đó?
  const existing = await db.sataCoinTransaction.findUnique({ where: { reversedTxId: txId } });
  if (existing) return { ok: false, error: "Giao dịch đã được đảo trước đó" };

  const reversal = await db.sataCoinTransaction.create({
    data: {
      studentId: orig.studentId,
      amount: -orig.amount,
      type: "REVERSAL",
      reason: `REVERSAL:${orig.reason}`,
      note: note ?? `Đảo giao dịch ${txId}`,
      centerId: orig.centerId,
      reversedTxId: txId,
      createdById,
    },
    select: { id: true },
  });
  return { ok: true, reversalId: reversal.id };
}
