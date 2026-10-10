// lib/scorm/ticket.ts — R7-12: vé mở SCORM (launch ticket) ký HMAC, TTL ngắn.
// Vé buộc theo packageId + classSession + userId + exp → asset resolver xác quyền
// từng request mà KHÔNG cần query lại quyền (chống IDOR + hết hạn nhanh). KHÔNG thêm
// dependency JWT — dùng node:crypto như lib/attendance/qr-token.ts.
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { getSigningSecret } from "@/lib/security/signing-key";

export type ScormTicketPayload = {
  /** Gói SCORM được phép truy cập (asset resolver chỉ ký key trong prefix gói này). */
  packageId: string;
  /** Buổi GV mở (nếu mở theo lớp) — chỉ để truy vết, có thể null khi xem thử. */
  sessionId: string | null;
  /** User được cấp vé — asset resolver so khớp session đăng nhập (chống chia sẻ link). */
  userId: string;
  /** Hết hạn (epoch ms). */
  exp: number;
};

function secret(): string {
  return getSigningSecret(); // SEC-H05: bỏ fallback "" (forge được vé SCORM).
}

/** HMAC base64url trên body (đã đóng gói) — prefix "scorm:" tách không gian khoá. */
function sign(body: string, s: string): string {
  return createHmac("sha256", s).update(`scorm:${body}`).digest("base64url");
}

/** Ký vé mới với TTL (mặc định 600s = 10 phút). Trả "<body>.<sig>". */
export function signScormTicket(
  input: { packageId: string; sessionId: string | null; userId: string },
  ttlSeconds = 600,
): string {
  const payload: ScormTicketPayload = {
    packageId: input.packageId,
    sessionId: input.sessionId,
    userId: input.userId,
    exp: Date.now() + ttlSeconds * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret())}`;
}

/** Verify vé: đúng chữ ký (timing-safe) + chưa hết hạn + đủ trường. */
export function verifyScormTicket(
  token: string,
  now = Date.now(),
): { ok: boolean; payload?: ScormTicketPayload } {
  if (!token || typeof token !== "string") return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false };
  const [body, sig] = parts;
  const expected = sign(body, secret());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false };

  let payload: ScormTicketPayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as ScormTicketPayload;
  } catch {
    return { ok: false };
  }
  if (typeof payload.exp !== "number" || payload.exp < now) return { ok: false };
  if (!payload.packageId || !payload.userId) return { ok: false };
  return { ok: true, payload };
}
