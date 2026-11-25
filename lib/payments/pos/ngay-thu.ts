// lib/payments/pos/ngay-thu.ts — NGÀY THU của một khoản tiền về theo nguồn giao dịch. THUẦN.
//
// Chủ dự án chốt Q-C (29/09/2026): khoản quẹt thẻ SmartPOS lấy **giờ quẹt thẻ** làm ngày thu.
// File POS do kế toán import TRỄ (cuối ngày / hôm sau), nên lấy giờ import là ghi sai ngày thu —
// sai cả sổ ngày lẫn báo cáo theo kỳ.
//
// ⚠️ [ĐẢO 24/10/2026 — đối soát T9–T10] Câu cũ ở đây là "Chuyển khoản thì GIỮ hành vi cũ (lúc ghi nhận)".
// Hành vi cũ đó là một LỖI, không phải một quyết định: gắn tay một giao dịch chuyển khoản lúc 16:29 ngày 07/10
// cho tiền đã về ngân hàng lúc 19:03 ngày 30/08 ⇒ khoản của THÁNG 8 nằm trong doanh thu THÁNG 10 (5.000.000đ,
// một học viên); 5 khoản khác lệch ngày; và kỳ hoa hồng tính theo `kyCuaButToan(paidDate)` nên lệch ngày
// là lệch kỳ. Chủ dự án chốt 24/10/2026: *"gắn tay chuyển khoản phải lấy thời điểm ngân hàng thực nhận, không
// dùng thời gian thao tác"*. Nay MỌI nguồn lấy giờ ngân hàng; thẻ POS giữ nguyên (giờ quẹt, không qua kiểm tương lai).
//
// `now` BẮT BUỘC, không mặc định (luật 7): để `tsc` liệt kê mọi chỗ gọi và test không đọc
// đồng hồ thật (luật 19). Xem `docs/pos-the-smartpos.md`, `docs/doi-soat-thu-tien/THIET-KE-SUA-GOC.md`.
import { PROVIDER_THE_POS } from "./kieu";
import { gioNganHangThuc } from "../gio-ngan-hang";

export function ngayThuCuaGiaoDich(
  txn: { provider: string; transferredAt: Date; createdAt?: Date | null },
  now: Date,
): Date {
  // Thẻ POS: giờ quẹt thẻ do máy POS khai, import muộn là chuyện thường ⇒ nguyên văn.
  if (txn.provider === PROVIDER_THE_POS) return txn.transferredAt;
  // Chuyển khoản: giờ ngân hàng thực nhận — `gioNganHangThuc` loại giờ ở tương lai và vá dòng đời cũ lệch +7h.
  return gioNganHangThuc(txn, now);
}
