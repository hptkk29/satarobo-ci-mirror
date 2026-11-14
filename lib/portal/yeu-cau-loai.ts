// lib/portal/yeu-cau-loai.ts — danh mục LOẠI yêu cầu của phụ huynh (12/11/2026), THUẦN (không DB, dùng được ở client).
//
// Mục «Yêu cầu» đổi thành «Gửi yêu cầu đến trung tâm»: màn đầu liệt kê các loại, mỗi loại một màn riêng
// (`/portal/yeu-cau/<slug>`), đúng board thiết kế M-Yeu-cau. Mỗi loại ánh xạ MỘT giá trị `ParentRequestType` sẵn có
// — KHÔNG thêm enum/migration. Yêu cầu của phụ huynh luôn chỉ là bản ghi để nhân viên xử lý, không tự xếp lịch.
import type { ParentRequestType } from "@prisma/client";

export type SlugYeuCau = "hoc-bu" | "nghi" | "bao-luu" | "doi-lop" | "doi-co-so" | "khac";

export type LoaiYeuCau = {
  slug: SlugYeuCau;
  type: Extract<ParentRequestType, "MAKEUP" | "ABSENCE" | "RESERVE" | "TRANSFER_CLASS" | "TRANSFER_CENTER" | "OTHER">;
  ten: string;
  mo: string;
};

export const LOAI_YEU_CAU: readonly LoaiYeuCau[] = [
  { slug: "hoc-bu", type: "MAKEUP", ten: "Học bù", mo: "Chọn buổi con vắng cần bù" },
  { slug: "nghi", type: "ABSENCE", ten: "Xin nghỉ", mo: "Báo trước buổi con sẽ vắng" },
  { slug: "bao-luu", type: "RESERVE", ten: "Bảo lưu", mo: "Tạm dừng khoá, giữ học phí" },
  { slug: "doi-lop", type: "TRANSFER_CLASS", ten: "Chuyển lớp", mo: "Đổi sang lớp, giờ khác" },
  { slug: "doi-co-so", type: "TRANSFER_CENTER", ten: "Chuyển cơ sở", mo: "Học ở cơ sở khác của trung tâm" },
  { slug: "khac", type: "OTHER", ten: "Yêu cầu khác", mo: "Việc khác cần trung tâm hỗ trợ" },
];

export const loaiTheoSlug = (slug: string): LoaiYeuCau | undefined => LOAI_YEU_CAU.find((l) => l.slug === slug);

/** Chuỗi `YYYY-MM-DD` + `HH:mm` → giá trị gửi lên server (`YYYY-MM-DDTHH:mm`, server đọc theo đồng hồ VN). */
export function ghepNgayGio(ngay: string, gio: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay) || !/^\d{2}:\d{2}$/.test(gio)) return null;
  return `${ngay}T${gio}`;
}

/** Nội dung gửi lên (cột `content`, ≥ 5 ký tự): ghép các ý phụ huynh chọn/nhập thành MỘT đoạn nhân viên đọc được. */
export function noiDungYeuCau(phan: readonly (string | null | undefined | false)[]): string {
  return phan
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

export const LY_DO_BAO_LUU = ["Con ốm dài ngày (có giấy y tế)", "Gia đình chuyển nơi ở", "Việc gia đình", "Lý do khác"] as const;
export const KHUNG_GIO_MONG_MUON = ["Sáng", "Chiều", "Tối", "Cuối tuần", "Ngày thường"] as const;
export const CHU_DE_KHAC = ["Học phí & hoá đơn", "Lịch học", "Giáo viên & lớp", "Tài khoản & ứng dụng", "Khác"] as const;

/**
 * Kiểm ngày + giờ phụ huynh TỰ ĐỀ XUẤT cho buổi học bù (13/11/2026 — bỏ khung giờ cố định, ba mẹ nhập tự do). `null` = hợp lệ; chuỗi = câu báo lỗi hiện cạnh ô.
 * Chỉ kiểm cái chắc chắn sai (thiếu, sai dạng, ngày đã qua, giờ giữa đêm). Trung tâm có xếp được khung đó hay không là việc của Sale khi liên hệ lại — không chặn ở đây.
 * `homNay` = `YYYY-MM-DD` giờ VN.
 */
export function loiDeXuatBu(ngay: string, gio: string, homNay: string): string | null {
  if (!ngay) return "Ba mẹ chọn ngày muốn bù giúp nhé.";
  if (!gio) return "Ba mẹ nhập giờ muốn bù giúp nhé.";
  if (ghepNgayGio(ngay, gio) === null) return "Ngày hoặc giờ chưa đúng dạng — ba mẹ chọn lại giúp nhé.";
  if (ngay < homNay) return "Ngày đã qua — ba mẹ chọn một ngày sắp tới nhé.";
  if (gio < "06:00" || gio > "22:00") return "Giờ học nằm trong khoảng 06:00 – 22:00 — ba mẹ chọn lại giúp nhé.";
  return null;
}
