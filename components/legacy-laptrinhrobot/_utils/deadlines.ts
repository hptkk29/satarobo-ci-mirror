// Rolling deadline đồng bộ với lễ khai trương:
// - Countdown chạy đến hết ngày Thứ 7 (mốc Sun 00:00).
// - 00:00 Chủ nhật → tự rollover sang Thứ 7 tuần kế tiếp.
// Logic chung: lib/opening-date.ts.

import {
  getNextOpeningDate,
  getOpeningCountdownTarget,
} from "@/lib/opening-date";

export interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
  expired: boolean;
}

/**
 * Trả về Date = cuối ngày Thứ 7 đang tới (Sun 00:00). Hết countdown này
 * thì helper tự nhảy sang Thứ 7 tuần sau.
 */
export function getNextDeadline(): Date {
  return getOpeningCountdownTarget(new Date());
}

/**
 * Format ngày khai trương để hiển thị (DD/MM/YYYY của Thứ 7 đang tới —
 * KHÔNG phải mốc Sun 00:00).
 */
export function formatDeadline(deadline: Date): string {
  // Nếu deadline là Sun 00:00 thì lùi 1 ngày để hiển thị "Thứ 7".
  // Khi `deadline` là Date bất kỳ (đề phòng caller truyền vào kiểu khác),
  // fall back về chính deadline.
  const openingSat =
    deadline.getDay() === 0
      ? (() => {
          const d = new Date(deadline);
          d.setDate(d.getDate() - 1);
          return d;
        })()
      : getNextOpeningDate(deadline);
  const dd = String(openingSat.getDate()).padStart(2, "0");
  const mm = String(openingSat.getMonth() + 1).padStart(2, "0");
  const yyyy = openingSat.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function getTimeRemaining(deadline: Date): TimeRemaining {
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0, expired: true };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  return { days, hours, minutes, seconds, total: diff, expired: false };
}
