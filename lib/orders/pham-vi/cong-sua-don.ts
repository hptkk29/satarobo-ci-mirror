// lib/orders/pham-vi/cong-sua-don.ts — CÂU TỪ CHỐI của hai đường SỬA đơn theo PHẠM VI HỌC: thêm con vào đơn, đổi khoá/đổi lớp. THUẦN.
//
// ── VÌ SAO TỒN TẠI [19/10/2026, cổng D phần còn lại] ────────────────────────────────────────────────────────────────
// Cổng D (13/10) đã che `recordInstallmentPlan` và `taoDotChoCon` bằng `LY_DO_DON_PHAM_VI_KHONG_KE_HOACH_DOT`. Hai đường còn lại KHÔNG phải
// là "kế hoạch đợt" nên dùng lại câu ấy là NÓI SAI NGUYÊN NHÂN (người bấm "Thêm con" đọc về "kế hoạch thanh toán" và đi tìm nhầm chỗ):
//   · `themConVaoDon`  — thêm một dòng KHÔNG dấu vào đơn đã chốt theo phạm vi ⇒ ĐƠN TRỘN (Q17: tạo-đơn từ chối đơn trộn), đồng thời có
//                         thể xếp lại ưu đãi anh em lên chính dòng SCOPE ⇒ giá dòng ≠ thành tiền trong dấu ⇒ `cap-tu-don` báo `dauKhongKhop`;
//   · `doiKhoaChoCon`  — dừng dòng SCOPE, dựng dòng mới KHÔNG dấu theo `Course.price`, quyết toán theo `Course.totalSessions` (không theo số
//                         buổi ĐÃ MUA) và tạo ĐỢT cho phần còn thiếu qua `taoDotChoConTrongTx` — thứ cổng D cố ý không gác để dành cho đợt này.
// Cả hai đều là phép GHI trên một đơn mà mô hình nói "mỗi lần mua theo phạm vi là một giao dịch riêng". Chặn = giữ nguyên bất biến đã
// chốt, KHÔNG chọn thay chủ dự án cách xử lý nghiệp vụ (đổi khoá của gói lẻ, thứ hạng con xuyên đơn): các câu đó vẫn MỞ.
//
// Đọc DẤU trên dòng đơn (`laDonPhamVi`), KHÔNG đọc cờ cơ sở: đơn đã tạo vẫn là SCOPE khi cờ tắt lại.

/** `themConVaoDon` / `xemTruocThemCon` từ chối trên đơn SCOPE. */
export const LY_DO_DON_PHAM_VI_KHONG_THEM_CON =
  "Đơn theo phạm vi học không thêm con vào đơn đã tạo (giá và số buổi đã chốt theo phạm vi đã mua). Hãy lập đơn mới cho bé này.";

/** `doiKhoaChoCon` / `xemTruocDoiKhoa` từ chối trên đơn SCOPE. */
export const LY_DO_DON_PHAM_VI_KHONG_DOI_KHOA =
  "Đơn theo phạm vi học chưa hỗ trợ đổi khoá / đổi lớp: giá và số buổi đã chốt theo phạm vi đã mua. Cách xử lý đang chờ quyết định — hãy báo quản lý.";

/** `huyDotChoCon` từ chối trên đơn SCOPE: khoản phải thu của từng bé gắn với dòng hàng, huỷ riêng một khoản là bỏ một bé khỏi "đã đủ" của đơn. */
export const LY_DO_DON_PHAM_VI_KHONG_HUY_KHOAN =
  "Đơn theo phạm vi học: khoản phải thu của từng bé gắn với dòng hàng nên không huỷ riêng. Muốn bỏ một bé hãy dừng học dòng của bé đó, hoặc huỷ cả đơn.";
