// lib/finance/receipt.ts — R7-04: phiếu thu per Enrollment (sinh khi kế toán CONFIRMED).
// Code: RCP-{centerCode}-{YY}-{SEQ} (seq atomic qua Counter). Gọi TRONG transaction
// xác nhận thanh toán (truyền `tx`). KHÔNG gọi new Date() ở module top — `now` truyền vào.
import type { Prisma, Receipt } from "@prisma/client";
import { nextSeq, yy } from "@/lib/codegen";

type TxClient = Prisma.TransactionClient;

/** Sanitize center code cho mã phiếu (CS_1 → CS1). */
function sanitize(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Sinh 1 Receipt ACTIVE cho khoản đã được kế toán xác nhận.
 * `now` quyết định năm (YY) — truyền cố định để test deterministic; mặc định lấy lúc gọi.
 */
export async function issueReceipt(params: {
  /**
   * `null` CHỈ cho khoản của đơn KIT / THI (không có ghi danh — `lib/finance/can-ghi-danh.ts`).
   * Người gọi duy nhất (`xacNhanKhoanTrongTx`) đã chặn khoản đơn COURSE thiếu ghi danh trước khi tới đây.
   */
  enrollmentId: string | null;
  paymentId: string;
  issuedById?: string | null;
  centerCode: string;
  tx: TxClient;
  now?: Date;
}): Promise<Receipt> {
  const now = params.now ?? new Date();
  const cc = sanitize(params.centerCode) || "SR";
  const y = yy(now);
  const seq = await nextSeq(`receipt:${cc}:${y}`, params.tx);
  const code = `RCP-${cc}-${y}-${String(seq).padStart(4, "0")}`;

  return params.tx.receipt.create({
    data: {
      code,
      enrollmentId: params.enrollmentId,
      paymentId: params.paymentId,
      issuedById: params.issuedById ?? null,
      issuedAt: now,
      status: "ACTIVE",
    },
  });
}
