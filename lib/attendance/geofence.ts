// lib/attendance/geofence.ts — R5-03: tính khoảng cách + kiểm tra trong vùng (THUẦN, test được).
// ⚠️ CHỈ dùng cho chấm công NHÂN VIÊN — KHÔNG bao giờ cho học sinh (privacy chốt cứng).

/** Khoảng cách Haversine (mét) giữa 2 toạ độ. THUẦN. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * C3.1/C3.2 — trong bán kính cho phép của cơ sở không.
 * Cơ sở chưa khai toạ độ → coi như hợp lệ (không chặn). THUẦN.
 */
export function withinGeofence(
  gps: { lat: number; lng: number },
  center: { lat: number | null | undefined; lng: number | null | undefined; radiusM: number | null | undefined },
): { within: boolean; distanceM: number | null } {
  if (center.lat == null || center.lng == null) return { within: true, distanceM: null };
  const radius = center.radiusM ?? 100;
  const d = distanceMeters(gps.lat, gps.lng, center.lat, center.lng);
  return { within: d <= radius, distanceM: d };
}
