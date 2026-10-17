// lib/payments/pos/ngay-thu.ts — NGÀY THU của một khoản tiền về theo nguồn giao dịch. THUẦN.
//
// Chủ dự án chốt Q-C (29/09/2026): khoản quẹt thẻ SmartPOS lấy **giờ quẹt thẻ** làm ngày thu.
// File POS do kế toán import TRỄ (cuối ngày / hôm sau), nên lấy giờ import là ghi sai ngày thu —
// sai cả sổ ngày lẫn báo cáo theo kỳ. Chuyển khoản thì GIỮ hành vi cũ (lúc ghi nhận).
//
// `now` BẮT BUỘC, không mặc định (luật 7): để `tsc` liệt kê mọi chỗ gọi và test không đọc
// đồng hồ thật (luật 19). Xem `docs/pos-the-smartpos.md`.
import { PROVIDER_THE_POS } from "./kieu";

export function ngayThuCuaGiaoDich(
  txn: { provider: string; transferredAt: Date },
  now: Date,
): Date {
  return txn.provider === PROVIDER_THE_POS ? txn.transferredAt : now;
}
