import "server-only";
import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import { congHoaDonTuEnv } from "@/lib/misa/meinvoice";
import { congHoaDonVinTuEnv } from "@/lib/vin-hoadon";
import type { NhaCungCapApi } from "./phap-nhan";

// lib/finance/hoa-don/cong-phat-hanh.ts — CHỖ DUY NHẤT module hoá đơn LẤY cổng phát hành MISA meInvoice
// (bước 1 "bán tự động", 30/09/2026).
//
// Mọi đường gọi cổng (action "Phát hành qua MISA" / "Kiểm tra lại" / "Phát hành lại", cron đối soát) hỏi
// hàm này rồi truyền cổng xuống máy trạng thái (`phat-hanh-misa.ts`) — không ai tự dựng cổng. Test tiêm
// cổng giả bằng `vi.mock` hàm này. Lưới `[PHM-W*]` (phat-hanh-misa.wiring.test.ts) ghim điều đó.
//
// `null` = chưa cấu hình cổng ⇒ nút "Phát hành qua MISA" KHÔNG hiện, action từ chối, cron bỏ qua.

/**
 * Cổng phát hành đang dùng cho MỘT nhà cung cấp API, hoặc `null` khi chưa cấu hình.
 *
 * [02/11/2026] Thêm VIN-HOADON. Tham số mặc định `MISA_MEINVOICE` để mọi nơi gọi cũ `layCongHoaDon()` giữ NGUYÊN hành vi;
 * nơi biết pháp nhân (nút trên dòng, action phát hành, cron đối soát) truyền nhà cung cấp của PHÁP NHÂN ĐÓ
 * (`nhaCungCapApiCuaPhapNhan`). Không có nhánh "thử cổng kia nếu cổng này null": pháp nhân VIN mà VIN chưa cấu hình ⇒ `null`,
 * KHÔNG rơi sang MISA (gửi hoá đơn của pháp nhân này bằng chữ ký của pháp nhân khác là sự cố, không phải dự phòng).
 */
export function layCongHoaDon(nhaCungCap: NhaCungCapApi = "MISA_MEINVOICE"): CongHoaDon | null {
  // Đọc env MÓI lần gọi (rẻ; token cache nằm trong http.ts của từng nhà cung cấp).
  // MODE off / thiếu biến ⇒ null ⇒ nút không hiện, action từ chối, cron bỏ qua.
  switch (nhaCungCap) {
    case "MISA_MEINVOICE":
      return congHoaDonTuEnv();
    case "VIN_HOADON":
      return congHoaDonVinTuEnv();
    default:
      // Giá trị lạ ⇒ KHÔNG đoán.
      return null;
  }
}
