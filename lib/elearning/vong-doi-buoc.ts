/**
 * QtSoanKhoa — "Vòng đời khoá": BỐN bước hiển thị theo thiết kế (Nháp · Chờ duyệt · Đã duyệt → xuất bản · Lưu trữ) và bước HIỆN TẠI của khoá.
 *
 * Chỉ là PHÉP ĐỌC trạng thái đã có (`TrnCourse.status` + trạng thái các phiên bản) để vẽ — không quyết thao tác nào được phép (cổng thật ở `vongDoiKhoa`).
 * Thứ tự ưu tiên: khoá đã lưu trữ ⇒ bước 4; có bản NHÁP (kể cả khi khoá đang phát hành — người soạn đang làm bản kế tiếp) ⇒ bước 1; có bản chờ duyệt ⇒ bước 2;
 * có bản đã duyệt hoặc đang phát hành ⇒ bước 3; khoá chưa có bản nào ⇒ bước 1.
 */
export const BUOC_VONG_DOI = [
  { ma: "NHAP", nhan: "Nháp", moTa: "" },
  { ma: "CHO_DUYET", nhan: "Chờ duyệt", moTa: "người khác người soạn duyệt" },
  { ma: "DA_DUYET", nhan: "Đã duyệt → xuất bản", moTa: "" },
  { ma: "LUU_TRU", nhan: "Lưu trữ", moTa: "" },
] as const;

export type MaBuocVongDoi = (typeof BUOC_VONG_DOI)[number]["ma"];

export function buocVongDoiKhoa(
  trangThaiKhoa: string,
  phienBan: readonly { status: string }[],
): MaBuocVongDoi {
  if (trangThaiKhoa === "ARCHIVED") return "LUU_TRU";
  const co = (s: string) => phienBan.some((v) => v.status === s);
  if (co("DRAFT")) return "NHAP";
  if (co("PENDING_REVIEW")) return "CHO_DUYET";
  if (co("APPROVED") || co("PUBLISHED")) return "DA_DUYET";
  return "NHAP";
}
