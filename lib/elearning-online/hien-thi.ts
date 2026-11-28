import type { SacThai } from "@/lib/elearning/dashboard-pure";
import type { TrangThaiHieuLuc } from "./quyen-hoc";

/**
 * E-LEARNING ONLINE — NHÃN HIỂN THỊ (hàm THUẦN, test được): tiền · thời hạn · trạng thái bán · trạng thái quyền · loại bài · sự kiện quyền.
 * Mỗi nhãn đi kèm sắc thái; màu KHÔNG đứng một mình (luôn có chữ).
 */

export const dinhDangTien = (v: number): string => `${new Intl.NumberFormat("vi-VN").format(v)}đ`;

export const nhanThoiHan = (thang: number | null): string => (thang === null ? "Trọn đời" : `${thang} tháng`);

const NGAY = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });
export const dinhDangNgay = (d: Date | string | null | undefined): string => (d ? NGAY.format(new Date(d)) : "—");

export const NHAN_BAN: Record<string, { nhan: string; sac: SacThai }> = {
  ON_SALE: { nhan: "Đang bán", sac: "success" },
  NOT_ON_SALE: { nhan: "Chưa bán", sac: "muted" },
  SCHEDULED: { nhan: "Hẹn giờ mở bán", sac: "warning" },
  PAUSED: { nhan: "Tạm ngừng", sac: "danger" },
};

export const NHAN_QUYEN: Record<TrangThaiHieuLuc, { nhan: string; sac: SacThai }> = {
  CON_HAN: { nhan: "Còn hạn", sac: "success" },
  SAP_HET_HAN: { nhan: "Sắp hết hạn", sac: "warning" },
  HET_HAN: { nhan: "Hết hạn", sac: "danger" },
  THU_HOI: { nhan: "Đã thu hồi", sac: "muted" },
};

export const NHAN_LOAI_BAI: Record<string, string> = {
  VIDEO: "Video",
  READ: "Bài đọc",
  ASSIGNMENT: "Bài tập",
  QUIZ: "Kiểm tra",
  FINAL_EXAM: "Thi cuối khoá",
};

export const NHAN_SU_KIEN: Record<string, string> = {
  GRANTED: "Cấp quyền",
  RENEWED: "Gia hạn",
  REOPENED_AFTER_EXPIRY: "Mua lại sau hết hạn",
  REOPENED_AFTER_REVOKE: "Mở lại sau thu hồi",
  REVOKED: "Thu hồi quyền",
};

export const NHAN_CHINH_SACH: Record<string, { nhan: string; moTa: string }> = {
  KEEP_PROGRESS: { nhan: "Giữ nguyên tiến độ", moTa: "Không ai phải học lại bài đã xong. Bài mới bắt buộc thêm vào cuối tiến độ của từng người." },
  RELEARN_SELECTED: { nhan: "Học lại các bài đã sửa được chọn", moTa: "Chỉ người ĐÃ XONG bài sửa được chọn mới phải học lại bài đó. Người chưa tới bài không bị tính." },
  RESET_BY_SCOPE: { nhan: "Đặt lại theo chương", moTa: "Đặt lại tiến độ các bài trong chương được chọn cho mọi học viên đang học. Điểm và chứng nhận không bị đụng." },
  ADD_NEW_ONLY: { nhan: "Chỉ thêm bài mới", moTa: "Không đụng bài cũ, kể cả bài đã sửa. Chỉ bài mới bắt buộc được thêm vào." },
};

/** "Sắp hết hạn · 12 ngày" / "Hết hạn" / "Trọn đời" — dòng phụ dưới ngày hạn. */
export function nhanConLai(trangThai: TrangThaiHieuLuc, hetHan: Date | null, now: Date): string {
  if (trangThai === "THU_HOI") return "Đã thu hồi";
  if (hetHan === null) return "Trọn đời";
  if (trangThai === "HET_HAN") return "Đã hết hạn";
  const ngay = Math.max(0, Math.ceil((hetHan.getTime() - now.getTime()) / 86_400_000));
  return trangThai === "SAP_HET_HAN" ? `Sắp hết hạn · ${ngay} ngày` : `Còn ${ngay} ngày`;
}

/** Nhãn cột "Nội dung" của danh sách khoá. */
export function nhanNoiDungKhoa(d: { banChay: number | null; coBanNhap: boolean }): { nhan: string; sac: SacThai } {
  if (d.banChay !== null && d.coBanNhap) return { nhan: `Bản ${d.banChay} · có bản nháp`, sac: "warning" };
  if (d.banChay !== null) return { nhan: `Bản ${d.banChay}`, sac: "success" };
  return { nhan: d.coBanNhap ? "Nháp" : "Chưa có nội dung", sac: "muted" };
}

/** Hai ký tự đầu mã khoá làm "ảnh bìa" tạm (khi chưa có ảnh): `ONL-RS1` → `RS1`. */
export const chuVietTatKhoa = (code: string): string => code.replace(/^ONL-/, "").slice(0, 3);

/** Liên kết sang trang quản trị chung (khác host `e-learning`): phiếu lead / hồ sơ học viên. Gốc lấy từ `ADMIN_APP_URL`, mặc định host admin thật. */
export const urlQuanTri = (duong: string): string => `${(process.env.ADMIN_APP_URL ?? "https://admin.satarobo.vn").replace(/\/+$/, "")}${duong.startsWith("/") ? duong : `/${duong}`}`;
