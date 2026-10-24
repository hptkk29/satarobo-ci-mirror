import { withCron } from "@/lib/cron/handler";
import { isZalocrmEnabled } from "@/lib/flags";
import { doiSoatZalocrm } from "@/lib/integrations/zalocrm/doi-soat";
import { capQuyenNickZalocrm } from "@/lib/integrations/zalocrm/cap-quyen-nick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GĐ3 (tích hợp ZaloCRM) — LƯỚI AN TOÀN cho đường webhook, chạy 5 phút một lần.
//
// Vì sao có: hàng đợi của fork thử lại 1s / 30s / 5 phút rồi BỎ CUỘC. Sata nằm ngoài
// tầm ~5 phút rưỡi đó — một lượt triển khai lâu, một sự cố Vercel kéo dài — là tin rơi
// vĩnh viễn và rơi IM LẶNG: khách đã nhắn, hộp thư trống, đồng hồ chăm sóc của phiếu
// vẫn chạy như chưa ai nhắn. Bộ này quét lại 30 phút gần nhất và nạp bù.
//
// Nạp bù đi qua ĐÚNG đường của webhook (`dichPayloadZalocrm` + `napSuKienZalocrm`),
// không có đường ghi thứ hai — xem chú thích đầu `lib/integrations/zalocrm/doi-soat.ts`.
// Chống trùng có sẵn: `channelMessageId` là UNIQUE, nên chạy lại bao nhiêu lượt cũng
// ra cùng một trạng thái.
//
// KHÔNG tốn gì khi chưa tới GĐ3: cơ sở nào chưa khai khoá API thì bỏ qua lặng lẽ,
// không gọi mạng, không ghi nhật ký.
//
// withCron = verifyCronAuth (CRON_SECRET, sai/thiếu → 401 trước mọi việc) + try/catch
// JSON có cấu trúc (API-18).
//
// Kill switch: xoá entry cron trong vercel.json — webhook vẫn chạy, chỉ mất lưới bù.
// HAI VIỆC TRONG MỘT KHE, có chủ đích: ngân sách cron của Vercel là tài nguyên chung
// của cả repo, và hai việc này cùng nhịp (5 phút), cùng phụ thuộc (khoá API theo cơ sở),
// cùng đặc tính (idempotent, im lặng khi không có gì để làm).
//
// Chạy TUẦN TỰ chứ không `Promise.all`: cả hai đều gọi sang cùng một máy chủ fork, và
// một lượt cron không phải chỗ để nhân đôi tải lên một máy đang giữ các phiên Zalo.
// Quyền chạy TRƯỚC: nạp bù tin cho một nick mà người ta chưa có quyền đọc thì tin về
// nằm đó không ai thấy.
export const GET = withCron("zalocrm-doi-soat", async () => {
  // ── CỜ TẮT ⇒ NO-OP TUYỆT ĐỐI ────────────────────────────────────────────────
  //
  // 🔴 THÊM 20/09/2026, TRƯỚC KHI ĐƯA LÊN PROD. Trên prod bộ này chạy theo lịch
  // **5 phút một lượt ngay khi merge vào `main`** — trong khi `ZALOCRM_ENABLED` còn TẮT
  // và sẽ còn tắt tới khi chủ dự án bật.
  //
  // Trước bản vá, route gọi thẳng hai hàm việc. Nó "im lặng" chỉ vì VẮNG CẤU HÌNH:
  // `getSetting("zalocrm.orgCodes")` rỗng ⇒ vòng lặp không chạy. Hai điều sai với chỗ
  // dựa đó:
  //   · nó vẫn đọc DB **2 lượt mỗi lần × 288 lần/ngày** để rồi không làm gì;
  //   · và nó dựa vào một thứ KHÔNG PHẢI công tắc. Ai đó khai `zalocrm.orgCodes` trên
  //     prod (màn Cấu hình vận hành, không cần deploy) là cron **gọi thẳng sang fork**
  //     dù cờ vẫn tắt — tức công tắc tính năng không điều khiển được đường chạy nền.
  //
  // Cổng đúng phải là CHÍNH CÁI CỜ, cùng một cờ mà trang · nút · webhook đang dùng.
  // Khoá bằng `[ZC-CRON-01/02]` (`lib/integrations/zalocrm/day-noi.test.ts`) — lưới
  // HÀNH VI: gọi thật handler và khẳng định hai hàm việc KHÔNG được chạm tới.
  if (!isZalocrmEnabled()) {
    return { ok: true, data: { boQua: "ZALOCRM_ENABLED tắt — không gọi mạng, không đọc DB" } };
  }

  const quyen = await capQuyenNickZalocrm();
  const tin = await doiSoatZalocrm();
  return { ok: true, data: { quyenNick: quyen.tong, doiSoatTin: tin.tong, chiTiet: { quyen: quyen.theoOrg, tin: tin.theoOrg } } };
});
