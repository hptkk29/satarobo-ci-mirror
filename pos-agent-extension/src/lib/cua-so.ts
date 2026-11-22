/**
 * Cửa sổ thời gian của một lượt đồng bộ (roadmap §6 GĐ5 + hợp đồng §8.3). Thuần, nhận `now`.
 *
 *   thường        [lastSyncedAt − 2h, now]
 *   lần đầu       3 ngày gần nhất — TỰ QUYẾT: làm tròn xuống 00:00 VN của ngày (now − 72h),
 *                 tức 72–96 giờ: phủ trọn ngày, server idempotent nên quét rộng không hại.
 *   sau READY     từ min(lastSyncedAt − 2h, 00:00 hôm nay) — giữ tới khi một lượt XONG TRỌN.
 *   có job        từ min(…, scanFrom của job).
 */
import { BIEN_CUOI_CUA_SO_MS, CUA_SO_TOI_DA_MS, LAN_DAU_MS, LUI_CUA_SO_MS, MANH_CUA_SO_MS } from "./hang-so.js";
import { batDauNgayVN } from "./gio-vn.js";

export interface CuaSo {
  tu: number;
  den: number;
}

function kep(c: CuaSo): CuaSo {
  const tu = Math.min(Math.max(c.tu, c.den - CUA_SO_TOI_DA_MS), c.den);
  return { tu, den: c.den };
}

export function cuaSoLanDau(now: number): CuaSo {
  return kep({ tu: batDauNgayVN(now - LAN_DAU_MS), den: now });
}

/** `lastSyncedAt` ở tương lai (đồng hồ máy bị lùi) ⇒ coi như `now`. */
function mocCuoi(lastSyncedAt: number, now: number): number {
  return Math.min(lastSyncedAt, now);
}

export function cuaSoThuong(lastSyncedAt: number | null, now: number): CuaSo {
  if (lastSyncedAt === null || !Number.isFinite(lastSyncedAt)) return cuaSoLanDau(now);
  return kep({ tu: mocCuoi(lastSyncedAt, now) - LUI_CUA_SO_MS, den: now });
}

/** Mốc bắt đầu quét bù sau SESSION_READY. */
export function tuQuetBuSauReady(lastSyncedAt: number | null, now: number): number {
  if (lastSyncedAt === null || !Number.isFinite(lastSyncedAt)) return cuaSoLanDau(now).tu;
  return Math.min(mocCuoi(lastSyncedAt, now) - LUI_CUA_SO_MS, batDauNgayVN(now));
}

/** Cửa sổ thật của một lượt: mốc SỚM NHẤT giữa thường / quét bù đang chờ / scanFrom của job. */
export function chonCuaSo(p: {
  lastSyncedAt: number | null;
  canQuetBuTu: number | null;
  scanFroms: readonly number[];
  now: number;
}): CuaSo {
  const goc = cuaSoThuong(p.lastSyncedAt, p.now);
  let tu = goc.tu;
  const ung = [p.canQuetBuTu, ...p.scanFroms];
  for (const x of ung) {
    if (typeof x === "number" && Number.isFinite(x) && x <= p.now && x < tu) tu = x;
  }
  return kep({ tu, den: p.now });
}

/**
 * RV5 — hai mốc của MỘT lượt, tính từ đồng hồ máy + độ lệch đã đo (`lechGio` = giờ máy chủ − giờ máy, lấy từ
 * X-Server-Time của mọi phản hồi satarobo):
 *   · `denTimKiem` — mốc cuối gửi portal = max(giờ máy, giờ máy chủ) + biên. Máy CHẬM thì vẫn phủ tới giờ
 *     thật (không đóng job trước khi đọc được lần quẹt vừa xong); `lechGio` sai chiều nào cũng chỉ NỚI cửa sổ.
 *   · `lastSyncedAt` — "đã đọc tới" = min(giờ máy, giờ máy chủ), KHÔNG cộng biên: không bao giờ khai một mốc
 *     chưa tới (máy NHANH ⇒ dữ liệu trông tươi hơn thật); sớm hơn thì lượt sau chỉ quét rộng hơn — vô hại.
 */
export function mocDongBo(nowMay: number, lechGioMs: number): { denTimKiem: number; lastSyncedAt: number } {
  const lech = Number.isFinite(lechGioMs) ? lechGioMs : 0;
  const nowMayChu = nowMay + lech;
  return { denTimKiem: Math.max(nowMay, nowMayChu) + BIEN_CUOI_CUA_SO_MS, lastSyncedAt: Math.min(nowMay, nowMayChu) };
}

/** Chia thành các mảnh liền nhau ≤ `manhMs` (mốc nối dùng chung — không hở). */
export function chiaCuaSo(c: CuaSo, manhMs: number = MANH_CUA_SO_MS): CuaSo[] {
  if (c.den <= c.tu) return [{ tu: c.tu, den: c.den }];
  const ra: CuaSo[] = [];
  for (let tu = c.tu; tu < c.den; tu += manhMs) ra.push({ tu, den: Math.min(tu + manhMs, c.den) });
  return ra;
}
