// lib/finance/hoa-don/nguon-khoan.ts — MỘT khoản thu đến từ giao dịch nào, và còn bao nhiêu
// tiền thật. THUẦN: không Prisma, không DB, không đọc đồng hồ.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §2.1 + §3.1. Hàng chờ hoá đơn, cách gom "lần thu",
// cổng xác nhận và báo cáo đo prod GĐ 0 đều đọc hai hàm ở đây — định nghĩa nằm một chỗ để
// báo cáo đo và màn hình không thể trả lời khác nhau.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO PHẢI DÒ MARKER: `Payment` KHÔNG có khoá ngoại tới `BankTransaction`. Đường nối duy
// nhất là chuỗi marker mà đường ghi nhét vào `note` (sổ đăng ký marker:
// `lib/finance/payment-markers.ts`, cộng ba marker của `lib/finance/ghi-tien-don.ts`).
//
// VÌ SAO PHẢI TÍNH RÒNG: tách khoản, gỡ gắn, hoàn tiền và điều chỉnh đều GIỮ NGUYÊN dòng gốc
// (PAYMENT, số dương) rồi ghi thêm dòng trỏ `adjustmentOfId` về nó. Cộng `amount` trần là đếm
// tiền đã tách hai lần, và xuất hoá đơn cho tiền đã hoàn.
// ─────────────────────────────────────────────────────────────────────────────

import { BACKFILL_PAYMENT_MARKER, isPlanOwnedNote } from "@/lib/finance/payment-markers";

export type NguonGiaoDich =
  /** `[auto:<provider>:<txn>]` — webhook, phiếu gộp, gắn tay toàn đơn qua `allocateToOrder`. */
  | { loai: "WEBHOOK"; provider: string; providerTxnId: string }
  /** `[gan-tay:<BankTransaction.id>]` — gắn tay theo con. Khoá theo id của BẢNG. */
  | { loai: "GAN_TAY"; bankTransactionId: string }
  /** `[auto:order-confirm]` / `[auto:order-installment:dotN]` — LỜI KHAI, không có giao dịch. */
  | { loai: "LOI_KHAI" }
  /** `[backfill-import]` / `[sheet:…]` — tiền thu trước khi lên hệ thống. */
  | { loai: "LICH_SU" }
  /** `[chuyen:<id>]` — chuyển tiền đã xác nhận giữa hai bé cùng đơn. Không phải tiền mới. */
  | { loai: "CHUYEN_NOI_BO" }
  /** Không marker nào — tiền mặt, COD, ghi tay. */
  | { loai: "KHONG" };

// Cùng lookahead với `isGatewayNote` (payment-markers.ts): hai marker lời khai đều bắt đầu
// bằng `order-`, nên chúng KHÔNG được đọc thành một provider tên "order-installment".
// Nhóm 2 dừng ở `]` — mã giao dịch không bao giờ chứa dấu ngoặc vuông.
const MARKER_WEBHOOK = /\[auto:(?!order-)([a-z0-9._-]+):([^\]]+)\]/;
const MARKER_GAN_TAY = /\[gan-tay:([^\]]+)\]/;
const MARKER_CHUYEN = /\[chuyen:[^\]]+\]/;
const MARKER_SHEET = /\[sheet:[^\]]+\]/;

/**
 * Khoản mang `note` này đến từ giao dịch ngân hàng nào.
 *
 * ⚠️ THỨ TỰ XÉT CÓ CHỦ ĐÍCH:
 *  1. LỊCH SỬ trước — dòng sheet mang CẢ dấu sheet lẫn `[backfill-import]`, và tiền đó đã
 *     xuất hoá đơn ngoài hệ thống (nếu có); không được đọc nó thành tiền mới.
 *  2. CHUYỂN NỘI BỘ trước ngân hàng — dòng chuyển không chép marker ngân hàng hôm nay, nhưng
 *     nếu một ngày nó chép thì nó vẫn KHÔNG phải tiền mới.
 *  3. GẮN TAY trước WEBHOOK — hai họ không giẫm nhau, giữ thứ tự để đọc mã khỏi chứng minh lại.
 *  4. LỜI KHAI sau cùng trong các họ có marker.
 */
export function nguonGiaoDich(note: string | null | undefined): NguonGiaoDich {
  if (!note) return { loai: "KHONG" };
  if (note.includes(BACKFILL_PAYMENT_MARKER) || MARKER_SHEET.test(note)) return { loai: "LICH_SU" };
  if (MARKER_CHUYEN.test(note)) return { loai: "CHUYEN_NOI_BO" };

  const ganTay = MARKER_GAN_TAY.exec(note);
  if (ganTay) return { loai: "GAN_TAY", bankTransactionId: ganTay[1]! };

  const webhook = MARKER_WEBHOOK.exec(note);
  if (webhook) return { loai: "WEBHOOK", provider: webhook[1]!, providerTxnId: webhook[2]! };

  if (isPlanOwnedNote(note)) return { loai: "LOI_KHAI" };
  return { loai: "KHONG" };
}

/** Một dòng `Payment` tối thiểu để tính ròng. */
export type DongSo = {
  id: string;
  amount: number;
  adjustmentOfId: string | null;
  deletedAt: Date | null;
};

/**
 * Số tiền RÒNG của mỗi dòng: `amount` + Σ `amount` của mọi dòng còn sống trỏ `adjustmentOfId`
 * vào nó.
 *
 * ⚠️ KHÔNG lọc dòng trỏ vào theo `paymentType`: dòng HOÀN là `PAYMENT` / `REFUNDED` chứ không
 * phải `ADJUSTMENT` (`refundPayment` không đặt `paymentType`). Lọc theo loại là bỏ sót đúng tiền
 * đã trả lại khách.
 *
 * ⚠️ KHÔNG lọc theo `accountantStatus`: một dòng đảo bị kế toán TỪ CHỐI vẫn là bằng chứng dòng
 * gốc đã bị đảo (cùng lý lẽ `lib/finance/debt.ts` dùng cho `daBiDao`).
 *
 * ⚠️ KHÁC `daBiDao` của debt.ts: tập đó gom MỌI dòng có ADJUSTMENT trỏ vào, kể cả điều chỉnh
 * MỘT PHẦN — dùng nó làm tập loại là loại oan khoản chỉ bị bớt một ít. Ở đây trả về SỐ, người
 * gọi tự quyết ngưỡng (hàng chờ hoá đơn: `> 0`).
 *
 * Trả về Map cho MỌI dòng trong danh sách (kể cả dòng đảo — người gọi tự lọc loại dòng).
 * Dòng trỏ về một gốc không nằm trong danh sách thì bị bỏ qua, không đẻ khoá ma.
 */
export function soTienRong(dong: readonly DongSo[]): Map<string, number> {
  const rong = new Map<string, number>();
  for (const d of dong) rong.set(d.id, d.amount);
  for (const d of dong) {
    if (d.adjustmentOfId == null || d.deletedAt != null) continue;
    const goc = rong.get(d.adjustmentOfId);
    if (goc === undefined) continue;
    rong.set(d.adjustmentOfId, goc + d.amount);
  }
  return rong;
}
