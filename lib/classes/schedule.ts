// Module Quản lý lớp PHẦN 2 — tính lịch buổi học (pure, testable).
//
// Cho lịch lớp (scheduleDays 0=CN..6=T7) + danh sách ngày nghỉ cơ sở → ngày
// thực của từng buổi 1..N. Buổi rơi vào ngày nghỉ KHÔNG mất — bị dời sang buổi
// học kế tiếp theo lịch (tổng số buổi giữ nguyên).
//
// ⚠️ Mọi mốc ngày ở đây tính theo LỊCH VIỆT NAM (`@/lib/time/vn`), KHÔNG theo TZ
// của máy chạy. Trước 06/08/2026 file này dùng `getDay()/new Date(y,m,d)` nên
// chạy đúng trên máy dev (+07) nhưng lệch 1 ngày trên Vercel (UTC).

import { vnAddDays, vnStartOfDay, vnWeekday, vnYmd } from "@/lib/time/vn";

/** "YYYY-MM-DD" theo lịch VN. (Trước đây tên là `ymdLocal` — theo TZ máy chạy.) */
export function ymdVN(d: Date): string {
  return vnYmd(d);
}

export interface ComputeSessionDatesInput {
  /** Ngày bắt đầu quét (inclusive). */
  from: Date;
  /** 0=CN..6=T7. */
  scheduleDays: number[];
  /** Số buổi cần sinh. */
  count: number;
  /** Tập ngày nghỉ "YYYY-MM-DD" (cơ sở + toàn hệ thống). */
  holidays: Set<string>;
}

/**
 * Ngày thực của `count` buổi đầu tiên kể từ `from`, theo các thứ trong
 * scheduleDays, BỎ QUA ngày nghỉ (dời sang buổi kế). scheduleDays rỗng → [].
 *
 * Trả về các mốc 00:00 GIỜ VN — caller gắn giờ buổi bằng `applySlotTimeToDate`.
 */
export function computeSessionDates(input: ComputeSessionDatesInput): Date[] {
  const { from, scheduleDays, count, holidays } = input;
  const out: Date[] = [];
  if (scheduleDays.length === 0 || count <= 0) return out;

  const days = new Set(scheduleDays.filter((d) => d >= 0 && d <= 6));
  let cur = vnStartOfDay(from);
  // Giới hạn an toàn: tối đa ~count*8 tuần + đệm.
  const maxIter = count * 7 * 8 + 400;
  let i = 0;
  while (out.length < count && i < maxIter) {
    i++;
    if (days.has(vnWeekday(cur)) && !holidays.has(ymdVN(cur))) {
      out.push(new Date(cur));
    }
    cur = vnAddDays(cur, 1);
  }
  return out;
}

/** Mở rộng các khoảng nghỉ (date..endDate) thành tập ngày "YYYY-MM-DD" (lịch VN). */
export function expandHolidaySet(
  holidays: { date: Date; endDate: Date | null }[],
): Set<string> {
  const set = new Set<string>();
  for (const h of holidays) {
    const start = vnStartOfDay(h.date);
    const end = h.endDate ? vnStartOfDay(h.endDate) : start;
    let cur = start;
    let guard = 0;
    while (cur <= end && guard < 400) {
      guard++;
      set.add(ymdVN(cur));
      cur = vnAddDays(cur, 1);
    }
  }
  return set;
}
