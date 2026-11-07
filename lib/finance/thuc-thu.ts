// lib/finance/thuc-thu.ts — B-02 · quyết định B3 (24/08/2026).
//
// MỘT công thức "thực thu" cho toàn hệ thống. Trước đây mỗi màn tự cộng một kiểu:
// màn kế toán và ROAS cộng `Order.totalAmount` (giá trị hợp đồng đã chốt — tiền có thể
// chưa về, và hoàn/điều chỉnh không bao giờ đụng tới nó), báo cáo doanh thu cộng
// `Payment` nhưng chỉ lấy CONFIRMED nên bút toán hoàn (âm) rơi ra ngoài. Kết quả: số
// doanh thu PHỒNG, và phồng im lặng.
//
// Luật đúng, bám đúng cách `lib/finance/payment.ts` ghi sổ:
//   • CONFIRMED — kế toán đã xác nhận. Đây là tiền thật.        → cộng
//   • REFUNDED  — refundPayment() ghi bút toán ÂM đối ứng,
//                 KHÔNG xoá bản gốc.                            → cộng (số âm ⇒ trừ ra)
//   • ĐIỀU CHỈNH — xem khối 🔴 ngay dưới: nay là DELTA, luôn được cộng, KHÔNG loại gốc.
//
// 🔴 ĐỔI MÔ HÌNH 07/09/2026 (migration `payment_type_tach_khoi_status`), áp khi hợp nhất
//    `main` → `test` ngày 16/09/2026.
//    TRƯỚC: `adjustPayment()` tạo một bút toán trạng thái `ADJUSTED` mang SỐ ĐÚNG, bản gốc
//      giữ số cũ ⇒ phải LOẠI bản gốc, không thì cộng đôi. Đó là lý do `WHERE_THUC_THU` cũ
//      có nhánh `adjustments.none` và `butToanThucThu()` có tập `daBiThayThe`.
//    NAY: `ADJUSTED` ĐÃ BỊ BỎ khỏi `PaymentAccountantStatus`. Bút toán điều chỉnh là dòng
//      `paymentType = "ADJUSTMENT"`, trạng thái vẫn `CONFIRMED`, và nó mang PHẦN CHÊNH
//      LỆCH chứ không mang số đúng. Bản gốc giữ số cũ, cộng cả hai mới ra số đúng.
//    ⇒ LOẠI bản gốc bây giờ là ĐẾM THIẾU đúng phần vừa được sửa — ngược hẳn lỗi cũ.
//    Luật này khai ở `lib/finance/debt.ts` ("KHÔNG lọc theo `paymentType`: bút toán
//    ADJUSTMENT LUÔN được cộng"); file này chỉ đi theo, không được nghĩ khác.
//
//    ⚠️ Con số "thực thu" sẽ ĐỔI so với bản cũ trên nhánh `test`. Đó là hệ quả bắt buộc
//    của việc đổi mô hình, không phải lỗi phép cộng ở đây.
//   • PENDING / REJECTED — chưa/không phải tiền thật.           → bỏ
//
// ⚠️ Số của kế toán và ROAS sẽ TỤT khi bản này lên prod — đó là mức phồng cũ bị gỡ,
// không phải mất doanh thu. Đo trước/sau bằng §B.6.8 trước khi thông báo.
import type { Prisma } from "@prisma/client";

/** Bút toán Payment phẳng — đủ dữ kiện để quyết định nó có được tính hay không. */
export type ThucThuButToan = {
  id: string;
  amount: number;
  /** PaymentAccountantStatus dạng chuỗi (nhận cả string thô từ query select). */
  accountantStatus: string;
  /** Trỏ về bút toán bị điều chỉnh / bị hoàn. */
  adjustmentOfId: string | null;
};

/** Trạng thái kế toán tham gia phép tính thực thu (xem khối 🔴 ở đầu file). */
export const TRANG_THAI_THUC_THU = ["CONFIRMED", "REFUNDED"] as const;

/**
 * Mảnh `where` chuẩn cho MỌI query thực thu (`aggregate` / `groupBy` / `findMany`).
 * Đây là bản dịch SQL của đúng luật mà `butToanThucThu()` cài đặt:
 *   - `deletedAt: null`   — bỏ bút toán đã xoá mềm;
 *   - `accountantStatus`  — chỉ hai trạng thái trên.
 * KHÔNG còn nhánh `adjustments.none`, và KHÔNG được lọc `paymentType`: dòng điều chỉnh
 * mang phần chênh lệch nên phải nằm trong phép cộng.
 */
export const WHERE_THUC_THU = {
  deletedAt: null,
  accountantStatus: { in: [...TRANG_THAI_THUC_THU] },
} satisfies Prisma.PaymentWhereInput;

/**
 * THUẦN — lọc ra đúng những bút toán ĐƯỢC TÍNH vào thực thu (giữ nguyên dấu).
 * Dùng cho caller đã có sẵn mảng row (vd. gom theo tháng/ngày). Chạy sau
 * `WHERE_THUC_THU` thì không đổi kết quả — nó là lớp chắn, không phải bước thứ hai.
 */
export function butToanThucThu<T extends ThucThuButToan>(rows: T[]): T[] {
  // KHÔNG còn bước "loại bản gốc đã bị thay thế" — xem khối 🔴 đầu file. Dòng điều chỉnh
  // là DELTA nên bản gốc VẪN phải được cộng; loại nó đi là đếm thiếu.
  const hopLe: readonly string[] = TRANG_THAI_THUC_THU;
  return rows.filter((r) => hopLe.includes(r.accountantStatus));
}

/** THUẦN — tổng thực thu của một mảng bút toán. */
export function tinhThucThu(rows: ThucThuButToan[]): number {
  return butToanThucThu(rows).reduce((s, r) => s + r.amount, 0);
}

/** Trường tối thiểu phải `select` khi caller muốn tự gom nhóm rồi lọc lại. */
export const SELECT_THUC_THU = {
  id: true,
  amount: true,
  accountantStatus: true,
  adjustmentOfId: true,
} as const;
