// lib/portal/tam-hoan-thu.ts — nhãn "kỳ đến hạn" của bé ĐANG BẢO LƯU theo quy chế (chốt 08/10/2026, mục C(c) + spec chốt 15).
//
// KHÔNG ẨN kỳ đến hạn của bé bảo lưu: ẩn là để phụ huynh tưởng khoản nợ đã biến mất. Hiện nó, nhưng nói đúng bản chất:
// "Tạm hoãn thu do bảo lưu đến <ngày hết hạn bảo lưu>" — không tô đỏ, không "quá hạn N ngày", không nút thanh toán gấp.
//
// Thuần (không DB, không "server-only") để cả RSC lẫn component dùng, và test không cần dựng gì.
//
// ⚠️ GIỚI HẠN ĐÃ BIẾT (docs/bao-luu/phien-1.md): sổ cũ `OrderInstallment` không chia theo bé. Nhãn này theo HỌC VIÊN đang xem
// (có hồ sơ mở), nên đơn nhiều con mà chỉ MỘT con bảo lưu vẫn hiện nhãn ở màn của con đó — đúng, vì màn này là per-child.
// Phần "không nhắc nợ" của đơn nhiều con vẫn do `donDangBaoLuu` (chỉ tha khi MỌI con đều nghỉ) quyết định, không ở đây.

export const NHAN_TAM_HOAN_THU = "Tạm hoãn thu do bảo lưu";

const VN_TZ = "Asia/Ho_Chi_Minh";

/** ISO → `dd/MM/yyyy` theo lịch Việt Nam (RSC chạy UTC: không ép múi giờ thì lệch ngày 00:00–07:00 VN). */
export function ngayVN(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", { timeZone: VN_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}

/** "Tạm hoãn thu do bảo lưu đến 07/04/2027" — hoặc không có "đến …" khi hồ sơ chưa có hạn (không bịa ngày). */
export function nhanTamHoanThu(denNgayIso: string | null): string {
  return denNgayIso ? `${NHAN_TAM_HOAN_THU} đến ${ngayVN(denNgayIso)}` : NHAN_TAM_HOAN_THU;
}
