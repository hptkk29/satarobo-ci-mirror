// lib/orders/pham-vi/nhan-da-thu.ts — NHÃN & CHÚ THÍCH cho hai con số "Đã thu" trên trang chi tiết đơn THEO PHẠM VI HỌC. THUẦN, chỉ chữ.
//
// ── VÌ SAO TỒN TẠI [14/10/2026, PR "vá sau smoke"] ───────────────────────────────────────────────────────────────
// Đo trên đơn ORD-261013-000002 (test.satarobo.vn): cùng một trang in HAI con số đều gọi là "Đã thu" mà khác nhau, không lời giải thích.
//   · Khối "Công nợ đơn hàng" → `congNoDon().daThu` = TRỤC B: Σ `Payment` người khai/kế toán ghi (tiền mặt, ghi tay…), kể cả khoản kế toán chưa đối soát.
//   · Bảng "Phiếu thu & QR theo đợt" → cột `allocated` = Σ `PaymentAllocation` của phiếu = tiền ĐỐI KHỚP tự động từ giao dịch ngân hàng / thẻ POS (`BankTransaction`).
// Hai sổ khác nhau CÓ CHỦ ĐÍCH (xem đầu `lib/finance/cong-no-don.ts` và `lib/finance/ghi-nhan.ts`) — vá ở đây là vá CÂU CHỮ, không đụng một con số nào:
// ghi 10.200.000đ tiền mặt ⇒ công nợ "Đã thu 10.200.000đ" còn phiếu vẫn "Đã thu 0đ — Chờ thu" vì chưa có giao dịch ngân hàng nào được gắn vào phiếu.
//
// ── CHỈ ĐƠN THEO PHẠM VI ──────────────────────────────────────────────────────────────────────────────────────────
// Đơn thường (legacy) có đúng hiện tượng này nhưng nhiều test ghim văn bản "Đã thu" của nó — PR này thu hẹp cho đơn có dấu SCOPE (`khoiKeHoachTrangDon` = "PHAM_VI")
// và để đơn thường NGUYÊN CHỮ. Muốn mở rộng thì đổi MỘT chỗ: hàm vị từ ở các nơi gọi, không phải chữ ở đây.

/** Tiêu đề cột khi đơn thường: NGUYÊN CHỮ như trước PR. */
export const NHAN_COT_DA_THU_MAC_DINH = "Đã thu";

/** Tiêu đề cột khi đơn theo phạm vi: nói đúng nó đếm gì. */
export const NHAN_COT_DA_DOI_KHOP = "Đã đối khớp";

/** Giải thích (title) của tiêu đề cột "Đã đối khớp". */
export const GIAI_THICH_COT_DA_DOI_KHOP = "Tiền ngân hàng / thẻ POS đã được đối khớp vào phiếu này. Tiền mặt hoặc khoản ghi tay nằm ở sổ kế toán — xem khối Công nợ đơn hàng.";

/** Chú thích dưới ô "Đã thu" của khối Công nợ khi đơn theo phạm vi. */
export const CHU_THICH_O_DA_THU_PHAM_VI = "Đã ghi nhận, kể cả chờ kế toán";

export function nhanCotDaThuCuaPhieu(donPhamVi: boolean): string {
  return donPhamVi ? NHAN_COT_DA_DOI_KHOP : NHAN_COT_DA_THU_MAC_DINH;
}

export interface VaoChuThichDaThuLech {
  readonly donPhamVi: boolean;
  /** `congNoDon().daThu` — số in ở ô "Đã thu" của khối Công nợ. */
  readonly daGhiNhanDon: number;
  /** `allocated` của từng dòng phiếu đang in. */
  readonly phieu: ReadonlyArray<{ readonly allocated: number }>;
}

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

/**
 * Dòng giải thích dưới bảng phiếu thu — CHỈ khi đơn theo phạm vi VÀ hai số khác nhau. `null` = không in gì (đơn thường, hoặc hai số trùng nhau
 * nên không có gì để giải thích). Các số trong câu là CHÍNH hai số đang in ở hai khối, không tính lại từ nguồn khác.
 */
export function chuThichDaThuLech(v: VaoChuThichDaThuLech): string | null {
  if (!v.donPhamVi) return null;
  const doiKhop = v.phieu.reduce((s, r) => s + r.allocated, 0);
  if (doiKhop === v.daGhiNhanDon) return null;
  return (
    `Phiếu thu chỉ đếm tiền ngân hàng / thẻ POS đã đối khớp (${vnd(doiKhop)}). ` +
    `Khối Công nợ đếm mọi khoản đã ghi nhận (${vnd(v.daGhiNhanDon)}), kể cả tiền mặt hoặc khoản ghi tay và khoản kế toán chưa đối soát — nên hai số có thể khác nhau.`
  );
}
