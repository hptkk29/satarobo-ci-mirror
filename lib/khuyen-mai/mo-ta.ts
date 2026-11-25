// lib/khuyen-mai/mo-ta.ts — câu mô tả ưu đãi của một MÃ voucher. THUẦN (không DB) để tạo đơn,
// màn quản trị và màn tra cứu cùng in một câu cho cùng một mã.
import { formatVndPlain } from "@/lib/format/money";

/** "Giảm 10% (tối đa 500.000 đ)" · "Giảm 300.000 đ". */
export function moTaUuDaiMa(v: {
  discountKind: string;
  discountPercent: number | null;
  discountAmount: number | null;
  maxDiscount: number | null;
}): string {
  if (v.discountKind === "PERCENT") {
    return `Giảm ${v.discountPercent ?? 0}%${v.maxDiscount ? ` (tối đa ${formatVndPlain(v.maxDiscount)})` : ""}`;
  }
  return `Giảm ${formatVndPlain(v.discountAmount ?? 0)}`;
}
