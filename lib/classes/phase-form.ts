// lib/classes/phase-form.ts — hình dạng KẾ HOẠCH LỊCH HỌC ở tầng FORM.
//
// Vì sao tách khỏi `lib/classes/phases.ts`: file kia làm việc với `Date` (miền nghiệp vụ),
// còn form chỉ có chuỗi `"YYYY-MM-DD"` / `"HH:mm"` từ `<input type="date|time">`. Ba nơi
// cùng cần đúng một hình dạng đó — component planner, `class-form`, và server action —
// nên nó phải nằm ở chỗ CẢ BA import được.
//
// THUẦN: không Prisma, không `server-only` ⇒ dùng được trong client component.

/** Một giai đoạn lịch dưới dạng form gõ tay. */
export interface PhaseFormValue {
  /** "YYYY-MM-DD" */
  from: string;
  /** "YYYY-MM-DD"; "" = để mở (chỉ giai đoạn cuối). */
  to: string;
  note: string;
  /** weekday → giờ; CÓ KHOÁ = học thứ đó. */
  days: Record<number, { start: string; end: string }>;
}

/** Kế hoạch gửi lên server action (ngày "YYYY-MM-DD", giờ "HH:mm"). */
export interface SchedulePhaseInput {
  from: string;
  /** "" = để mở (chỉ giai đoạn cuối). */
  to: string;
  note?: string;
  slots: { weekday: number; startTime: string; endTime: string }[];
}

/** T2…T7 rồi CN — đọc theo tuần học, không theo số 0..6. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const WEEK_LABEL: Record<number, string> = {
  1: "T2",
  2: "T3",
  3: "T4",
  4: "T5",
  5: "T6",
  6: "T7",
  0: "CN",
};

export const emptyPhase = (from = ""): PhaseFormValue => ({
  from,
  to: "",
  note: "",
  days: {},
});

/** +1 ngày cho chuỗi "YYYY-MM-DD" bằng số học UTC (không dính TZ máy). */
export function nextYmd(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1))
    .toISOString()
    .slice(0, 10);
}

/** Form → payload gửi server. Thứ được sắp theo tuần học để log/audit đọc được. */
export function toPhaseInputs(phases: readonly PhaseFormValue[]): SchedulePhaseInput[] {
  return phases.map((p) => ({
    from: p.from,
    to: p.to,
    note: p.note,
    slots: WEEK_ORDER.filter((w) => p.days[w]).map((w) => ({
      weekday: w,
      startTime: p.days[w].start,
      endTime: p.days[w].end,
    })),
  }));
}

/**
 * Giai đoạn ĐẦU TIÊN (theo ngày bắt đầu) dưới dạng lịch phẳng — chỉ để GỢI Ý tên lớp
 * lúc tạo. KHÔNG dùng làm nguồn ghi DB: nguồn ghi là `legacyScheduleFromPhases`, tính
 * theo giai đoạn ĐANG HIỆU LỰC chứ không phải giai đoạn đầu.
 */
export function firstPhaseFlatSchedule(phases: readonly PhaseFormValue[]): {
  scheduleDays: number[];
  startTime: string | null;
  slots: { weekday: number; startTime: string }[];
} {
  const withDays = phases.filter((p) => WEEK_ORDER.some((w) => p.days[w]));
  // Chưa gõ ngày bắt đầu thì coi như đứng đầu — form còn đang nhập dở.
  const first = [...withDays].sort((a, b) => (a.from || "").localeCompare(b.from || ""))[0];
  if (!first) return { scheduleDays: [], startTime: null, slots: [] };

  const days = WEEK_ORDER.filter((w) => first.days[w]);
  return {
    scheduleDays: [...days],
    startTime: days.length > 0 ? first.days[days[0]].start || null : null,
    slots: days
      .filter((w) => first.days[w].start)
      .map((w) => ({ weekday: w, startTime: first.days[w].start })),
  };
}
