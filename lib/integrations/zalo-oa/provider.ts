import "server-only";
// lib/integrations/zalo-oa/provider.ts — adapter GỬI TIN Zalo OA (hai chiều).
//
// 🔴 KHÁC HẲN `lib/zalo/provider.ts`. File kia là ZNS — tin MẪU ĐÃ DUYỆT, một
// chiều, endpoint `business.openapi.zalo.me/message/template`. Tin tự do trong
// hội thoại OA là API khác, quyền khác, GÓI CƯỚC khác (spec §3.0, C1).
//
// 🔴 CẤM TUYỆT ĐỐI viết bộ quản lý token thứ hai. Zalo OA chat dùng CÙNG
// `access_token` với ZNS. Hai bộ refresh sẽ giết `refresh_token` của nhau ⇒ OA
// chết, phải OAuth lại BẰNG TAY (cảnh báo ghi sẵn `lib/zalo/token.ts:14-20`).
// Đường lấy token duy nhất: `getValidZaloAccessToken()`.
//
// ── CÒN CHỜ GÌ ─────────────────────────────────────────────────────────────
// Cổng CH-3(a) của spec: văn bản Zalo xác nhận (a) gói OA có Open API + hạn mức
// tin ngoài cửa sổ, (b) endpoint + hình dạng payload tin tự do hiện hành, (c)
// tham số cửa sổ tin thật (Q-ZA-1: tài liệu xác minh 29/07 ghi 7 ngày + 8 tin/48h
// reset theo mỗi tương tác của khách, LỆCH với con số "48h" mà các bản mô tả khác
// dùng). Chưa có ba thứ đó thì đường live ở dưới trả `SKIPPED` — KHÔNG đoán
// endpoint, vì code theo endpoint đoán là làm lại từ đầu.
//
// Ngày có: điền `ZALO_OA_ID` + bộ khoá refresh vào env, hiện thực đúng khối
// `guiTinThat()` bên dưới, bật `SystemSetting inbox.zaloOaLive`. Không phải sửa
// chỗ nào khác — tầng gọi (`lib/inbox/send.ts`) và giao diện không biết gì về Zalo.
import type { InboxChannel } from "@prisma/client";
import { getSetting } from "@/lib/settings/service";
import { resolveSendMode } from "@/lib/integrations/fail-safe";
import type {
  ChannelProvider,
  ChannelSendInput,
  ChannelSendOutcome,
} from "@/lib/integrations/types";

/**
 * Đủ khoá kết nối chưa. Dùng ĐÚNG bộ env của `lib/zalo/provider.ts` (cùng một OA,
 * cùng một token) + `ZALO_OA_ID` để biết gửi từ tài khoản nào.
 *
 * ⚠️ Chỉ đọc SỰ TỒN TẠI của biến, không log giá trị (luật cứng #9).
 */
export function hasZaloOaCredentials(): boolean {
  const coToken = Boolean(
    process.env.ZALO_OA_ACCESS_TOKEN ||
      (process.env.ZALO_OA_REFRESH_TOKEN &&
        process.env.ZALO_APP_ID &&
        process.env.ZALO_APP_SECRET),
  );
  return coToken && Boolean(process.env.ZALO_OA_ID);
}

export const zaloOaProvider: ChannelProvider = {
  channel: "ZALO_OA" as InboxChannel,
  name: "zalo-oa",
  label: "Zalo OA",
  isConfigured: hasZaloOaCredentials,

  async send(input: ChannelSendInput): Promise<ChannelSendOutcome> {
    const mode = await resolveSendMode({
      configured: hasZaloOaCredentials(),
      readLive: () => getSetting("inbox.zaloOaLive"),
    });
    if (!mode.live) return { status: "SIMULATED", reason: mode.reason };

    // ── Đường LIVE — chưa hiện thực, CÓ CHỦ ĐÍCH ────────────────────────────
    // Trả `SKIPPED` chứ không `SENT`: người trực phải thấy tin CHƯA đi. Đây đúng
    // là chỗ mà một dòng `return { ok: true }` cho tiện đã từng làm cả đội tin là
    // đã trả lời khách trong nhiều tháng (`lib/crm/messenger-send-gate.ts`).
    //
    // Người hiện thực khối này phải làm đủ, theo spec §3.3:
    //   S2 — cổng cửa sổ tin `canSendNow` kiểm TRƯỚC khi gọi API. Ngoài cửa sổ ⇒
    //        chặn + nói lý do + gợi ý ZNS. KHÔNG âm thầm gửi tin tính tiền.
    //        Tham số cửa sổ là SystemSetting, KHÔNG hardcode (Q-ZA-1 chưa chốt).
    //   S5 — `AbortController` 10s; lỗi auth ⇒ `forceRefreshZaloToken()` + thử lại
    //        ĐÚNG MỘT LẦN (mẫu `lib/zalo/provider.ts:118-122`).
    //   S6 — khung giờ cấm 22:00–06:00 dùng `isVnQuietHour` trong
    //        `lib/chat/zns-notify-rules.ts`. CHỈ ĐƯỢC CÓ MỘT BẢN hàm giờ.
    void input; // tham số đã có sẵn cho khối live, chưa dùng tới
    return { status: "SKIPPED", errorCode: "ZALO_OA_LIVE_CHUA_HIEN_THUC" };
  },
};
