// lib/pricing/hieu-luc-chinh-sach.ts — CỬA SỔ HIỆU LỰC CỦA CHÍNH SÁCH GIÁ PL02. THUẦN, không đọc đồng hồ.
//
// Chính sách giá theo phạm vi học (SR.QD.233 + Phụ lục 02) chỉ có hiệu lực 01/09/2026 → 31/12/2026 (MT-18).
// `keHoachDongDon` nhận cửa sổ này qua `BoiCanhKeHoach.hieuLuc` và TỪ CHỐI (`NGOAI_CUA_SO_CHINH_SACH`) khi ngày
// áp giá nằm ngoài — sau 31/12 nó fail-closed chứ không im lặng bán theo bảng giá hết hạn, cho tới khi BLĐ ban
// hành chính sách kế tiếp (lúc đó thay hằng này bằng bảng phiên bản `PricingPolicyVersion`).
//
// NỬA MỞ `[tu, den)`, mốc theo GIỜ VIỆT NAM: 00:00 ngày 01/09/2026 (UTC+7) đến 00:00 ngày 01/01/2027 (UTC+7).
// Ghi mốc kèm múi giờ tường minh để kết quả không phụ thuộc `TZ` của tiến trình.
export interface CuaSoHieuLuc {
  readonly tu: Date;
  readonly den: Date;
}

/** Trả `Date` MỚI mỗi lần gọi: `Date` có thể bị sửa tại chỗ, không chia sẻ một thể hiện giữa các lời gọi. */
export function cuaSoHieuLucPL02(): CuaSoHieuLuc {
  return { tu: new Date("2026-09-01T00:00:00+07:00"), den: new Date("2027-01-01T00:00:00+07:00") };
}
