import "server-only";
import { db } from "@/lib/db";

// lib/payments/tien-webhook-vao-don.ts — "đơn này đã có tiền THẬT về tài khoản chưa".
//
// ── VÌ SAO CÂU HỎI NÀY KHÁC "ĐÃ THU" ─────────────────────────────────────────────────
// Màn chi tiết đơn có ô "ĐÃ THU", và nó là **Trục B** (`daGhiNhan` — sale bấm đã thu).
// Trục A (`accountantStatus = CONFIRMED`) là kế toán đối soát. Cả hai đều là NGƯỜI khai.
//
// Chủ dự án chốt điều kiện mở nút Chuyển đổi (29/09/2026):
//   *"chỉ cần webhook xác nhận có tiền vào tài khoản với đúng nội dung CK của đơn hàng
//   là được"*
// ⇒ Không phải người khai, mà là **ngân hàng báo có + hệ tự đối khớp vào đúng phiếu thu
// của đơn**. Chuỗi đó là:
//
//   BankTransaction  →  PaymentAllocation  →  PaymentRequest  →  Order
//   (tiền về)           (đối khớp)            (phiếu thu)        (đơn)
//
// `PaymentAllocation` CHỈ ra đời từ đường đối khớp tự động (`lib/payments/payos-ingest.ts`
// và các nút đối soát), nên sự tồn tại của nó CHÍNH LÀ "webhook đã xác nhận". Không có
// cột `nguon` nào trên `Payment` phân biệt tiền tự động với tiền nhập tay — đã tra, không
// có; nên đừng đi tìm một cột như vậy, đường quan hệ này mới là câu trả lời.
//
// Số đo 29/09/2026 — chứng minh luật này chạy thật chứ không chặn hết:
//   PROD   24/129 đơn có tiền webhook đối khớp · 29/60 `BankTransaction` đã MATCHED
//   LOCAL  0/515  (50 `BankTransaction` nhưng 0 `PaymentAllocation` — dữ liệu seed)

export type TienWebhookCuaDon = {
  /** Tổng số tiền đã đối khớp tự động vào các phiếu thu của đơn (VND). */
  soTien: number;
  /** Số lượt đối khớp (mỗi `BankTransaction` rót vào một phiếu là một lượt). */
  soLuot: number;
};

const KHONG_CO: TienWebhookCuaDon = { soTien: 0, soLuot: 0 };

/**
 * Tiền webhook đã đối khớp vào MỘT đơn.
 *
 * ⚠️ KHÔNG `scopedDb`: `PaymentAllocation` và `PaymentRequest` được tra theo `orderId`
 * mà đơn ấy đã qua cổng scope ở tầng trên (màn chi tiết đơn). Đi qua `scopedDb` ở đây
 * chỉ thêm một phép lọc thừa trên một id đã xác minh, và dễ làm người đọc tưởng hàm này
 * TỰ gác quyền — nó không.
 */
export async function tienWebhookCuaDon(orderId: string): Promise<TienWebhookCuaDon> {
  if (!orderId) return KHONG_CO;
  const rows = await db.paymentAllocation.aggregate({
    where: { paymentRequest: { orderId } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  return { soTien: rows._sum.amount ?? 0, soLuot: rows._count._all };
}

/**
 * Đơn đã đủ điều kiện mở màn Chuyển đổi chưa. THUẦN — tách khỏi phép đọc để test được
 * mà không cần DB, và để form/nút và server action dùng CÙNG một phép so.
 *
 * Ngưỡng là **> 0**, cố ý không phải "đủ số": chủ dự án nói *"chỉ cần webhook xác nhận
 * có tiền vào tài khoản"*. Đơn trả góp đóng đợt 1 là đã được xếp lớp — bắt đóng đủ mới
 * cho học là chặn đúng luồng chính của khoá 48 buổi.
 */
export function duocChuyenDoi(t: TienWebhookCuaDon): boolean {
  return t.soTien > 0;
}

/** Câu giải thích khi nút bị khoá — nói VÌ SAO, đừng để người dùng tự đoán (luật 12). */
export function lyDoChuaChuyenDoiDuoc(t: TienWebhookCuaDon): string | null {
  if (duocChuyenDoi(t)) return null;
  return (
    "Chưa có tiền về tài khoản khớp với mã của đơn này. " +
    "Nút mở khi ngân hàng báo có và hệ thống tự đối khớp — tiền ghi nhận thủ công không tính."
  );
}
