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
  /**
   * Prefix R2 của gói (`scorm/<id>/`) — KÝ CÙNG vé (12/10/2026). Trước đó mỗi lượt xin asset (gói thật có ~400–570 tệp)
   * phải tra DB `ScormPackage` chỉ để biết prefix. Vé cũ (không có trường này) vẫn dùng được: route rơi về tra DB.
   */
  prefix?: string;
  /** Thời điểm cấp vé gốc (epoch ms) — để chặn gia hạn quá một buổi dạy. Vé cũ không có ⇒ suy từ `exp`. */
  iat?: number;
};

/** TTL một vé (giây). */
export const SCORM_TICKET_TTL_S = 600;
/** Còn dưới ngưỡng này thì route gia hạn vé (cookie) khi vẫn có request tới. */
export const SCORM_GIA_HAN_KHI_CON_MS = 5 * 60 * 1000;
/**
 * Tổng tuổi tối đa của một chuỗi gia hạn. Một buổi dạy 90' + dư; quá mốc này phải mở lại bài (page cấp vé mới, kiểm quyền lại).
 * ⚠️ Gia hạn thay đổi một quyết định bảo mật của R7-12 ("vé sống 10 phút") — nên CÓ TRẦN, và chỉ gia hạn khi người
 * ĐANG DÙNG (có request tới) và phiên đăng nhập vẫn khớp `userId` (route kiểm mỗi request).
 */
export const SCORM_GIA_HAN_TOI_DA_MS = 3 * 60 * 60 * 1000;

function secret(): string {
  return getSigningSecret(); // SEC-H05: bỏ fallback "" (forge được vé SCORM).
}

/** HMAC base64url trên body (đã đóng gói) — prefix "scorm:" tách không gian khoá. */
function sign(body: string, s: string): string {
  return createHmac("sha256", s).update(`scorm:${body}`).digest("base64url");
}

/** Ký vé mới với TTL (mặc định 600s = 10 phút). Trả "<body>.<sig>". */
export function signScormTicket(
  input: { packageId: string; sessionId: string | null; userId: string; prefix?: string },
  ttlSeconds = SCORM_TICKET_TTL_S,
  now = Date.now(),
): string {
  const payload: ScormTicketPayload = {
    packageId: input.packageId,
    sessionId: input.sessionId,
    userId: input.userId,
    exp: now + ttlSeconds * 1000,
    iat: now,
    ...(input.prefix ? { prefix: input.prefix } : {}),
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
  if (payload.prefix !== undefined && typeof payload.prefix !== "string") return { ok: false };
  return { ok: true, payload };
}

/**
 * Vé gia hạn cho một vé ĐÃ xác thực — hoặc `null` khi chưa cần / đã quá trần.
 *
 * Vì sao có: cookie vé và vé đều sống 600s, nên asset nạp TRỄ (ảnh/video của slide, vài trăm tệp mỗi gói) sau phút thứ 10
 * ăn 403 giữa buổi dạy — màn trắng, quay hoài. Gia hạn trượt khi còn < 5 phút, tổng không quá `SCORM_GIA_HAN_TOI_DA_MS`
 * kể từ lúc cấp gốc. Giữ nguyên packageId/sessionId/userId/prefix: không nâng quyền.
 */
export function giaHanScormTicket(payload: ScormTicketPayload, now = Date.now()): string | null {
  if (payload.exp - now >= SCORM_GIA_HAN_KHI_CON_MS) return null;
  const goc = payload.iat ?? payload.exp - SCORM_TICKET_TTL_S * 1000;
  if (now - goc >= SCORM_GIA_HAN_TOI_DA_MS) return null;
  const moi: ScormTicketPayload = { ...payload, iat: goc, exp: now + SCORM_TICKET_TTL_S * 1000 };
  const body = Buffer.from(JSON.stringify(moi)).toString("base64url");
  return `${body}.${sign(body, secret())}`;
}
