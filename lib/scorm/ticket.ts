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

/**
 * Đọc vé đã KÝ ĐÚNG (timing-safe) và đủ trường — KHÔNG xét hạn. Dùng riêng cho hai nơi: `verifyScormTicket` (thêm kiểm `exp`)
 * và gia hạn chủ động (vé hết hạn GẦN ĐÂY vẫn phải đọc được để đổi lấy vé mới, miễn còn trong trần).
 * ⚠️ Đừng export hàm này cho route phục vụ asset: route phải đi qua `verifyScormTicket` (có kiểm hạn).
 */
function docVeDaKy(token: string): { ok: boolean; payload?: ScormTicketPayload } {
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
  if (typeof payload.exp !== "number") return { ok: false };
  if (!payload.packageId || !payload.userId) return { ok: false };
  if (payload.prefix !== undefined && typeof payload.prefix !== "string") return { ok: false };
  if (payload.iat !== undefined && typeof payload.iat !== "number") return { ok: false };
  return { ok: true, payload };
}

/** Verify vé: đúng chữ ký (timing-safe) + chưa hết hạn + đủ trường. */
export function verifyScormTicket(
  token: string,
  now = Date.now(),
): { ok: boolean; payload?: ScormTicketPayload } {
  const r = docVeDaKy(token);
  if (!r.ok || !r.payload) return { ok: false };
  if (r.payload.exp < now) return { ok: false };
  return r;
}

/**
 * Mốc cấp GỐC của chuỗi gia hạn: `iat` (vé mới) hoặc suy từ `exp − TTL` (vé cũ trước 12/10/2026 chưa có `iat`).
 * Gia hạn luôn GHIM mốc này vào vé mới, nên trần `SCORM_GIA_HAN_TOI_DA_MS` tính từ lúc MỞ BÀI chứ không từ lần gia hạn cuối.
 */
function mocCapGoc(p: ScormTicketPayload): number {
  return p.iat ?? p.exp - SCORM_TICKET_TTL_S * 1000;
}

/** Ký vé gia hạn: giữ nguyên gói/buổi/người dùng/prefix + mốc gốc; hạn mới KẸP trong trần tổng. */
function kyVeGiaHan(p: ScormTicketPayload, goc: number, now: number): { ticket: string; exp: number } {
  const exp = Math.min(now + SCORM_TICKET_TTL_S * 1000, goc + SCORM_GIA_HAN_TOI_DA_MS);
  const moi: ScormTicketPayload = { ...p, iat: goc, exp };
  const body = Buffer.from(JSON.stringify(moi)).toString("base64url");
  return { ticket: `${body}.${sign(body, secret())}`, exp };
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
  const goc = mocCapGoc(payload);
  if (now - goc >= SCORM_GIA_HAN_TOI_DA_MS) return null;
  const moi = kyVeGiaHan(payload, goc, now);
  // Sát trần: hạn mới bị kẹp về đúng mốc trần (không dài hơn vé đang có) ⇒ ký lại chỉ tốn công, không thêm thời gian.
  if (moi.exp <= payload.exp) return null;
  return moi.ticket;
}

export type KetQuaGiaHanChuDong =
  | { ok: true; ticket: string; exp: number; expiresInSec: number }
  | { ok: false; reason: "ve-sai" | "het-han-toi-da" };

/**
 * Xác thực một vé cho GIA HẠN CHỦ ĐỘNG: đúng chữ ký + đủ trường, KHÔNG xét hạn (vé vừa hết hạn vẫn đổi được). `null` ⇒ vé sai.
 * Route gia hạn phải so `payload.userId` với phiên đăng nhập TRƯỚC khi gọi `giaHanVeChuDong`.
 */
export function xacThucVeChoGiaHan(token: string): ScormTicketPayload | null {
  const r = docVeDaKy(token);
  return r.ok && r.payload ? r.payload : null;
}

/**
 * Gia hạn CHỦ ĐỘNG (viewer gọi định kỳ qua POST /api/scorm/gia-han) — luôn cấp vé mới nếu còn trong trần, KHÔNG xét "còn bao lâu".
 *
 * Khác `giaHanScormTicket` (gia hạn trượt khi có request asset tới, chỉ khi còn < 5 phút): người ngồi yên > 10 phút rồi mới
 * lazy-load ảnh/video thì không có request nào để trượt, vé chết, asset ăn 403 mà viewer không hay. Gia hạn chủ động chạy từ phía
 * viewer nên cũng cứu được vé vừa hết hạn (trong trần).
 *
 * An toàn: (1) mốc cấp GỐC được ghim ⇒ tổng tuổi chuỗi không vượt `SCORM_GIA_HAN_TOI_DA_MS`, hạn mới còn bị KẸP về mốc trần (không có
 * "trần + 10 phút"); (2) giữ nguyên packageId/sessionId/userId/prefix — không nâng quyền; (3) caller phải đã khớp userId với phiên.
 * Vé hết hạn mà còn trong trần ĐƯỢC đổi: vé không có giá trị nếu thiếu phiên cùng `userId`, nên cửa sổ hồi sinh này không mở thêm gì
 * (xem docs/scorm-hieu-nang/bao-mat.md).
 */
export function giaHanVeChuDong(payload: ScormTicketPayload, now = Date.now()): KetQuaGiaHanChuDong {
  const goc = mocCapGoc(payload);
  if (now - goc >= SCORM_GIA_HAN_TOI_DA_MS) return { ok: false, reason: "het-han-toi-da" };
  const { ticket, exp } = kyVeGiaHan(payload, goc, now);
  return { ok: true, ticket, exp, expiresInSec: Math.max(0, Math.floor((exp - now) / 1000)) };
}
