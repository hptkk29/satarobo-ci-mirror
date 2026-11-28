// lib/attendance/qr-token.ts — R5-02: ký/verify QR cố định theo cơ sở (THUẦN, test được).
// Token = "<centerId>.<sig>", sig = HMAC(attendance:<centerId>). Đúng cơ sở + chữ ký mới hợp lệ.
import { createHmac, timingSafeEqual } from "crypto";

export function signCenter(centerId: string, secret: string): string {
  return createHmac("sha256", secret).update(`attendance:${centerId}`).digest("base64url").slice(0, 24);
}

export function makeCenterToken(centerId: string, secret: string): string {
  return `${centerId}.${signCenter(centerId, secret)}`;
}

/** Verify: đúng định dạng + đúng centerId + chữ ký hợp lệ (timing-safe). */
export function verifyCenterToken(token: string, expectedCenterId: string, secret: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [centerId, sig] = parts;
  if (centerId !== expectedCenterId) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(signCenter(centerId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
