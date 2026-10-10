// lib/crm/commission-export.ts — R1-12: dựng dữ liệu export hoa hồng (THUẦN, không xlsx).
// Tách map/format khỏi ghi file (giống lib/attendance/shift-excel.ts) → test được.

export const COMMISSION_EXPORT_COLUMNS = ["Người nhận", "Tầng", "Số tiền (VND)", "Clawback"] as const;

const TIER_LABEL: Record<string, string> = {
  QC: "Quảng cáo (QC)",
  SALE_ADMIN: "Sale Admin",
  SALE: "Sale",
  QL_TT: "Quản lý TT",
  // 25/08 — tầng NGOÀI pool 8% của 4 tầng Sale: +1% cho GV dạy buổi trải nghiệm khi
  // học viên nhập học. Xem lib/crm/trial-teacher-commission.ts để biết vì sao tách.
  TRIAL_TEACHER: "GV dạy Trial",
};

export type ExportLine = {
  recipientId: string;
  tier: string;
  amount: number;
  isClawback?: boolean;
};

/**
 * Dựng các dòng (string[][]) cho 1 sheet export: header + từng dòng + dòng TỔNG.
 * `names` map recipientId → tên hiển thị (thiếu → dùng id).
 */
export function buildCommissionExportRows(
  lines: ExportLine[],
  names: Record<string, string> = {},
): string[][] {
  const rows: string[][] = [[...COMMISSION_EXPORT_COLUMNS]];
  let total = 0;
  for (const l of lines) {
    total += l.amount;
    rows.push([
      names[l.recipientId] ?? l.recipientId,
      TIER_LABEL[l.tier] ?? l.tier,
      l.amount.toLocaleString("vi-VN"),
      l.isClawback ? "Có" : "",
    ]);
  }
  rows.push(["TỔNG", "", total.toLocaleString("vi-VN"), ""]);
  return rows;
}
