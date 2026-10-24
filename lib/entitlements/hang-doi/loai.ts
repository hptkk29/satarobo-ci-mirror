// lib/entitlements/hang-doi/loai.ts — TỪ ĐIỂN LOẠI / TRẠNG THÁI CỦA HÀNG ĐỢI QUYỀN HỌC. THUẦN, không DB, không server-only (giao diện import được).
//
// Nguồn thật là enum `EntitlementXuLyLoai` / `EntitlementXuLyTrangThai` của schema; lưới `[HD-W*]` so hai bên. Nhãn tiếng Việt và "ai tạo / ai đóng"
// ở đây là thứ người vận hành đọc — bảng đối chiếu đầy đủ ở docs/thu-hoc-phi-pham-vi/HANG-DOI-VAN-HANH.md.

export const LOAI_HANG_DOI = [
  "CHO_CHUYEN_DOI",
  "CHO_XEP_LOP",
  "CHO_DUYET_HOC_VUOT",
  "CAN_THU_HOI",
  "TREO_DUYET_TAY",
  "THIEU_QUYEN_HOC",
  "LECH_DU_LIEU",
] as const;
export type LoaiHangDoi = (typeof LOAI_HANG_DOI)[number];

export const TRANG_THAI_HANG_DOI = ["OPEN", "DA_XU_LY", "HUY"] as const;
export type TrangThaiHangDoi = (typeof TRANG_THAI_HANG_DOI)[number];

export const NHAN_LOAI: Readonly<Record<LoaiHangDoi, string>> = {
  CHO_CHUYEN_DOI: "Chờ Chuyển đổi (chưa có học viên)",
  CHO_XEP_LOP: "Chờ xếp lớp",
  CHO_DUYET_HOC_VUOT: "Xin duyệt học vượt thêm (vượt trần)",
  CAN_THU_HOI: "Cần thu hồi quyền học (chưa học buổi nào)",
  TREO_DUYET_TAY: "Treo duyệt tay (đã có buổi tiêu thụ)",
  THIEU_QUYEN_HOC: "Đủ tiền nhưng thiếu quyền học",
  LECH_DU_LIEU: "Dữ liệu lệch",
};

export const NHAN_TRANG_THAI: Readonly<Record<TrangThaiHangDoi, string>> = {
  OPEN: "Đang mở",
  DA_XU_LY: "Đã xử lý",
  HUY: "Đã huỷ / hết cần",
};

/** Ai TẠO và ai ĐÓNG tự động từng loại — để người vận hành biết dòng nào máy tự đóng khi điều kiện hết, dòng nào chỉ người đóng được. */
export const AI_QUAN_LY_LOAI: Readonly<Record<LoaiHangDoi, { tao: string; dong: string }>> = {
  CHO_CHUYEN_DOI: { tao: "cap-tu-don (đường tiền hích + cron)", dong: "cap-tu-don khi cấp được quyền học / tiền không còn đủ; hoặc người xử lý" },
  CHO_XEP_LOP: { tao: "xep-lop-tu-don (đường tiền hích)", dong: "xep-lop-tu-don khi chốt được phạm vi bài / hết cần; hoặc người xử lý" },
  CHO_DUYET_HOC_VUOT: { tao: "xep-lop-tu-don (lúc chốt phạm vi, khi số bài học vượt vượt trần)", dong: "CHỈ người: duyệt (entitlements:approve-exception) hoặc đóng / từ chối có lý do (entitlements:manage) — máy không tự đóng" },
  CAN_THU_HOI: { tao: "cap-tu-don (đường tiền hích + cron)", dong: "cap-tu-don khi tiền đủ lại; hoặc người xử lý (thu hồi / giữ quyền)" },
  TREO_DUYET_TAY: { tao: "cap-tu-don (đường tiền hích + cron) · hoặc người bấm 'Cần duyệt tay'", dong: "cap-tu-don khi tiền đủ lại; hoặc người xử lý (giữ quyền / đóng)" },
  THIEU_QUYEN_HOC: { tao: "cap-tu-don ở chế độ CHI_GHI_NHAN (cron)", dong: "cap-tu-don khi đã có quyền học / điều kiện hết; hoặc người xử lý" },
  LECH_DU_LIEU: { tao: "cron đối soát (doi-soat-lech)", dong: "cron khi dữ liệu khớp lại; hoặc người xử lý" },
};

export const laLoaiHangDoi = (x: unknown): x is LoaiHangDoi => typeof x === "string" && (LOAI_HANG_DOI as readonly string[]).includes(x);
export const laTrangThaiHangDoi = (x: unknown): x is TrangThaiHangDoi => typeof x === "string" && (TRANG_THAI_HANG_DOI as readonly string[]).includes(x);

/**
 * Ngưỡng "quá hạn": dòng ĐANG MỞ mà `updatedAt` cũ hơn ngần này là bị bỏ quên. Hằng có tên (không phải cài đặt) — đổi con số = đổi mã + docs. Cron chỉ ĐẾM và báo,
 * KHÔNG ghi gì lên dòng (đo bằng `updatedAt` nên mọi lần dòng đổi — mở lại, đổi lý do — tự đặt lại đồng hồ; không có cờ "quá hạn" nào để thành cũ).
 */
export const NGUONG_QUA_HAN_MS = 72 * 3_600_000;

export function laQuaHan(dong: { readonly trangThai: TrangThaiHangDoi; readonly updatedAt: Date }, now: Date): boolean {
  return dong.trangThai === "OPEN" && now.getTime() - dong.updatedAt.getTime() >= NGUONG_QUA_HAN_MS;
}
