// lib/hoa-hong/be-cua-khoan.ts — "BÉ" của một khoản thu khi tìm buổi trial cho GV Trial (audit XII · GAP-3). THUẦN.
//
// Một đơn chỉ có MỘT `Order.leadChildId`. Đơn hai bé (A là bé trên đơn, B trả tiền ở dòng của mình) mà lấy `order.leadChildId` TRƯỚC thì khoản của B đi tìm buổi trial của A:
// GV Trial của A hưởng hoa hồng của B (hoặc B có trial mà bị bỏ) — lỗi IM LẶNG, tổng vẫn khớp.
//
// LUẬT — CHỈ đổi đúng ca sai, giữ NGUYÊN hành vi cũ (`order.leadChildId ?? student.leadChildId`) ở mọi ca khác. Hai bản đầu của PR này nghiêm quá tay và làm MẤT GV Trial:
//   · bản 1 (ưu tiên bé của học viên) sai với học viên TÁI SỬ DỤNG từ lead cũ: `Student.leadChildId` là bé CŨ, đơn mới mang bé MỚI — GV Trial phải theo bé MỚI;
//   · bản 2 (đòi bé trên đơn phải là của chính học viên) làm mất GV Trial ở đơn một bé khi `Student.leadChildId` còn trống (23 ca DB đỏ ở CI).
//
//   1. Đơn có bé và bé đó KHÔNG thuộc học viên nào khác (`hocVienTheoLeadChildCuaDon` rỗng, hoặc chính là học viên trả tiền) ⇒ dùng bé trên đơn (hành vi cũ).
//   2. Bé trên đơn đã thuộc MỘT HỌC VIÊN KHÁC (bé của anh/chị) ⇒ KHÔNG dùng; lấy bé của chính học viên trả tiền, không có thì `null` (không GV Trial — treo im lặng
//      được chấp nhận hơn chia nhầm người).
//   3. Đơn không có bé ⇒ bé của học viên trả tiền (hành vi cũ).
export function leadChildChoGvTrial(p: {
  studentLeadChildId: string | null;
  orderLeadChildId: string | null;
  /** `Student.id` khi `Order.leadChildId` khớp ĐÚNG MỘT học viên (`docHocVienTheoLeadChild`); `null` = không học viên nào (hoặc nhiều hơn một) giữ bé này. */
  hocVienTheoLeadChildCuaDon: string | null;
  /** Học viên TRẢ TIỀN của khoản. */
  studentId: string;
}): string | null {
  const beTrenDonLaCuaNguoiKhac = p.orderLeadChildId !== null && p.hocVienTheoLeadChildCuaDon !== null && p.hocVienTheoLeadChildCuaDon !== p.studentId;
  if (p.orderLeadChildId !== null && !beTrenDonLaCuaNguoiKhac) return p.orderLeadChildId;
  return p.studentLeadChildId;
}