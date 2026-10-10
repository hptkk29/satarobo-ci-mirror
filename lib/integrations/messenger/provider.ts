import "server-only";
// lib/integrations/messenger/provider.ts — adapter GỬI TIN Messenger (Meta Send API).
//
// Khác Zalo OA ở một điểm quyết định: endpoint Send API là công khai và ổn định,
// KHÔNG phụ thuộc văn bản nhà cung cấp nào. Thứ còn thiếu chỉ là **Page Access
// Token** — một biến môi trường. Nên đường live ở đây được hiện thực THẬT, và tự
// nó tắt an toàn khi chưa có token.
//
// ⚠️ CHƯA TỪNG SMOKE THẬT. Không ai trong repo đã gọi `POST /me/messages` bao giờ
// (`grep graph.facebook.com` chỉ ra Insights + CAPI). Trước khi bật
// `inbox.messengerLive` trên prod phải chạy bước N-4 của spec §3.6: một tài khoản,
// một người nhận nội bộ, kiểm tin có tới không.
//
// ── CÒN THIẾU GÌ ĐỂ BẬT (chép từ `lib/crm/messenger-send-gate.ts`) ──────────
//   • `META_PAGE_ACCESS_TOKEN` — và repo mới có MỘT biến chung trong khi
//     `FacebookPageMapping` cho phép NHIỀU Page. Nhiều Page ⇒ phải chuyển sang
//     bảng token theo `pageId` trước khi bật Page thứ hai.
//   • Quyền `pages_messaging` + App review của Meta.
//   • MS-4: cửa sổ 24h + message tag. Ngoài cửa sổ gửi thẳng là bị chặn/khoá Page.
//     Cổng đó CHƯA có ở đây — chờ Q-MS-1 xác minh chính sách hiện hành.
import type { InboxChannel } from "@prisma/client";
import { getSetting } from "@/lib/settings/service";
import { resolveSendMode } from "@/lib/integrations/fail-safe";
import type {
  ChannelProvider,
  ChannelSendInput,
  ChannelSendOutcome,
} from "@/lib/integrations/types";

const GRAPH_VERSION = "v21.0";
const TIMEOUT_MS = 10_000; // chuẩn hiện hành của repo (lib/zalo/provider.ts:59)

export function hasMessengerCredentials(): boolean {
  return Boolean(process.env.META_PAGE_ACCESS_TOKEN);
}

/**
 * Một lượt POST tới Meta Send API. Tách hàm để nhìn thấy rõ: KHÔNG có nhánh nào
 * trả `SENT` mà không cầm được `message_id` do Meta trả về.
 */
async function postSendApi(
  token: string,
  input: ChannelSendInput,
): Promise<ChannelSendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipient: { id: input.externalUserId },
        messaging_type: "RESPONSE",
        message: { text: input.body },
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as {
      message_id?: string;
      error?: { code?: number; message?: string; error_subcode?: number };
    } | null;

    if (res.ok && json?.message_id) {
      return { status: "SENT", providerMessageId: json.message_id };
    }
    // KHÔNG log `json.error.message` nguyên văn ra chỗ người dùng đọc: nó có thể
    // chứa mảnh payload. Mã lỗi có cấu trúc là đủ để tra.
    const code = json?.error?.code ?? res.status;
    return { status: "FAILED", errorCode: `META_ERR_${code}` };
  } catch (err) {
    const laTimeout = err instanceof Error && err.name === "AbortError";
    return { status: "FAILED", errorCode: laTimeout ? "META_TIMEOUT" : "META_FETCH_FAILED" };
  } finally {
    clearTimeout(timer);
  }
}

export const messengerProvider: ChannelProvider = {
  channel: "MESSENGER" as InboxChannel,
  name: "meta-messenger",
  label: "Messenger",
  isConfigured: hasMessengerCredentials,

  async send(input: ChannelSendInput): Promise<ChannelSendOutcome> {
    const mode = await resolveSendMode({
      configured: hasMessengerCredentials(),
      readLive: () => getSetting("inbox.messengerLive"),
    });
    if (!mode.live) return { status: "SIMULATED", reason: mode.reason };

    const token = process.env.META_PAGE_ACCESS_TOKEN;
    // Đã qua `resolveSendMode` nên nhánh này không xảy ra; giữ để TS hẹp kiểu và
    // để nếu ai đó sửa `hasMessengerCredentials` lệch thì hỏng ở đây chứ không
    // hỏng ở chỗ gửi `Bearer undefined`.
    if (!token) return { status: "SIMULATED", reason: "NOT_CONFIGURED" };

    return postSendApi(token, input);
  },
};
