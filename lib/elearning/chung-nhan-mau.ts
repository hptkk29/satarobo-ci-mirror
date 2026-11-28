/**
 * P8/QtMauCN — ĐẶC TẢ HIỆN HÀNH của mẫu chứng nhận + đánh giá ảnh hưởng đổi mẫu. THUẦN, chỉ MÔ TẢ cái đang chạy; KHÔNG thay đổi cách sinh mã chứng nhận,
 * KHÔNG đổi khuôn PDF dùng chung (`lib/pdf/certificate.tsx` — dùng chung với chứng chỉ học viên offline, HANDOFF §5.2), KHÔNG cần migration.
 *
 * Mỗi chữ in trên khuôn hiện hành được khai ở `TRUONG_TU_DIEN`; lưới `[CNM-02]` đối chiếu với mã nguồn khuôn PDF để một chữ mới in lên giấy mà quên khai
 * ở đây thì ĐỎ (bảng "Chữ hệ thống tự điền" trên màn không được nói thiếu).
 */

export type ThoiDiemDoc = "chup-luc-cap" | "doc-song" | "tinh-luc-in";

export type TruongTuDien = {
  /** Tên trường trong `CertificateData` (đúng `d.<truong>` mà khuôn PDF dùng). */
  truong: string;
  chu: string;
  layTu: string;
  /** `chup-luc-cap`: ảnh chụp lúc cấp (không đổi khi hồ sơ đổi) · `doc-song`: đọc lại mỗi lần dựng PDF · `tinh-luc-in`: tính lúc dựng. */
  thoiDiem: ThoiDiemDoc;
  /** Có in ở bản của nhân viên (khoá nội bộ) / học viên online. Học viên online hiện CHƯA có bản PDF nên cột đó là kế hoạch, không phải hiện trạng. */
  nhanVien: boolean;
  hocVienOnline: boolean | "chua-co-pdf";
};

export const TRUONG_TU_DIEN: readonly TruongTuDien[] = [
  { truong: "studentName", chu: "Tên người nhận", layTu: "Họ tên chụp lúc cấp (`snapFullName`)", thoiDiem: "chup-luc-cap", nhanVien: true, hocVienOnline: "chua-co-pdf" },
  { truong: "studentCode", chu: "Mã nhân viên / học viên", layTu: "Mã chụp lúc cấp (`snapEmployeeCode`)", thoiDiem: "chup-luc-cap", nhanVien: true, hocVienOnline: "chua-co-pdf" },
  { truong: "courseName", chu: "Tên khoá học", layTu: "Tên khoá HIỆN TẠI (`TrnCourse.title`); khoá bị gỡ ⇒ \"(khoá đã bị gỡ khỏi danh mục)\"", thoiDiem: "doc-song", nhanVien: true, hocVienOnline: "chua-co-pdf" },
  { truong: "certificateCode", chu: "Mã chứng nhận", layTu: "`certCode` sinh lúc cấp — quy tắc mã hiện hành, KHÔNG đổi", thoiDiem: "chup-luc-cap", nhanVien: true, hocVienOnline: "chua-co-pdf" },
  { truong: "completedAt", chu: "Ngày cấp", layTu: "`issuedAt` của chứng nhận", thoiDiem: "chup-luc-cap", nhanVien: true, hocVienOnline: "chua-co-pdf" },
  { truong: "validityLine", chu: "Hiệu lực", layTu: "Tính từ `validUntil` + trạng thái (còn hiệu lực / hết hạn / thu hồi) — in cả khi hết hạn", thoiDiem: "tinh-luc-in", nhanVien: true, hocVienOnline: "chua-co-pdf" },
  { truong: "qrDataUrl", chu: "Mã QR xác minh", layTu: "Sinh từ `verifyToken` → trang xác minh công khai", thoiDiem: "tinh-luc-in", nhanVien: true, hocVienOnline: "chua-co-pdf" },
  { truong: "verifyUrl", chu: "Địa chỉ xác minh (chữ dưới QR)", layTu: "Gốc xác minh theo môi trường + `verifyToken`", thoiDiem: "tinh-luc-in", nhanVien: true, hocVienOnline: "chua-co-pdf" },
  { truong: "finalGrade", chu: "Xếp loại", layTu: "Chứng nhận nội bộ KHÔNG dùng (luôn rỗng); chỉ chứng chỉ học viên offline", thoiDiem: "tinh-luc-in", nhanVien: false, hocVienOnline: false },
];

/** Các trường `d.<ten>` mà khuôn PDF dùng — rút từ MÃ NGUỒN đã bỏ chú thích (lưới `[CNM-02]`). */
export function truongDungTrongKhuon(maNguon: string): string[] {
  const boChuThich = maNguon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  return [...new Set([...boChuThich.matchAll(/\bd\.([a-zA-Z]+)\b/g)].map((m) => m[1]!))].sort();
}

export type DemChungNhan = { conHieuLuc: number; hetHan: number; thuHoi: number };

/**
 * ẢNH HƯỞNG khi đổi khuôn: khuôn hiện hành KHÔNG ghi phiên bản lên chứng nhận, và bản PDF được dựng LẠI theo khuôn HIỆN HÀNH mỗi lần tải
 * (dữ liệu in là ảnh chụp lúc cấp, còn BỐ CỤC thì không). Hệ quả: đổi khuôn là đổi hình của MỌI chứng nhận đã cấp, kể cả đã in/gửi trước đó
 * (tờ in rồi thì không đổi — chỉ bản tải lại). Trả câu để màn hiển thị, kèm số liệu thật.
 */
export function danhGiaAnhHuong(dem: DemChungNhan): { soAnhHuong: number; canhBao: string[] } {
  const soAnhHuong = dem.conHieuLuc + dem.hetHan + dem.thuHoi;
  const canhBao = [
    "Khuôn hiện hành không ghi phiên bản lên chứng nhận: đổi khuôn là đổi hình bản PDF TẢI LẠI của mọi chứng nhận đã cấp.",
    "Tờ đã in / đã gửi trước đó không đổi; bản tải lại sẽ khác tờ cũ — hai bản cùng một số hiệu có thể trông khác nhau.",
  ];
  if (dem.thuHoi > 0) canhBao.push(`${dem.thuHoi} chứng nhận đã thu hồi cũng đổi hình (vẫn in dòng "đã thu hồi").`);
  return { soAnhHuong, canhBao };
}
