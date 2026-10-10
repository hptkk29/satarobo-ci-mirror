// lib/finance/invoice-code.ts — R2-03: sinh mã hoá đơn INV-<CS>-<YYYY>-#### (Doc 15 §4.9).
// Số chạy qua Counter (atomic trong transaction → không race, C3.1).
import type { Prisma } from "@prisma/client";

/** Format mã hoá đơn (THUẦN). seq → "INV-CS1-2026-0001". */
export function formatInvoiceCode(centerCode: string, year: number, seq: number): string {
  return `INV-${centerCode}-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Lấy số tiếp theo + format mã, atomic qua Counter (gọi TRONG transaction).
 * key = `invoice:<centerCode>:<year>`.
 */
export async function nextInvoiceCode(
  tx: Prisma.TransactionClient,
  centerCode: string,
  year: number,
): Promise<string> {
  const key = `invoice:${centerCode}:${year}`;
  const counter = await tx.counter.upsert({
    where: { key },
    update: { lastValue: { increment: 1 } },
    create: { key, lastValue: 1 },
  });
  return formatInvoiceCode(centerCode, year, counter.lastValue);
}
