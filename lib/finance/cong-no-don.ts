// lib/finance/cong-no-don.ts — bộ số công nợ của MỘT đơn hàng, để in ra màn hình.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI
//
// Trang `/orders/[id]` đã tính đủ số từ 2 trục (xem `lib/finance/ghi-nhan.ts`) nhưng chỉ
// in `order.totalAmount`. Người xem một đơn vừa tạo từ màn Thiếu học phí không thấy được
// còn thiếu bao nhiêu — tính rồi không hiện.
//
// Hàm này KHÔNG định nghĩa lại "đã thu". Nó nhận sẵn hai con số từ hai trục đã có tên và
// chỉ làm phần số học + đặt tên cho từng ô trên màn hình. Repo này đã có ≥7 định nghĩa
// "đã thu"; thêm một định nghĩa nữa ở tầng hiển thị là thêm một chỗ để lệch.
//
// ─────────────────────────────────────────────────────────────────────────────
// "CÒN THIẾU" LẤY THEO TRỤC B, KHÔNG PHẢI TRỤC A
//
// Câu hỏi trên màn này là "phụ huynh còn phải đóng bao nhiêu" ⇒ tiền đã về là tiền đã
// về, dù kế toán chưa đối soát. Lấy trục A thì mọi đơn vừa nhập (khoản mang dấu
// `[backfill-import]`, `accountantStatus: PENDING`) sẽ báo thiếu TOÀN BỘ học phí — sale
// gọi điện đòi tiền khách đã đóng rồi.
//
// Chênh lệch A/B KHÔNG bị nuốt: nó ra ô `choXacNhan` riêng, đúng tinh thần "chênh lệch
// giữa hai trục là thông tin, không phải lỗi".
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ Import từ `debt-pure`, KHÔNG từ `debt`: `debt.ts` chạm `@/lib/db`, và file này
// được dùng lại ở tầng client (bảng đối soát ở /cong-no). Xem đầu `debt-pure.ts`.
import { computeDebt } from "./debt-pure";

export type CongNoDonInput = {
  /** `Order.totalAmount` — tổng phải đóng sau giảm giá. */
  totalAmount: number;
  /** TRỤC B — Σ `Payment.amount` với `KHOAN_DA_GHI_NHAN` (xem lib/finance/ghi-nhan.ts). */
  daGhiNhan: number;
  /** TRỤC A — Σ `Payment.amount` với `KHOAN_DA_XAC_NHAN` (xem lib/finance/debt.ts). */
  daXacNhan: number;
};

export type CongNoDon = {
  phaiDong: number;
  /** = trục B. Nhãn trên màn hình là "Đã thu" vì với phụ huynh thì tiền đã chuyển là đã thu. */
  daThu: number;
  conThieu: number;
  /** Phần sale đã thu mà kế toán chưa xác nhận (B − A). Việc nội bộ, không phải nợ của khách. */
  choXacNhan: number;
  /** Thu vượt tổng đơn. Có ô riêng để `conThieu` không bao giờ phải in số âm. */
  traVuot: number;
  /** Đã đóng đủ. Đơn 0đ KHÔNG tính là xong — đó là dữ liệu sai cần người xem. */
  xong: boolean;
};

/** Số tiền hợp lệ: không âm, không NaN/Infinity, tròn về đồng. */
function tien(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

export function congNoDon(input: CongNoDonInput): CongNoDon {
  const phaiDong = tien(input.totalAmount);
  const daThu = tien(input.daGhiNhan);
  const daXacNhan = tien(input.daXacNhan);

  return {
    phaiDong,
    daThu,
    // Dùng lại hàm thuần đã có của trục công nợ thay vì gõ `Math.max(0, a - b)` lần nữa.
    conThieu: computeDebt(phaiDong, daThu),
    choXacNhan: Math.max(0, daThu - daXacNhan),
    traVuot: Math.max(0, daThu - phaiDong),
    xong: phaiDong > 0 && daThu >= phaiDong,
  };
}
