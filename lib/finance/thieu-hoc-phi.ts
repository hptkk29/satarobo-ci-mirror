// lib/finance/thieu-hoc-phi.ts — phân loại "học viên chưa phát sinh đơn hàng, hoặc có
// đơn nhưng thiếu học phí".
//
// VÌ SAO CÓ: `lib/crm/bulk-convert.ts` có nhánh `allowNoPayment` — chốt lead hàng loạt
// mà KHÔNG nhập tiền thì nó CỐ Ý không bịa khoản thu, chỉ ghi nhật ký
// `BACKFILL_IMPORT: nhập liệu ban đầu, chưa ghi nhận khoản thu trong hệ thống`. Kết quả:
// các em đó có `Enrollment` nhưng **không có Order/Payment** ⇒ không ai nợ ai trong sổ,
// và học phí của các em biến mất khỏi mọi báo cáo.
//
// Hàm ở đây THUẦN — người gọi đo 3 số rồi hỏi, để test không cần DB và để màn hình
// lẫn script vận hành dùng chung một luật.

/** Trạng thái học phí của một ghi danh/lead — tên hiện thẳng lên màn. */
export type TrangThaiHocPhi =
  /** Chưa có đơn hàng nào ⇒ chưa có gì để thu. */
  | "CHUA_CO_DON"
  /** Có đơn nhưng chưa ghi nhận đồng nào. */
  | "CO_DON_CHUA_THU"
  /** Có đơn, đã thu một phần. */
  | "THU_MOT_PHAN"
  /** Đã thu đủ (hoặc hơn) — không nằm trong danh sách cần xử lý. */
  | "DU";

export const NHAN_TRANG_THAI: Record<TrangThaiHocPhi, string> = {
  CHUA_CO_DON: "Chưa có đơn hàng",
  CO_DON_CHUA_THU: "Có đơn, chưa thu đồng nào",
  THU_MOT_PHAN: "Đã thu một phần",
  DU: "Đã thu đủ",
};

export type HocPhiInput = {
  /** Số đơn hàng còn sống của lead (mọi trạng thái trừ đã xoá mềm). */
  soDon: number;
  /** Σ `totalAmount` các đơn — số PHẢI thu theo sổ đơn. */
  tongPhaiThu: number;
  /** Σ `Payment` còn sống, `saleStatus = RECORDED` — số ĐÃ ghi nhận. */
  tongDaThu: number;
};

/**
 * Phân loại một lead/học viên theo tình trạng học phí.
 *
 * ⚠️ `soDon === 0` được tách RIÊNG khỏi `tongPhaiThu === 0`: hai thứ trông giống nhau
 * trên số liệu (đều ra "phải thu 0") nhưng khác hẳn về việc phải làm — chưa có đơn thì
 * phải TẠO đơn + khoản thu, còn có đơn 0đ là dữ liệu sai cần người xem. Gộp lại là
 * đúng cái làm nhóm chốt-hàng-loạt-không-tiền tàng hình bấy lâu nay.
 */
export function phanLoaiHocPhi(input: HocPhiInput): TrangThaiHocPhi {
  const soDon = Math.max(0, Math.floor(Number.isFinite(input.soDon) ? input.soDon : 0));
  if (soDon === 0) return "CHUA_CO_DON";

  const phaiThu = Math.max(0, Number.isFinite(input.tongPhaiThu) ? input.tongPhaiThu : 0);
  const daThu = Math.max(0, Number.isFinite(input.tongDaThu) ? input.tongDaThu : 0);

  if (daThu >= phaiThu) return "DU";
  if (daThu <= 0) return "CO_DON_CHUA_THU";
  return "THU_MOT_PHAN";
}

/** Còn thiếu bao nhiêu — KHÔNG âm. Chưa có đơn thì chưa biết thiếu bao nhiêu ⇒ 0. */
export function conThieu(input: HocPhiInput): number {
  if (phanLoaiHocPhi(input) === "CHUA_CO_DON") return 0;
  const phaiThu = Math.max(0, Number.isFinite(input.tongPhaiThu) ? input.tongPhaiThu : 0);
  const daThu = Math.max(0, Number.isFinite(input.tongDaThu) ? input.tongDaThu : 0);
  return Math.max(0, phaiThu - daThu);
}

/** Có cần hiện trong danh sách "cần xử lý" không. */
export function canXuLy(input: HocPhiInput): boolean {
  return phanLoaiHocPhi(input) !== "DU";
}
