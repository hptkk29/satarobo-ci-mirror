import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isParentOnly } from "@/lib/auth/permissions";
import { hasAcceptedChatPolicy } from "@/lib/chat/policy";
import { issueSseTicket, RealtimeTokenError } from "@/lib/chat/realtime-token";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vé realtime của chat — cổng TRƯỚC khi trình duyệt mở kênh SSE `/api/chat/stream`.
 *
 * Từ 28/09/2026 (gỡ Supabase Realtime) route KHÔNG ký JWT nào nữa: vé SSE không mang bí mật
 * (`issueSseTicket`). Route vẫn giữ vì hai consumer (`use-chat-channel.ts`, `user-channel.ts`)
 * xin vé trước khi subscribe và xin lại định kỳ — đây là chỗ chúng đọc được mã 401/403/429
 * (EventSource thì không) để lùi theo backoff. Route stream tự giữ ĐỦ các cổng này lần nữa,
 * nên vé không phải là thứ duy nhất đứng giữa trình duyệt và nội dung.
 * Mọi role đăng nhập đều cấp được — quyền nghe từng topic kiểm ở mỗi lần giao
 * (`lib/chat/realtime-authz.ts`). `issueSseTicket` tự kiểm tokenVersion (force-logout → 401).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  // Mỗi vé = 1 query DB kiểm tokenVersion ⇒ phải có trần. Đặt SAU auth() để khoá theo
  // userId (không phải IP: nhiều PH sau chung NAT). Vé sống 15' và client gia hạn ở 80% TTL
  // (một tab mở chat có 2 bộ hẹn giờ: kênh `conv:` và kênh `user:`); 30/phút vẫn rộng cho
  // nhiều tab + backoff nối lại.
  // fail-soft (Upstash → memory) như các route khác.
  const rl = await rateLimit({
    key: `chat:realtime-token:${session.user.id}`,
    max: 30,
    windowMs: 60_000,
  });
  if (!rl.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Thao tác quá nhanh — thử lại sau ít giây",
        },
      },
      { status: 429 },
    );
  }

  // US-16 AC2 — phụ huynh CHƯA đồng ý quy định thì KHÔNG cấp vé realtime. Thiếu bước này
  // thì cổng chính sách chỉ chặn được đường HTML: vé realtime cho phép nghe thẳng
  // broadcast của nhóm, tức đọc tin MỚI mà không đi qua trang nào.
  // Chỉ áp cho tài khoản THUẦN phụ huynh: giáo viên/quản lý không bao giờ thấy màn chính
  // sách của phụ huynh nên chặn họ ở đây là tắt chat của nhân viên. Đặt SAU rate limit để
  // client hỏng (retry 30s) cũng nằm trong trần. Lỗi đọc DB → coi như CHƯA đồng ý
  // (fail-closed) vì đây là cổng nội dung.
  if (isParentOnly(session.user)) {
    const accepted = await hasAcceptedChatPolicy(session.user.id).catch(() => false);
    if (!accepted) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "CHAT_POLICY_REQUIRED",
            message: "Vui lòng đồng ý quy định sử dụng tin nhắn trước khi vào chat.",
          },
        },
        { status: 403 },
      );
    }
  }

  try {
    const { token, expiresAt } = await issueSseTicket({
      id: session.user.id,
      tokenVersion: session.user.tokenVersion,
    });
    // `provider: "sse"` giữ lại cho tab mở từ bản bundle TRƯỚC khi gỡ Supabase: bản cũ đọc
    // trường này để chọn tầng realtime, vắng trường là nó rơi về Supabase (đã chết).
    return NextResponse.json(
      { token, expiresAt: expiresAt.toISOString(), provider: "sse" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof RealtimeTokenError) {
      // USER_NOT_FOUND / TOKEN_VERSION_MISMATCH — phiên không còn hiệu lực.
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }
}
