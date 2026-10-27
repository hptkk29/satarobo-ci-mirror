// lib/cham-cong/zns-cham-cong-thuan.ts — P2.6 phần THUẦN của kênh ZNS cho nhân sự (chấm công). Không chạm DB.
//
// Chủ dự án chốt (D-03, 11/10/2026): giai đoạn này chỉ IN-APP + WEB PUSH; ZNS thật chỉ sau khi Zalo DUYỆT mẫu.
// Bộ chuyển ở đây dựng sẵn để ngày có mẫu chỉ còn là điền mã mẫu + bật công tắc — KHÔNG đổi mã.
//
// Tắt an toàn NHIỀU TẦNG, tầng nào rỗng cũng KHÔNG gọi nhà cung cấp:
//   1. `shift.znsBat` = false            → không gửi (mặc định);
//   2. mã mẫu của loại tin rỗng          → không gửi (mẫu chưa duyệt) — kể cả khi ZALO_LIVE bật;
//   3. người nhận không có SĐT           → không gửi;
//   4. đã có lượt GỬI THÀNH CÔNG cùng (SĐT × mẫu × dữ liệu) → không gửi lại (dispatcher thử lại sau lỗi).

export const LOAI_ZNS_CHAM_CONG = ["MOI_XAC_NHAN", "KHIEU_NAI_XU_LY"] as const;
export type LoaiZnsChamCong = (typeof LOAI_ZNS_CHAM_CONG)[number];

/**
 * Tham số mẫu (template_data) theo loại. Mẫu đăng ký với Zalo PHẢI có đúng các khoá này — khác tên là Zalo
 * từ chối mọi tin. Chuỗi ngắn, không PII ngoài TÊN người nhận (chính họ).
 */
export const ZNS_CHAM_CONG_PARAM_SPEC: Record<LoaiZnsChamCong, readonly string[]> = {
  MOI_XAC_NHAN: ["ten", "ky"],
  KHIEU_NAI_XU_LY: ["ten", "ky", "ket_qua"],
};

/** Khoá cấu hình chứa mã mẫu của từng loại. */
export const KHOA_MAU_ZNS: Record<LoaiZnsChamCong, "shift.znsMauMoiXacNhan" | "shift.znsMauKhieuNai"> = {
  MOI_XAC_NHAN: "shift.znsMauMoiXacNhan",
  KHIEU_NAI_XU_LY: "shift.znsMauKhieuNai",
};

export type LyDoKhongGui = "TAT" | "CHUA_CO_MAU" | "KHONG_SDT" | "DA_GUI";

/**
 * Có gửi không. ⚠️ Mọi trường BẮT BUỘC (luật 7 — gửi tin nằm trong danh sách "mặc định nguy hiểm"): quên
 * truyền `mau` hay `daGui` là lỗi biên dịch, không phải lặng lẽ rơi về "gửi".
 */
export function quyetDinhZnsChamCong(i: {
  bat: boolean;
  mau: string;
  sdt: string | null;
  daGui: boolean;
}): { gui: true } | { gui: false; lyDo: LyDoKhongGui } {
  if (!i.bat) return { gui: false, lyDo: "TAT" };
  if (!/^\d+$/.test(i.mau.trim())) return { gui: false, lyDo: "CHUA_CO_MAU" };
  if (!i.sdt || !i.sdt.trim()) return { gui: false, lyDo: "KHONG_SDT" };
  if (i.daGui) return { gui: false, lyDo: "DA_GUI" };
  return { gui: true };
}

/** Dựng template_data đúng khuôn — cắt độ dài (ZNS giới hạn ~30 ký tự/tham số chuỗi ngắn). */
export function thamSoZnsChamCong(
  loai: LoaiZnsChamCong,
  v: { ten: string; ky: string; ketQua?: string },
): Record<string, string> {
  const cat = (s: string, n: number) => (Array.from(s).length > n ? Array.from(s).slice(0, n - 1).join("") + "…" : s);
  const kyVn = /^\d{4}-\d{2}$/.test(v.ky) ? `${v.ky.slice(5)}/${v.ky.slice(0, 4)}` : v.ky;
  if (loai === "MOI_XAC_NHAN") return { ten: cat(v.ten, 30), ky: kyVn };
  return { ten: cat(v.ten, 30), ky: kyVn, ket_qua: cat(v.ketQua ?? "", 30) };
}
