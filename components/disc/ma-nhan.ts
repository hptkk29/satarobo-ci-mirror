/**
 * Định dạng HIỂN THỊ mã nhận ở phía trình duyệt. Bản sao có chủ đích của `hienThiMaNhan`
 * (lib/disc/luu.ts) vì tệp đó kéo `node:crypto` nên máy khách không import được.
 * Khi backend tách `lib/disc/chinh-sach.ts` (module thuần) thì đổi sang import hàm gốc — xem handoff.
 * Chỉ để hiển thị: server không tin chuỗi này, nó tự chuẩn hoá lại (`chuanHoaMaNhan`).
 */
export const DO_DAI_MA_NHAN_HIEN_THI = 10;

/** "ABCDEFGHJK" ⇒ "ABCDE-FGHJK". Độ dài lạ thì trả nguyên xi (không đoán). */
export function dinhDangMaNhan(ma: string): string {
  return ma.length === DO_DAI_MA_NHAN_HIEN_THI ? `${ma.slice(0, 5)}-${ma.slice(5)}` : ma;
}
