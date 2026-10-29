// lib/students/xuat-nhan-xet.ts — phần THUẦN của nút "Xuất nhận xét" ở hồ sơ học viên: kiểu dòng chọn, trần số buổi,
// thứ tự danh sách chọn, dựng URL. Tách khỏi component để test được và để route PDF dùng CHUNG trần số buổi với hộp chọn.

export type BuoiXuatDuoc = {
  /** id phiếu nhận xét (StudentSessionFeedback). */
  id: string;
  buoi: number | null;
  /** dd/MM/yyyy */
  ngay: string;
  lop: string | null;
  /** Tên dự án / tiêu đề buổi — chỉ để người chọn nhận ra buổi nào. */
  ten: string;
};

/** Trần số buổi một lần xuất — giữ URL dưới giới hạn đầu dòng và PDF dựng trong thời gian hợp lý. */
export const TOI_DA_BUOI_MOT_LAN = 100;

/** Danh sách chọn xếp theo LỚP rồi BUỔI tăng dần (cùng thứ tự các trang trong PDF); buổi không tra được số xuống cuối lớp. */
export function sapXepDanhSachChon(ds: BuoiXuatDuoc[]): BuoiXuatDuoc[] {
  return [...ds].sort(
    (a, b) =>
      (a.lop ?? "").localeCompare(b.lop ?? "", "vi") ||
      (a.buoi ?? Number.MAX_SAFE_INTEGER) - (b.buoi ?? Number.MAX_SAFE_INTEGER),
  );
}

export function dungDuongDanXuat(studentId: string, ids: string[]): string {
  const q = new URLSearchParams({ studentId });
  for (const id of ids) q.append("feedbackId", id);
  return `/api/admin/reports/nhan-xet-buoi?${q.toString()}`;
}
