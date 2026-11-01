// lib/lms/phan-trang-ngay.ts — phép tính phân trang cho MỘT ô ngày của lịch tháng.
//
// THUẦN (không React, không DOM) để test được bảng biên. Ô ngày
// (`components/lms/day-cell-events.tsx`) chỉ giữ số trang đang xem rồi gọi vào đây.

/** Số lớp in ra mỗi trang của một ô ngày (chủ dự án chốt 5 — 05/09/2026). */
export const MOI_TRANG = 5;

export type TrangNgay = {
  /** Tổng số trang, LUÔN ≥ 1 (ngày rỗng vẫn là "trang 1/1", không phải 0/0). */
  soTrang: number;
  /** Trang thực sự được hiển thị, đã kẹp vào [0, soTrang-1]. */
  trangHienTai: number;
  /** Chỉ số phần tử đầu của trang — dùng luôn làm tiền tố khoá React. */
  dau: number;
  /** Có nhiều hơn một trang ⇒ mới bày nút lật. */
  coPhanTrang: boolean;
};

/**
 * `trang` được KẸP chứ không tin thẳng.
 *
 * Ô ngày giữ số trang trong state của chính nó, mà danh sách lớp thì đổi dưới chân
 * nó: đổi tháng, lọc lại, hoặc buổi bị huỷ. Đang đứng ở trang 3 mà ngày rút còn 4
 * lớp thì không kẹp là ô hiện RỖNG — trông y như ngày không có lớp nào.
 */
export function tinhTrangNgay(
  soMuc: number,
  trang: number,
  moiTrang: number = MOI_TRANG,
): TrangNgay {
  const buoc = Math.max(1, moiTrang);
  const soTrang = Math.max(1, Math.ceil(Math.max(0, soMuc) / buoc));
  const trangHienTai = Math.min(Math.max(0, trang), soTrang - 1);
  return {
    soTrang,
    trangHienTai,
    dau: trangHienTai * buoc,
    coPhanTrang: soMuc > buoc,
  };
}
