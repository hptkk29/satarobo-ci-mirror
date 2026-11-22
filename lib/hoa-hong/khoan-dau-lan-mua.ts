// lib/hoa-hong/khoan-dau-lan-mua.ts — «KHOẢN THU ĐẦU CỦA LẦN MUA» (AFF-L2b, FIXED_PER_PURCHASE). THUẦN — không DB, không đồng hồ.
//
// Chủ dự án chốt (Q14): hoa hồng cố định trả MỘT LẦN cho mỗi LẦN MUA, tại khoản thu ĐẦU TIÊN của lần mua đó; các khoản thu sau (trả góp / nhiều đợt) không sinh thêm dòng cố định.
// «Lần mua» = một dòng học phí của đơn (`OrderItem`) — cùng khái niệm với phân loại NEW/RENEWAL (`phan-loai-giao-dich.ts`, một `StudentTransaction` ↔ một `orderItemId`) và với ô tính
// (`CommissionCalcSlot` = khoản × dòng đơn × thành phần).
//
// MỘT định nghĩa, tính trên một TẬP KHÔNG PHỤ THUỘC khoản nào đang hỏi: mọi khoản của lần mua đều thấy cùng một «khoản đầu». Tập đó = các khoản thu DƯƠNG, thực thu, cùng đơn, đứng trước theo `(paidDate, id)`
// (cùng thứ tự với «còn nợ trước khoản» ở `nap-khoan.ts`), KHÔNG kể bút toán điều chỉnh (`adjustmentOfId`): điều chỉnh sửa số của chính lần thu ấy chứ không phải một lần thu mới.
//
// Cách biết «đã có tiền trước vào dòng này» KHÔNG viết lại luật quy khoản về dòng: chạy `tinhConNoTheoDongTruocKhoan` (cùng `phanBoKhoan` tuần tự đã dùng để phân bổ khoản không gắn dòng) hai lần — có các khoản trước
// và không có — rồi so còn nợ của dòng. Khác nhau ⇒ đã có tiền trước vào dòng ⇒ khoản này KHÔNG phải khoản đầu. Khoản trước bị GIỮ (chưa gắn được dòng) không được quy cho dòng nào nên không tính — nói thẳng ở l2b-fixed.md.
import { tinhConNoTheoDongTruocKhoan, type DongNo, type KhoanTruoc } from "./phan-bo-khoan";

export function laKhoanDauCuaLanMua(input: {
  /** `Payment.adjustmentOfId` của khoản đang xét: bút toán điều chỉnh không bao giờ là «khoản đầu». */
  adjustmentOfId: string | null;
  orderItemId: string;
  dong: readonly DongNo[];
  /** Các khoản THU dương đứng trước (đã sắp theo `(paidDate, id)`), KHÔNG gồm bút toán điều chỉnh. */
  khoanTruoc: readonly KhoanTruoc[];
  orderType: string;
  hocVienTheoLeadChild: string | null;
}): boolean {
  if (input.adjustmentOfId !== null) return false;
  if (input.khoanTruoc.length === 0) return true;
  const chung = { dong: input.dong, orderType: input.orderType, hocVienTheoLeadChild: input.hocVienTheoLeadChild };
  const truoc = tinhConNoTheoDongTruocKhoan({ ...chung, khoanTruoc: input.khoanTruoc }).get(input.orderItemId);
  const goc = tinhConNoTheoDongTruocKhoan({ ...chung, khoanTruoc: [] }).get(input.orderItemId);
  return truoc === goc;
}

/**
 * Quyết định CUỐI CÙNG cho một khoản: thêm lớp «sổ cái đã có chủ» để tiền cố định không bao giờ bị trả hai lần khi khoản đến TRỄ (khoản có ngày thu sớm hơn mà đến sau một khoản đã được ghi dòng cố định).
 *   · `chuTrongSo` — id khoản thu đang GIỮ dòng cố định của lần mua này trong sổ (dòng ORIGINAL/LATE_ARRIVAL sớm nhất), hoặc `null` nếu sổ chưa có dòng cố định nào cho lần mua;
 *   · có chủ ⇒ chỉ ĐÚNG khoản chủ là «khoản đầu» (ổn định, không trôi khi có khoản đến muộn);
 *   · chưa có chủ ⇒ theo thứ tự `(paidDate, id)` (`laKhoanDauCuaLanMua`). Khoản đầu bị vượt trần (vào hàng chờ, chưa có dòng) vì vậy KHÔNG dời tiền cố định sang khoản sau — trần không thể né bằng cách chia nhỏ khoản đầu.
 */
export function laKhoanDauSauSoCai(thuanThuTu: boolean, khoanId: string, chuTrongSo: string | null): boolean {
  return chuTrongSo === null ? thuanThuTu : chuTrongSo === khoanId;
}
