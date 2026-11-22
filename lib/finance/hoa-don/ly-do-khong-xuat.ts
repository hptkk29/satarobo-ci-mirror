// lib/finance/hoa-don/ly-do-khong-xuat.ts — lý do CỐ ĐỊNH khi kế toán đánh dấu "không xuất" một lần
// thu. THUẦN. Nguồn DUY NHẤT của các chuỗi này: action ghi (`khongXuatHoaDonAction`), biểu mẫu của kế
// toán và khối "Hoá đơn điện tử" trên trang đơn (GĐ 7) cùng đọc ở đây.
//
// ⚠️ Chuỗi được LƯU NGUYÊN VĂN vào `HoaDonDienTu.lyDo` — đổi chữ ở đây là các bản ghi cũ không còn
// khớp nữa (khối trang đơn sẽ đọc chúng thành lý do tự do). Muốn đổi cách hiển thị thì đổi ở chỗ
// hiển thị, đừng đổi hằng.

/** Hoá đơn ĐÃ có, xuất ở MISA trước khi có hệ thống — lý do mặc định (PLAN §2.1, 26/09). */
export const LY_DO_DA_XUAT_NGOAI = "Đã xuất ngoài hệ thống" as const;
export const LY_DO_KHACH_KHONG_LAY = "Khách không lấy hoá đơn" as const;
export const LY_DO_KHONG_XUAT_CO_DINH = [LY_DO_DA_XUAT_NGOAI, LY_DO_KHACH_KHONG_LAY] as const;
/** Lý do tự do của kế toán lưu với tiền tố này — có thể chứa thông tin khách, hiển thị có gác. */
export const TIEN_TO_LY_DO_KHAC = "Khác: " as const;

export function laLyDoCoDinh(lyDo: string | null | undefined): boolean {
  return (LY_DO_KHONG_XUAT_CO_DINH as readonly string[]).includes(lyDo ?? "");
}
