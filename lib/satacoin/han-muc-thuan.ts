/**
 * HS2-D4 — luật THUẦN (không DB) cho việc giáo viên cộng/trừ SataCoin: chỉ học viên mình phụ trách, trong hạn mức THÁNG do Admin đặt, lý do bắt buộc.
 * Một nơi chứa luật: màn nhân sự web và bất kỳ đường ghi nào khác đều gọi `kiemTraCapCoinGiaoVien`; test không cần Postgres.
 */

export type VaiCapCoin = "ADMIN" | "QUAN_LY_CO_SO" | "GIAO_VIEN" | "KHAC";

/**
 * Phân loại người cấp. Vai cao nhất thắng: SUPER_ADMIN > CENTER_MANAGER > TEACHER. Chỉ vai GIAO_VIEN bị hạn mức + giới hạn học viên phụ trách;
 * KHAC (không có vai nào trong ba vai) KHÔNG được cộng/trừ (fail-closed) — tầng gọi từ chối.
 */
export function phanLoaiNguoiCap(roles: readonly string[]): VaiCapCoin {
  if (roles.includes("SUPER_ADMIN")) return "ADMIN";
  if (roles.includes("CENTER_MANAGER")) return "QUAN_LY_CO_SO";
  if (roles.includes("TEACHER")) return "GIAO_VIEN";
  return "KHAC";
}

const GIO_VN_MS = 7 * 3_600_000;

/** Tháng dương lịch giờ Việt Nam chứa `now`: [tu, den) tính bằng thời điểm UTC (đúng cho truy vấn `createdAt`). */
export function khoangThangVn(now: Date): { tu: Date; den: Date; nhan: string } {
  const vn = new Date(now.getTime() + GIO_VN_MS);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  const tu = new Date(Date.UTC(y, m, 1) - GIO_VN_MS);
  const den = new Date(Date.UTC(y, m + 1, 1) - GIO_VN_MS);
  return { tu, den, nhan: `${String(m + 1).padStart(2, "0")}/${y}` };
}

export type KetQuaHanMuc = { ok: true; conLaiSauKhiGhi: number } | { ok: false; ma: "KHONG_PHAI_HOC_VIEN_PHU_TRACH" | "CHUA_CO_HAN_MUC" | "VUOT_HAN_MUC" | "SO_COIN_KHONG_HOP_LE"; loi: string };

export function kiemTraCapCoinGiaoVien(p: {
  /** Hạn mức/tháng Admin đặt; `null` = chưa đặt. */
  capThang: number | null;
  /** Σ|amount| giáo viên đã ghi trong THÁNG này (từ sổ cái). */
  daDungTrongThang: number;
  /** Số coin lần này (dương = cộng, âm = trừ). */
  amount: number;
  laHocVienPhuTrach: boolean;
}): KetQuaHanMuc {
  if (!Number.isInteger(p.amount) || p.amount === 0) return { ok: false, ma: "SO_COIN_KHONG_HOP_LE", loi: "Số coin phải là số nguyên khác 0" };
  // Thứ tự: phạm vi học viên trước (không để lộ thông tin hạn mức cho học viên ngoài phạm vi), rồi hạn mức.
  if (!p.laHocVienPhuTrach) return { ok: false, ma: "KHONG_PHAI_HOC_VIEN_PHU_TRACH", loi: "Thầy/cô chỉ cộng/trừ coin cho học viên mình phụ trách" };
  if (p.capThang === null) return { ok: false, ma: "CHUA_CO_HAN_MUC", loi: "Admin chưa đặt hạn mức SataCoin cho thầy/cô" };
  const conLai = p.capThang - p.daDungTrongThang;
  const can = Math.abs(p.amount);
  if (can > conLai) return { ok: false, ma: "VUOT_HAN_MUC", loi: `Vượt hạn mức tháng (còn ${Math.max(0, conLai)} coin, cần ${can})` };
  return { ok: true, conLaiSauKhiGhi: conLai - can };
}
