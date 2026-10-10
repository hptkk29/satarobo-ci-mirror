import "server-only";
import { makeCenterToken, verifyCenterToken } from "@/lib/attendance/qr-token";
import { distanceMeters } from "@/lib/attendance/geofence";
import { getSigningSecret } from "@/lib/security/signing-key";

// =============================================================================
// QR ATTENDANCE — Phase NHÓM 4 (Module Chấm công PHẦN 1)
// QR CỐ ĐỊNH mỗi cơ sở: mã gắn centerId, KHÔNG hết hạn (bỏ cửa sổ xoay 30s).
// Logic ký/verify + haversine tách sang lib/attendance/{qr-token,geofence}.ts (test được).
// =============================================================================

/** Bán kính geofence chấm công (mét). */
export const GEOFENCE_RADIUS_METERS = 100;

function secret(): string {
  return getSigningSecret(); // SEC-H05: bỏ fallback "" (HMAC key rỗng → QR forge được).
}

/** Token QR CỐ ĐỊNH cho cơ sở (không hết hạn). */
export function generateQrToken(centerId: string): { token: string } {
  return { token: makeCenterToken(centerId, secret()) };
}

/** Verify token QR cố định: đúng định dạng + đúng centerId + chữ ký hợp lệ. */
export function verifyQrToken(token: string, expectedCenterId: string): boolean {
  return verifyCenterToken(token, expectedCenterId, secret());
}

export { distanceMeters };
