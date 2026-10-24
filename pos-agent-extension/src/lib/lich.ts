/**
 * Nhịp hỏi job (hợp đồng §5). Thuần.
 *
 *   · Nhận `nextPollMs ≤ 2000` ⇒ chế độ NHANH tới (lúc nhận + 120 giây) — gia hạn mỗi lần nhận lại.
 *   · Trong chế độ nhanh: hẹn `GET /jobs` sau max(2000, nextPollMs gần nhất); lần trả lời gần
 *     nhất là 60000 ⇒ thôi hẹn (alarm 1 phút lo) — "không gọi nhanh hơn nextPollMs".
 *   · Mất trả lời (lỗi mạng) ⇒ giữ 2 giây tới hết cửa sổ, rồi về alarm.
 */
import { NHIP } from "./hang-so.js";

export function capNhatNhanh(nhanhDen: number | null, nextPollMs: unknown, now: number): number | null {
  if (typeof nextPollMs === "number" && Number.isFinite(nextPollMs) && nextPollMs <= NHIP.nhanhMs) {
    return now + NHIP.keoDaiNhanhMs;
  }
  return nhanhDen;
}

/** Số ms tới lượt hỏi nhanh kế tiếp; `null` = không hẹn (để alarm 1 phút lo). */
export function henHoiNhanh(nhanhDen: number | null, nextPollMsGanNhat: number | null, now: number): number | null {
  if (nhanhDen === null || now >= nhanhDen) return null;
  const cho = Math.max(NHIP.nhanhMs, nextPollMsGanNhat ?? NHIP.nhanhMs);
  return cho >= NHIP.phutMs ? null : cho;
}
