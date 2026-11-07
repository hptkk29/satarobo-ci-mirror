// lib/finance/hoa-don/ky-hieu.ts — ký hiệu hoá đơn điện tử theo năm phát hành. THUẦN.
//
// Hình dạng (TT 78/2021): [1 chữ số loại HĐ][C|K][2 chữ số NĂM][1 chữ loại hình][2 ký tự tự đặt],
// vd `1C26TSR`. Cấu hình pháp nhân (`phap-nhan.ts`) giữ ký hiệu của MỘT năm; hàm ở đây đổi hai chữ
// số năm theo NGÀY PHÁT HÀNH mà kế toán chọn — không theo ngày tiền về, không theo đồng hồ.

const HINH_DANG = /^([1-6][CK])(\d{2})([A-Z])([A-Z0-9]{2})$/;

function chuan(kyHieu: string): string {
  return kyHieu.trim().toUpperCase();
}

/**
 * Năm (2 chữ số) của một ngày `@db.Date` — nửa đêm UTC, đọc trường UTC.
 *
 * ⚠️ `getUTCFullYear`, KHÔNG `getFullYear`. Lưới KHÔNG canh được chỗ này: `vitest.config.ts` ép
 * `TZ=UTC` cho mọi test (và máy chủ Vercel cũng chạy UTC), nên hai hàm luôn trùng nhau trong test
 * — phép cấy 26/09 đổi sang `getFullYear` để 176/176 xanh. Sai chỉ lộ khi hàm chạy ở trình duyệt
 * múi giờ ÂM (nửa đêm UTC 01/01 là 31/12 giờ địa phương). Đừng "sửa cho gọn".
 */
function nam2(ngay: Date): string {
  return String(ngay.getUTCFullYear() % 100).padStart(2, "0");
}

/** Ký hiệu điền sẵn: đổi hai chữ số năm của mẫu theo năm phát hành. Mẫu sai hình dạng ⇒ giữ nguyên. */
export function kyHieuTheoNam(kyHieuMau: string, ngayPhatHanh: Date): string {
  const m = HINH_DANG.exec(chuan(kyHieuMau));
  if (!m) return kyHieuMau;
  return `${m[1]}${nam2(ngayPhatHanh)}${m[3]}${m[4]}`;
}

/** Đúng HÌNH DẠNG ký hiệu (chưa so năm) — dùng khi kế toán lưu nháp chưa chọn ngày phát hành. */
export function dungHinhDangKyHieu(kyHieu: string): boolean {
  return HINH_DANG.test(chuan(kyHieu));
}

/** `null` = hợp lệ; ngược lại là câu lỗi tiếng Việt cho người dùng. */
export function kiemKyHieu(kyHieu: string, ngayPhatHanh: Date): string | null {
  const m = HINH_DANG.exec(chuan(kyHieu));
  if (!m) return "Ký hiệu hoá đơn không đúng dạng (ví dụ đúng: 1C26TSR).";
  if (m[2] !== nam2(ngayPhatHanh)) {
    return (
      `Ký hiệu mang năm "${m[2]}" nhưng ngày phát hành thuộc năm ${ngayPhatHanh.getUTCFullYear()}` +
      ` — hoá đơn phát hành năm nào mang hai số của năm đó.`
    );
  }
  return null;
}
