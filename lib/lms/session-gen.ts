// lib/lms/session-gen.ts — R3-02 C2.2: sinh lịch buổi học, né ngày nghỉ (Holiday). THUẦN.

const toKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Sinh `count` ngày buổi học từ `start`, chỉ vào các thứ trong `weekdays` (0=CN..6=T7),
 * BỎ QUA ngày nằm trong `holidays`. THUẦN (không DB).
 */
export function generateSessionDates(input: {
  start: Date;
  count: number;
  weekdays: number[]; // 0..6
  holidays?: Date[];
  maxScan?: number; // chặn vòng vô hạn
}): Date[] {
  const holidaySet = new Set((input.holidays ?? []).map(toKey));
  const weekdaySet = new Set(input.weekdays);
  const out: Date[] = [];
  const cursor = new Date(input.start);
  let scanned = 0;
  const maxScan = input.maxScan ?? input.count * 14 + 60;

  while (out.length < input.count && scanned < maxScan) {
    if (weekdaySet.has(cursor.getUTCDay()) && !holidaySet.has(toKey(cursor))) {
      out.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    scanned++;
  }
  return out;
}
