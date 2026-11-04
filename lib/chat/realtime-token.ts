import "server-only";
import { db } from "@/lib/db";

/**
 * Vé realtime của chat + kiểm phiên dùng chung cho tầng SSE.
 *
 * Lịch sử: file này từng ký JWT HS256 (`SUPABASE_JWT_SECRET`) cho Supabase Realtime. Đường
 * Supabase đã GỠ 28/09/2026 sau khi prod dời sang VPS — nay chỉ còn SSE
 * (`app/api/chat/stream/route.ts`), xác thực bằng cookie phiên Auth.js ngay tại route stream
 * và kiểm quyền ở MỖI LẦN GIAO (`lib/chat/realtime-authz.ts`).
 *
 * "Vé" (`issueSseTicket`) KHÔNG ký gì và KHÔNG mang bí mật. Giữ lại vì hai consumer phía
 * trình duyệt (`components/chat/use-chat-channel.ts`, `components/chat/user-channel.ts`)
 * xin vé TRƯỚC khi mở kênh và xin lại định kỳ: route vé là nơi chúng nhận 401/403/429 dưới
 * dạng mã HTTP đọc được (EventSource thì không đọc được mã lỗi), rồi lùi theo backoff. Bỏ vé
 * là đổi hành vi nối lại của cả hai consumer — không đáng so với lợi ích.
 */

export class RealtimeTokenError extends Error {
  constructor(
    /** Mã lỗi EN, message VI (quy ước API contract). */
    public readonly code: "USER_NOT_FOUND" | "TOKEN_VERSION_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "RealtimeTokenError";
  }
}

export type RealtimeTokenUser = {
  /** `User.id` (cuid) từ session Auth.js. */
  id: string;
  /** `tokenVersion` trong session — so với DB để phát hiện force-logout. */
  tokenVersion: number;
};

export type RealtimeToken = {
  token: string;
  expiresAt: Date;
};

/**
 * Phiên còn được nghe realtime không: tài khoản còn hoạt động + `tokenVersion` khớp DB
 * (lệch = đã bị force-logout). Dùng chung cho vé SSE và lần kiểm lại định kỳ của kết nối
 * SSE đang mở (`app/api/chat/stream/route.ts`).
 */
export async function assertRealtimeUserValid(user: RealtimeTokenUser): Promise<void> {
  const fresh = await db.user.findUnique({
    where: { id: user.id },
    select: { tokenVersion: true, isActive: true, deletedAt: true },
  });
  if (!fresh || fresh.deletedAt || !fresh.isActive) {
    throw new RealtimeTokenError("USER_NOT_FOUND", "Tài khoản không còn hiệu lực");
  }
  if (fresh.tokenVersion !== user.tokenVersion) {
    throw new RealtimeTokenError(
      "TOKEN_VERSION_MISMATCH",
      "Phiên đăng nhập đã bị thu hồi — vui lòng đăng nhập lại",
    );
  }
}

/**
 * TTL vé SSE. Nó KHÔNG phải cận trên của lỗ rò nào (quyền kiểm ở mỗi lần giao, cache ≤ 15s —
 * xem `realtime-authz.ts`), chỉ quyết nhịp consumer hỏi lại route vé (cổng chính sách PH,
 * tokenVersion). Kết nối SSE đang mở còn tự kiểm lại phiên mỗi 5' ở route stream.
 */
export const SSE_TICKET_TTL_SECONDS = 15 * 60;

/** Giá trị `token` cố định của vé SSE — không mang bí mật nào, không dùng để xác thực. */
export const SSE_TICKET_TOKEN = "sse";

export async function issueSseTicket(user: RealtimeTokenUser): Promise<RealtimeToken> {
  await assertRealtimeUserValid(user);
  return {
    token: SSE_TICKET_TOKEN,
    expiresAt: new Date(Date.now() + SSE_TICKET_TTL_SECONDS * 1000),
  };
}
