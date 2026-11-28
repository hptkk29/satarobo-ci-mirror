/**
 * WORKSTREAM A — "HỒ SƠ PH/HV ĐỦ ĐỂ MUA KHOÁ ONLINE". THUẦN, một chỗ cho cổng mua VÀ màn hình (không chép điều kiện ở chỗ gọi).
 *
 * ⚠️ ĐỀ XUẤT — chủ dự án chưa chốt danh sách bắt buộc (xem `ONLINE-ORDER-CONTRACT.md` mục "Quyết định mở"). Tập tối thiểu CHỈ gồm thứ
 * mà các luồng sau mua thật sự dùng: tên + SĐT phụ huynh (biên nhận/ZNS/tra cứu đơn), tên học viên (giấy chứng nhận). Email KHÔNG bắt buộc
 * (đăng nhập bằng SĐT là luồng chính của cổng PH). Thêm/bớt trường ⇒ sửa DUY NHẤT hằng bên dưới + ca `[OHS-*]`.
 */

export type HoSoPhuHuynhMua = { name?: string | null; phone?: string | null };
export type HoSoHocVienMua = { name?: string | null };

export const TRUONG_BAT_BUOC_PHU_HUYNH = [
  { khoa: "name", nhan: "họ tên phụ huynh" },
  { khoa: "phone", nhan: "số điện thoại phụ huynh" },
] as const satisfies readonly { khoa: keyof HoSoPhuHuynhMua; nhan: string }[];

export const TRUONG_BAT_BUOC_HOC_VIEN = [{ khoa: "name", nhan: "họ tên học viên" }] as const satisfies readonly {
  khoa: keyof HoSoHocVienMua;
  nhan: string;
}[];

const trong = (v: string | null | undefined) => v == null || v.trim() === "";

/** Danh sách NHÃN trường còn thiếu của phụ huynh (rỗng = đủ). */
export function thieuHoSoPhuHuynh(ph: HoSoPhuHuynhMua): string[] {
  return TRUONG_BAT_BUOC_PHU_HUYNH.filter((t) => trong(ph[t.khoa])).map((t) => t.nhan);
}

/** Danh sách NHÃN trường còn thiếu của học viên (rỗng = đủ). */
export function thieuHoSoHocVien(hv: HoSoHocVienMua): string[] {
  return TRUONG_BAT_BUOC_HOC_VIEN.filter((t) => trong(hv[t.khoa])).map((t) => t.nhan);
}

export function cauThieuHoSo(thieu: readonly string[], ai: "phụ huynh" | "học viên"): string {
  return `Hồ sơ ${ai} chưa đủ: thiếu ${thieu.join(", ")}. Hãy bổ sung trước khi mua khoá.`;
}
