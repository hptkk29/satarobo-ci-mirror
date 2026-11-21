// lib/finance/hoa-don/loai-khoan.ts — loại khoản của chính sách hoá đơn: loại đơn nào được GỘP với loại nào. THUẦN.
//
// «Gói khoá học» (`OrderType.PACKAGE`) và «Học phí khoá học» (`COURSE`) là MỘT [chủ dự án chốt 08/11/2026: «bỏ phần gói khoá học để kế toán khỏi lẫn»].
// Mã vẫn là loại đơn thật (`OrderType`) nên khai ở ĐÂY — màn cấu hình (ô chọn loại khoản) và bộ chọn quy tắc của engine cùng đọc một danh sách,
// để nhãn «Học phí khoá học» và hành vi áp quy tắc không lệch nhau. Tệp nằm NGOÀI `engine/` vì lưới `[ENG-LUOI]` cấm mã ngoài engine nhập engine (bản chiếu bóng).

export const LOAI_KHOAN_GOP_VAO_COURSE = ["PACKAGE"] as const;

export function chuanLoaiKhoan(ma: string): string {
  return (LOAI_KHOAN_GOP_VAO_COURSE as readonly string[]).includes(ma) ? "COURSE" : ma;
}
