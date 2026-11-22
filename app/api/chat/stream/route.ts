import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isParentOnly } from "@/lib/auth/permissions";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";
import { isActiveChatParticipant } from "@/lib/chat/queries";
import { createTopicAuthorizer, parseStreamConversationIds } from "@/lib/chat/realtime-authz";
import { getRealtimeHub } from "@/lib/chat/realtime-hub";
import { assertRealtimeUserValid, RealtimeTokenError } from "@/lib/chat/realtime-token";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kênh realtime SSE của chat — tầng realtime DUY NHẤT từ 28/09/2026 (Supabase Realtime đã gỡ).
 *
 * MỘT kết nối mỗi tab (`lib/chat/sse-client.ts`), chở topic `user:{id của phiên}` (luôn có) +
 * các `conv:{id}` client xin qua `?conv=`. Server CHỈ ĐỌC ra — client không bao giờ ghi qua
 * kênh này (mọi ghi đi Server Action).
 *
 * Cổng giữ NGUYÊN các cổng của `/api/chat/realtime-token` (cửa thứ hai vào nội dung chat):
 * đăng nhập → rate limit → chính sách chat PH (US-16 AC2) → tokenVersion. Quyền nghe từng
 * topic KHÔNG quyết lúc nối mà ở MỖI LẦN GIAO (`lib/chat/realtime-authz.ts`) — người bị gỡ
 * khỏi lớp ngừng nhận sau ≤ 15s dù kết nối vẫn mở.
 *
 * ⚠️ Reverse proxy phải KHÔNG buffer route này (Caddy: `flush_interval -1`), nếu không tin
 * dồn lại tới khi đủ bộ đệm. `X-Accel-Buffering: no` chỉ có tác dụng với nginx.
 */

/** Nhịp comment giữ kết nối — dưới trần idle 30–60s phổ biến của proxy/NAT. */
const HEARTBEAT_MS = 25_000;
/** Kiểm lại phiên (force-logout) cho kết nối sống lâu. */
const REVALIDATE_MS = 5 * 60_000;
/** Chờ hub LISTEN tối đa — quá thì 503, client lùi theo backoff của nó. */
const HUB_READY_TIMEOUT_MS = 5_000;
/** Trần kết nối đồng thời/người/tiến trình (mỗi tab 1; dư cho nhiều tab + máy). */
const MAX_STREAMS_PER_USER = 8;
/** Gợi ý khoảng nối lại cho EventSource khi stream đứt. */
const RETRY_MS = 3_000;

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return fail(401, "UNAUTHENTICATED", "Chưa đăng nhập");
  const userId = session.user.id;

  // Trần theo userId (không phải IP: nhiều PH sau chung NAT). EventSource tự nối lại sau mỗi
  // lần đứt ⇒ phải có trần, nhưng rộng như route vé (30/phút).
  const rl = await rateLimit({ key: `chat:stream:${userId}`, max: 30, windowMs: 60_000 });
  if (!rl.success) return fail(429, "RATE_LIMITED", "Thao tác quá nhanh — thử lại sau ít giây");

  // US-16 AC2 — y hệt route vé: PH thuần chưa đồng ý quy định thì không được nghe nhóm.
  // Lỗi đọc DB → coi như CHƯA đồng ý (fail-closed, đây là cổng nội dung).
  if (isParentOnly(session.user)) {
    const accepted = await hasAcceptedChatPolicy(userId).catch(() => false);
    if (!accepted) {
      return fail(
        403,
        "CHAT_POLICY_REQUIRED",
        "Vui lòng đồng ý quy định sử dụng tin nhắn trước khi vào chat.",
      );
    }
  }

  const realtimeUser = { id: userId, tokenVersion: session.user.tokenVersion };
  try {
    await assertRealtimeUserValid(realtimeUser);
  } catch (e) {
    if (e instanceof RealtimeTokenError) return fail(401, e.code, e.message);
    throw e;
  }

  const hub = getRealtimeHub();
  if (hub.subscriberCount(userId) >= MAX_STREAMS_PER_USER) {
    return fail(429, "TOO_MANY_STREAMS", "Mở quá nhiều cửa sổ chat cùng lúc");
  }
  if (!(await hub.ready(HUB_READY_TIMEOUT_MS))) {
    return fail(503, "REALTIME_UNAVAILABLE", "Máy chủ tin nhắn tạm thời chưa sẵn sàng");
  }

  const conversationIds = new Set(
    parseStreamConversationIds(new URL(req.url).searchParams.getAll("conv")),
  );
  const authorize = createTopicAuthorizer({
    userId,
    isParticipant: (conversationId, uid) => isActiveChatParticipant(conversationId, uid),
  });

  const encoder = new TextEncoder();
  let finish: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: () => void = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let revalidate: ReturnType<typeof setInterval> | null = null;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          finish();
        }
      };

      finish = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (revalidate) clearInterval(revalidate);
        unsubscribe();
        req.signal.removeEventListener("abort", finish);
        try {
          controller.close();
        } catch {
          // Đã đóng phía trình duyệt — không còn gì để đóng.
        }
      };

      write(`retry: ${RETRY_MS}\n: ok\n\n`);

      // Đăng ký NGAY trong `start` (chạy đồng bộ lúc dựng stream) ⇒ đã nghe trước khi trình
      // duyệt nhận header và báo SUBSCRIBED ⇒ reconcile của client không có khe hở phía sau.
      unsubscribe = hub.subscribe({
        userId,
        conversationIds,
        authorize,
        send: (envelope) => write(`data: ${JSON.stringify(envelope)}\n\n`),
        close: () => finish(),
      });

      heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      revalidate = setInterval(() => {
        assertRealtimeUserValid(realtimeUser).catch((e: unknown) => {
          // Phiên bị thu hồi ⇒ cắt. Lỗi DB thoáng qua thì KHÔNG cắt (đã có kiểm quyền từng
          // phong bì; cắt vì DB chớp là bắt mọi tab nối lại cùng lúc).
          if (e instanceof RealtimeTokenError) finish();
        });
      }, REVALIDATE_MS);

      if (req.signal.aborted) finish();
      else req.signal.addEventListener("abort", finish);
    },
    cancel() {
      finish();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
