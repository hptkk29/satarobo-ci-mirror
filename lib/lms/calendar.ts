// lib/lms/calendar.ts — Lịch tháng (THUẦN, test được). Tuần bắt đầu THỨ HAI (VN).

export type CalDay = { date: Date; iso: string; inMonth: boolean };

/** "YYYY-MM-DD" theo lịch địa phương (không UTC shift). */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Lùi về thứ Hai của tuần chứa `d` (0=CN → coi như cuối tuần). */
function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay(); // 0=CN..6=T7
  const diff = dow === 0 ? -6 : 1 - dow; // về T2
  x.setDate(x.getDate() + diff);
  return x;
}

/**
 * Lưới tháng: mảng tuần × 7 ngày (T2..CN), gồm ngày tràn từ tháng kề (inMonth=false).
 * year + monthIndex0 (0=Jan).
 */
export function monthGrid(year: number, monthIndex0: number): CalDay[][] {
  const first = new Date(year, monthIndex0, 1);
  const gridStart = startOfWeekMonday(first);
  const weeks: CalDay[][] = [];
  const cur = new Date(gridStart);
  // 6 tuần phủ mọi bố cục tháng.
  for (let w = 0; w < 6; w++) {
    const week: CalDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        date: new Date(cur),
        iso: dayKey(cur),
        inMonth: cur.getMonth() === monthIndex0,
      });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
    // Dừng sớm nếu tuần kế hoàn toàn sang tháng sau (tránh tuần thứ 6 thừa).
    if (cur.getMonth() !== monthIndex0 && cur > new Date(year, monthIndex0 + 1, 1)) break;
  }
  return weeks;
}

/** Tháng trước/sau (trả {year, month0}) — cho điều hướng. */
export function shiftMonth(year: number, month0: number, delta: number): { year: number; month0: number } {
  const d = new Date(year, month0 + delta, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

/** Khoảng [đầu, cuối) bao trọn lưới tháng (để query buổi). */
export function monthGridRange(year: number, month0: number): { from: Date; to: Date } {
  const weeks = monthGrid(year, month0);
  const from = weeks[0][0].date;
  const last = weeks[weeks.length - 1][6].date;
  const to = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return { from, to };
}

export const WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
