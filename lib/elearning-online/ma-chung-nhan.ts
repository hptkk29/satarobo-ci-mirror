/**
 * E-LEARNING ONLINE — MÃ CHỨNG NHẬN (C10, Owner 25/11/2026). HÀM THUẦN (dùng được ở server, PDF và component client).
 *
 * Bất biến:
 * 1. Mã cấp MỚI LƯU dạng `SRON` + 10 ký tự ngẫu nhiên (`OnlCertificate.code`, khoá tra cứu; không migration), HIỂN THỊ `SR-ON-<10 ký tự>`.
 * 2. Mã cấp TRƯỚC C10 giữ nguyên (lưu và hiển thị) — đường tra cứu nhận cả hai.
 * 3. Không nhầm được cũ ↔ mới: `BANG_MA` không có chữ `O` nên mã ngẫu nhiên cũ không bao giờ bắt đầu bằng `SRON`.
 */
export const BANG_MA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // không I, L, O, 0, 1
export const DO_DAI_DUOI_MA = 10;
export const TIEN_TO_MA_CN = "SRON";
const TIEN_TO_HIEN_THI = "SR-ON-";

const DANG_MOI = new RegExp(`^${TIEN_TO_MA_CN}([${BANG_MA}]{${DO_DAI_DUOI_MA}})$`);

/** Mã ĐÃ LƯU → chuỗi cho NGƯỜI đọc. Mã dạng khác (cấp trước C10) trả nguyên. */
export function hienThiMaChungNhan(code: string): string {
  const m = DANG_MOI.exec(code);
  return m ? `${TIEN_TO_HIEN_THI}${m[1]}` : code;
}

/** Chuỗi NGƯỜI GÕ / trên URL → mã ĐÃ LƯU: bỏ khoảng trắng hai đầu, in hoa, đổi tiền tố hiển thị `SR-ON-` về `SRON`. Không sửa gì khác (kiểm định dạng là việc của nơi gọi). */
export function chuanHoaMaChungNhan(nhap: string): string {
  const m = nhap.trim().toUpperCase();
  return m.startsWith(TIEN_TO_HIEN_THI) ? `${TIEN_TO_MA_CN}${m.slice(TIEN_TO_HIEN_THI.length)}` : m;
}
