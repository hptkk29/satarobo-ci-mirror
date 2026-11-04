import "server-only";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * SEC-M11 — Xác thực phiên còn "SỐNG" so với DB (không chỉ tin JWT). JWT mặc định 30d;
 * revocation (isActive/tokenVersion) trước đây chỉ enforce ở RSC layout, KHÔNG ở API Route
 * Handler → JWT trộm/stale của user đã bị disable / đổi role / thu quyền vẫn gọi được API
 * tới hết hạn tự nhiên. Helper này mang logic layout sang Route Handler nhạy cảm:
 * user bị disable / soft-delete / bump tokenVersion → chặn NGAY. Trả null nếu phiên chết.
 *
 * ⚠️ Thêm 1 DB query/call → chỉ dùng cho route NHẠY CẢM (export PII, tài chính, asset nội
 * bộ), KHÔNG rải lên mọi API. (Rút ngắn maxAge JWT = Q26, tách riêng.)
 */
export type SessionLiveness =
  | { live: true }
  | { live: false; reason: "session-invalidated" | "session-disabled" };

/**
 * AUTH-SĐT P6 — như `requireLiveSession` nhưng TRẢ VỀ LÝ DO, để layout redirect
 * kèm thông báo đúng ("tài khoản bị vô hiệu hoá" khác "phiên đã hết hiệu lực").
 *
 * Sống ở `lib/` vì layout trong `app/(portal)` KHÔNG được import `@/lib/db` trần
 * (ESLint chặn), mà việc đọc chính user của mình cũng không thuộc phạm vi
 * `portalDb` (nó lo cách ly dữ liệu học viên, không phải bảng User).
 */
export async function checkSessionLiveness(userId: string, tokenVersion: number | undefined): Promise<SessionLiveness> {
  const dbUser = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, tokenVersion: true, deletedAt: true },
  });
  if (!dbUser || dbUser.deletedAt) return { live: false, reason: "session-invalidated" };
  if (!dbUser.isActive) return { live: false, reason: "session-disabled" };
  if (dbUser.tokenVersion !== tokenVersion) return { live: false, reason: "session-invalidated" };
  return { live: true };
}

export async function requireLiveSession(): Promise<Session | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const dbUser = await db.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, tokenVersion: true, deletedAt: true },
  });
  if (!dbUser || dbUser.deletedAt || !dbUser.isActive) return null;
  if (dbUser.tokenVersion !== session.user.tokenVersion) return null;
  return session;
}
