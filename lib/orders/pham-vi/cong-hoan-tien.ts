// lib/orders/pham-vi/cong-hoan-tien.ts — CÂU TỪ CHỐI của hai đường TIỀN RA trên đơn theo PHẠM VI HỌC (đơn SCOPE): DỪNG HỌC và ĐỀ XUẤT HOÀN TIỀN. THUẦN.
//
// ── VÌ SAO TỒN TẠI [20/10/2026] ──────────────────────────────────────────────────────────────────────────────────────
// Hai đường này tính đơn giá một buổi bằng `học phí thực ÷ số buổi CẢ KHOÁ`:
//   · dừng học   — `dung-hoc.ts` chia `totalPrice − discountAmount` cho `Course.totalSessions`;
//   · đề xuất hoàn — `computeRefund` chia `Enrollment.finalPrice` cho số `ClassSession` của lớp.
// Đơn SCOPE chỉ mua 12/24/36/48 buổi nên mẫu số phải là SỐ BUỔI ĐÃ MUA (QĐ-47: "số buổi CHƯA HỌC × đơn giá thực thu SAU GIẢM của LẦN MUA").
// Ví dụ SUY từ công thức (chưa chạy dữ liệu): Sata 4, 24 buổi, niêm yết 5.760.000đ, giảm 5% còn 5.472.000đ ⇒ đúng 228.000đ/buổi; mã chia cho 48 ra
// 114.000đ/buổi. Học 6 buổi ⇒ giá trị đã dùng bị tính thiếu 684.000đ ⇒ HOÀN THỪA cùng số đó.
//
// ── ĐÂY LÀ TRẠNG THÁI CHỜ AN TOÀN, KHÔNG PHẢI BẢN VÁ CÔNG THỨC ───────────────────────────────────────────────────────────
// Công thức đúng còn phụ thuộc câu CHƯA CHỐT (MT-14: bảng bậc 100/70/50/0% đang công bố có thắng QĐ-47/48 không; MT-06 bảo lưu; MT-08 học bù miễn phí có
// trừ hạn mức không). Chặn = giữ nguyên bất biến, KHÔNG chọn thay chủ dự án. Hàm thuần `tinhHoanTien` (`lib/entitlements/hoan-tien.ts`) CỐ Ý chưa nối.
//
// Đọc DẤU trên dòng đơn (`laDonPhamVi`), KHÔNG đọc cờ cơ sở: đơn đã tạo vẫn là SCOPE khi cờ tắt lại — và đúng lúc cờ tắt, khách của đơn đó vẫn cần được hoàn.
import { laDonPhamVi } from "./doc-dong";

/** Tail dùng chung của hai câu — một chỗ, kẻo hai câu nói hai lý do khác nhau. */
const DUOI_CHO_KE_TOAN =
  "đơn giá mỗi buổi phải tính theo SỐ BUỔI ĐÃ MUA chứ không theo cả khoá, và cách tính đang chờ quyết định. Cần kế toán xử lý tay.";

/** `dungHocMotCon` / `xemTruocDungHoc` từ chối trên đơn SCOPE. */
export const LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC = `Đơn mua theo số buổi: dừng học chưa hỗ trợ — ${DUOI_CHO_KE_TOAN}`;

/** Mọi đường SINH ĐỀ XUẤT HOÀN (`createRefundRequest`, màn "Chờ đề xuất hoàn tiền") từ chối trên đơn SCOPE. */
export const LY_DO_DON_PHAM_VI_KHONG_HOAN_TIEN = `Đơn mua theo số buổi: hoàn tiền chưa hỗ trợ — ${DUOI_CHO_KE_TOAN}`;

/**
 * Lý do chặn dừng học cho MỘT đơn, hoặc `null` khi đơn thường. MỘT hàm cho máy chủ (lượt ghi + xem trước) và giao diện (mục menu) — luật 12: nút nói thật bằng
 * CHÍNH hàm mà cổng dùng. `items` BẮT BUỘC mang `metadata` (thiếu cột này thì `laDonPhamVi` đọc `undefined` ⇒ LUÔN false ⇒ cổng chết mà không lỗi nào báo).
 */
export function lyDoChanDungHoc(items: readonly { readonly metadata: unknown }[] | null | undefined): string | null {
  return laDonPhamVi(items ?? []) ? LY_DO_DON_PHAM_VI_KHONG_DUNG_HOC : null;
}
