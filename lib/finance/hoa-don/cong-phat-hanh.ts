import "server-only";
import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import { congHoaDonTuEnv } from "@/lib/misa/meinvoice";

// lib/finance/hoa-don/cong-phat-hanh.ts — CHỖ DUY NHẤT module hoá đơn LẤY cổng phát hành MISA meInvoice
// (bước 1 "bán tự động", 30/09/2026).
//
// Mọi đường gọi cổng (action "Phát hành qua MISA" / "Kiểm tra lại" / "Phát hành lại", cron đối soát) hỏi
// hàm này rồi truyền cổng xuống máy trạng thái (`phat-hanh-misa.ts`) — không ai tự dựng cổng. Test tiêm
// cổng giả bằng `vi.mock` hàm này. Lưới `[PHM-W*]` (phat-hanh-misa.wiring.test.ts) ghim điều đó.
//
// `null` = chưa cấu hình cổng ⇒ nút "Phát hành qua MISA" KHÔNG hiện, action từ chối, cron bỏ qua.

/** Cổng MISA đang dùng, hoặc `null` khi chưa cấu hình. */
export function layCongHoaDon(): CongHoaDon | null {
  // Đọc env MISA_EINVOICE_* mỗi lần gọi (rẻ; token cache nằm trong lib/misa/meinvoice/http.ts).
  // MODE off / thiếu biến ⇒ null ⇒ nút không hiện, action từ chối, cron bỏ qua.
  return congHoaDonTuEnv();
}
