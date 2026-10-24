// FIX 10 phần 4 — tải giảng dạy theo tuần.

// Ngưỡng cảnh báo quá tải (chỉnh tại đây). Mặc định: > 24 giờ dạy/tuần.
export const OVERLOAD_HOURS_PER_WEEK = 24;

export type LoadClass = {
  scheduleDays: number[];
  startTime: string | null;
  endTime: string | null;
};

export type TeachingLoad = {
  classCount: number;
  sessionsPerWeek: number;
  hoursPerWeek: number; // làm tròn 1 chữ số
  overloaded: boolean;
};

function durationHours(start: string | null, end: string | null): number {
  if (!start || !end || !/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) {
    return 0;
  }
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = eh * 60 + em - (sh * 60 + sm);
  return mins > 0 ? mins / 60 : 0;
}

/** Tải/tuần: số lớp + số buổi (tổng scheduleDays) + tổng giờ (buổi × thời lượng).
 * `overloadHours`: ngưỡng quá tải — caller async truyền từ SystemSetting "teacher.overloadHoursPerWeek". */
export function computeTeachingLoad(
  classes: LoadClass[],
  overloadHours: number = OVERLOAD_HOURS_PER_WEEK,
): TeachingLoad {
  let sessionsPerWeek = 0;
  let hoursPerWeek = 0;
  for (const c of classes) {
    const sessions = c.scheduleDays.filter((d) => d >= 0 && d <= 6).length;
    sessionsPerWeek += sessions;
    hoursPerWeek += sessions * durationHours(c.startTime, c.endTime);
  }
  hoursPerWeek = Math.round(hoursPerWeek * 10) / 10;
  return {
    classCount: classes.length,
    sessionsPerWeek,
    hoursPerWeek,
    overloaded: hoursPerWeek > overloadHours,
  };
}
