// FIX 10 phần 3 — dựng lịch tuần GV + phát hiện trùng giờ.

export const WEEKDAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

export type TeacherClassSlot = {
  id: string;
  label: string;
  scheduleDays: number[]; // 0=CN..6=T7
  startTime: string | null; // "HH:mm"
  endTime: string | null;
  role: "teacher" | "assistant";
};

export type DayEntry = {
  classId: string;
  label: string;
  start: string;
  end: string;
  role: "teacher" | "assistant";
  conflict: boolean;
};

function toMin(hm: string | null): number | null {
  if (!hm || !/^\d{1,2}:\d{2}$/.test(hm)) return null;
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

export type WeeklySchedule = {
  /** index 0..6 (CN..T7) → entries sorted by start. */
  days: DayEntry[][];
  conflicts: { day: number; a: string; b: string }[];
};

/**
 * Dựng lịch 7 ngày + đánh dấu lớp trùng giờ (cùng ngày + khung giờ chồng lấn).
 * Lớp thiếu startTime/endTime → vẫn hiển thị nhưng KHÔNG tính trùng.
 */
export function buildWeeklySchedule(slots: TeacherClassSlot[]): WeeklySchedule {
  const days: DayEntry[][] = Array.from({ length: 7 }, () => []);
  const conflictIdsByDay: Array<Set<string>> = Array.from({ length: 7 }, () => new Set());
  const conflicts: { day: number; a: string; b: string }[] = [];

  // Gom theo ngày.
  const byDay: Array<TeacherClassSlot[]> = Array.from({ length: 7 }, () => []);
  for (const s of slots) {
    for (const d of s.scheduleDays) {
      if (d >= 0 && d <= 6) byDay[d].push(s);
    }
  }

  for (let d = 0; d < 7; d++) {
    const list = byDay[d];
    // So từng cặp tìm trùng.
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const aS = toMin(a.startTime);
        const aE = toMin(a.endTime);
        const bS = toMin(b.startTime);
        const bE = toMin(b.endTime);
        if (aS != null && aE != null && bS != null && bE != null && overlaps(aS, aE, bS, bE)) {
          conflictIdsByDay[d].add(a.id);
          conflictIdsByDay[d].add(b.id);
          conflicts.push({ day: d, a: a.label, b: b.label });
        }
      }
    }
    days[d] = list
      .map((s) => ({
        classId: s.id,
        label: s.label,
        start: s.startTime ?? "—",
        end: s.endTime ?? "—",
        role: s.role,
        conflict: conflictIdsByDay[d].has(s.id),
      }))
      .sort((x, y) => (toMin(x.start) ?? 9999) - (toMin(y.start) ?? 9999));
  }

  return { days, conflicts };
}
