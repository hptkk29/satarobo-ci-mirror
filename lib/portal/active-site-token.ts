// lib/portal/active-site-token.ts — R4-01: ký/verify token activeSite (studentId trong
// cookie ký HMAC, KHÔNG trên URL — C1.3). THUẦN (không server-only) để test được.
import { createHmac, timingSafeEqual } from "crypto";

export function signValue(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** Tạo token `<value>.<sig>` cho cookie. */
export function makeToken(value: string, secret: string): string {
  return `${value}.${signValue(value, secret)}`;
}

/** Verify token → trả value nếu chữ ký hợp lệ, null nếu bị sửa (timing-safe). */
export function verifyToken(token: string, secret: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const value = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(signValue(value, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}
