import "server-only";
// lib/entitlements/su-kien.ts — HANDLER SỰ KIỆN TIỀN VỀ ⇒ XÉT CẤP QUYỀN HỌC. Đăng ký ở `lib/events/register.ts`.
//
// Năm sự kiện, mỗi cái là handler THỨ HAI cạnh handler đã có (registry cộng dồn nhiều handler cho một type — không sửa
// `sau-da-chia.ts`, `phieu-gop.ts`, `r7-notifications.ts`, `hoc-bu-don-doi.ts`):
//   TIỀN VÀO
//   · `phieu-gop.da-chia`  — tiền QR/thẻ POS đã chia vào các dòng của một phiếu gộp (đường tự đối khớp);
//   · `payment.confirmed`  — kế toán/QLCS vừa xác nhận một khoản (đường tiền mặt/ghi tay, và xác nhận tiền ngân hàng).
//   CHIỀU NGƯỢC — chỉ ĐÁNH DẤU quyền học đã cấp (CAN_THU_HOI / TREO_DUYET_TAY), KHÔNG BAO GIỜ xoá / huỷ nó
//   · `payment.rejected`   — kế toán từ chối một khoản;
//   · `payment.refunded`   — hoàn tiền (`refundPayment`) hoặc chi hoàn tiền (`chi-hoan-tien`);
//   · `order.voided`       — đơn bị huỷ / hoàn.
//
// ⚠️ HANDLER KHÔNG BAO GIỜ NÉM. Dispatcher thử lại CẢ SỰ KIỆN khi MỘT handler ném (`lib/events/dispatcher.ts`), tức một
// lỗi cấp quyền học sẽ chạy lại cả `xuLyPhieuGopDaChia` (báo sale, chốt đơn, biên nhận). Lỗi ở đây chỉ được GHI LOG; việc
// cấp bù là của lần hích kế tiếp (hàm tự tính lại mọi thứ nên chạy lại bao nhiêu lần cũng ra cùng kết quả) và của cron đối
// soát ở PR sau.
//
// Cờ TẮT hoặc đơn không có dấu SCOPE ⇒ `xetCapQuyenHocChoDon` dừng trước mọi phép ghi: handler này không tạo quyền học,
// AuditLog hay DomainEvent nào.
import { on } from "@/lib/events/registry";
import type { NguonCapQuyenHoc } from "./cap-tu-don";
import { hichCapQuyenHocChoDon } from "./hich";

/** Lấy `orderId` từ payload sự kiện. Payload lạ ⇒ `null` (bỏ qua, không ném). */
export function orderIdTuPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>).orderId;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Xét một đơn; mọi lỗi bị nuốt và ghi log (vỏ `hichCapQuyenHocChoDon`). Tách ra để test gọi thẳng. */
export async function xuLySuKienTienVe(payload: unknown, nguon: NguonCapQuyenHoc, now: Date): Promise<void> {
  const orderId = orderIdTuPayload(payload);
  if (!orderId) return;
  await hichCapQuyenHocChoDon(orderId, nguon, now);
}

export function registerCapQuyenHocHandlers(): void {
  on("phieu-gop.da-chia", async (e) => {
    await xuLySuKienTienVe(e.payload, "PHIEU_GOP", new Date());
  });
  on("payment.confirmed", async (e) => {
    await xuLySuKienTienVe(e.payload, "KE_TOAN_XAC_NHAN", new Date());
  });
  // ── CHIỀU NGƯỢC: tiền bị từ chối / hoàn, đơn bị huỷ ⇒ xét lại quyền học đã cấp (ĐÁNH DẤU, không xoá / huỷ) ──────────────────────
  on("payment.rejected", async (e) => {
    await xuLySuKienTienVe(e.payload, "TIEN_BI_TU_CHOI", new Date());
  });
  on("payment.refunded", async (e) => {
    await xuLySuKienTienVe(e.payload, "TIEN_BI_HOAN", new Date());
  });
  on("order.voided", async (e) => {
    await xuLySuKienTienVe(e.payload, "DON_BI_LOAI", new Date());
  });
}
