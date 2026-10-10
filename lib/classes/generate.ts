import "server-only";
import { db } from "@/lib/db";
import { computeSessionDates, expandHolidaySet } from "@/lib/classes/schedule";
import { resolveClassSlots, applySlotTimeToDate } from "@/lib/classes/slots";
import {
  computePhasedSessionDates,
  slotForDate,
  type SchedulePhase,
} from "@/lib/classes/phases";
import { detectBatchConflicts } from "@/lib/lms/schedule-conflict";
import { formatDateVN } from "@/lib/format/date";
import { vnWeekday } from "@/lib/time/vn";

// =============================================================================
// W2-4 (LMS-6) — soát trùng GV/phòng ở write-path sinh buổi.
// T4.2 — nay đi qua `lib/lms/schedule-conflict.ts` (xét substitute/actual của buổi
// LỚP KHÁC). Bản `findScheduleConflicts` cũ chỉ so GV/phòng CẤP LỚP nên bỏ sót lớp
// có dạy-thay / đổi phòng ⇒ đã gỡ bỏ, mọi call-site chuyển sang module mới.
// Default an toàn: thiếu dữ liệu (không GV & không phòng, hoặc lớp không có
// startTime) ⇒ KHÔNG kết luận trùng (tránh chặn nhầm lớp hợp lệ).
// =============================================================================

// =============================================================================
// P2 — TỰ SINH buổi học cho 1 lớp theo lịch (scheduleDays) + số buổi chuẩn của
// khoá (Course.totalSessions, fallback đếm Lesson giáo trình), BỎ QUA ngày nghỉ.
// Gắn lessonId theo thứ tự giáo trình nếu có. Mặc định chỉ sinh khi lớp CHƯA có buổi.
// =============================================================================

export async function generateClassSessions(
  classId: string,
  opts: { onlyIfEmpty?: boolean } = {},
): Promise<{ ok: boolean; generated: number; error?: string; warning?: string }> {
  const onlyIfEmpty = opts.onlyIfEmpty ?? true;

  const cls = await db.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: {
      id: true,
      centerId: true,
      teacherId: true,
      roomId: true,
      scheduleDays: true,
      startDate: true,
      startTime: true,
      endTime: true,
      curriculumId: true,
      // BGĐ 31/07 — giờ riêng theo thứ (lớp 2 ca khác giờ); trống → dùng giờ chung.
      scheduleSlots: { select: { weekday: true, startTime: true, endTime: true } },
      // 07/08 — kế hoạch lịch nhiều giai đoạn; có giai đoạn thì THẮNG lịch phẳng.
      schedulePhases: {
        orderBy: { effectiveFrom: "asc" },
        select: {
          effectiveFrom: true,
          effectiveTo: true,
          slots: { select: { weekday: true, startTime: true, endTime: true } },
        },
      },
      course: { select: { id: true, totalSessions: true } },
      // R7-06 — kế hoạch buổi của RIÊNG lớp (nếu đã pin curriculum/snapshot).
      sessionPlans: {
        orderBy: { order: "asc" },
        select: { id: true, lessonId: true },
      },
    },
  });
  if (!cls) return { ok: false, generated: 0, error: "Lớp không tồn tại" };

  // BGĐ 31/07 — lịch hiệu lực: slot riêng theo thứ (nếu có), lùi về scheduleDays + giờ chung.
  const slots = resolveClassSlots({
    scheduleDays: cls.scheduleDays,
    startTime: cls.startTime,
    endTime: cls.endTime,
    slots: cls.scheduleSlots,
  });
  const scheduleDays = slots.map((s) => s.weekday);

  // 07/08 — kế hoạch nhiều giai đoạn THẮNG lịch phẳng: thứ VÀ giờ đổi theo giai đoạn nên
  // không thể gắn giờ sau bằng `applySlotTimeToDate` (nó chỉ biết 1 bộ slot cho cả khoá).
  const phases: SchedulePhase[] = cls.schedulePhases
    .map((p) => ({
      effectiveFrom: p.effectiveFrom,
      effectiveTo: p.effectiveTo,
      slots: p.slots.map((s) => ({
        weekday: s.weekday,
        startTime: s.startTime,
        endTime: s.endTime,
      })),
    }))
    .filter((p) => p.slots.length > 0);
  const usePhases = phases.length > 0;

  if (!usePhases && scheduleDays.length === 0) {
    return { ok: false, generated: 0, error: "Lớp chưa có lịch học (scheduleDays)" };
  }

  /** Ngày (đã gắn giờ) cho `count` buổi kể từ `from` — theo giai đoạn nếu có. */
  const planDates = (from: Date, count: number, holidays: Set<string>): Date[] => {
    if (usePhases) {
      return computePhasedSessionDates({ from, count, phases, holidays }).dates;
    }
    return computeSessionDates({ from, scheduleDays, count, holidays }).map((d) =>
      // BGĐ 31/07 — giờ buổi lấy theo ĐÚNG THỨ của ngày đó (lớp 2 ca khác giờ).
      applySlotTimeToDate(d, slots, cls.startTime),
    );
  };

  /** Nhóm ngày theo khung giờ thật của chúng — để soát trùng đúng ca của từng giai đoạn. */
  const conflictGroups = (dates: Date[]): ConflictGroup[] => {
    const map = new Map<string, ConflictGroup>();
    for (const d of dates) {
      const slot = usePhases
        ? slotForDate(phases, d)
        : slots.find((s) => s.weekday === vnWeekday(d)) ?? null;
      const startTime = slot?.startTime || cls.startTime || "";
      if (!startTime) continue; // thiếu giờ → không đủ dữ liệu kết luận trùng
      const endTime = slot?.endTime ?? cls.endTime ?? null;
      const key = `${startTime}|${endTime ?? ""}`;
      const g = map.get(key) ?? { startTime, endTime, dates: [] };
      g.dates.push(d);
      map.set(key, g);
    }
    return [...map.values()];
  };

  const existing = await db.classSession.count({ where: { classId } });
  if (onlyIfEmpty && existing > 0) return { ok: true, generated: 0 };

  // ── R7-06: PLAN-AWARE (additive) ──────────────────────────────────────────
  // Lớp đã có ClassSessionPlan (giáo trình ghim / snapshot) → sinh buổi TỪ plan,
  // gắn planId + lessonId theo thứ tự plan. Số buổi = số plan.
  const plans = cls.sessionPlans ?? [];
  if (plans.length > 0) {
    const holidayRows = await db.holiday.findMany({
      where: { OR: [{ centerId: cls.centerId }, { centerId: null }] },
      select: { date: true, endDate: true },
    });
    const holidays = expandHolidaySet(holidayRows);

    const from = cls.startDate ?? new Date();
    const dates = planDates(from, plans.length, holidays);
    if (dates.length === 0) {
      return { ok: false, generated: 0, error: "Không tính được ngày buổi học" };
    }

    const data = dates.map((d, i) => ({
      classId,
      // Ngày ĐÃ kèm giờ: theo giai đoạn (kế hoạch) hoặc theo thứ (lịch phẳng).
      date: d,
      planId: plans[i]?.id ?? null,
      lessonId: plans[i]?.lessonId ?? null,
      // W2-4b — phòng buổi mặc định = phòng của lớp (cho soát trùng phòng per-buổi).
      roomId: cls.roomId ?? null,
      centerId: cls.centerId, // FL3-02 — denormalize từ class cho scopedDb
    }));

    // W2-4 — cảnh báo trùng GV/phòng (KHÔNG chặn sinh buổi; default an toàn).
    const warning = await warnIfConflict(cls, conflictGroups(dates));
    await db.classSession.createMany({ data });
    return {
      ok: true,
      generated: data.length,
      ...mergeWarnings(warning, shortPlanWarning(dates.length, plans.length)),
    };
  }

  // ── FALLBACK (lớp cũ, chưa pin): GIỮ NGUYÊN hành vi cũ ─────────────────────
  // Số buổi chuẩn: Course.totalSessions → fallback đếm Lesson giáo trình active.
  let count = cls.course?.totalSessions ?? 0;
  // Lessons giáo trình (để gắn lessonId theo thứ tự).
  const curriculum = cls.course?.id
    ? await db.curriculum.findFirst({
        where: { courseId: cls.course.id, isActive: true },
        orderBy: { version: "desc" },
        select: { lessons: { orderBy: { order: "asc" }, select: { id: true } } },
      })
    : null;
  const lessonIds = curriculum?.lessons.map((l) => l.id) ?? [];
  if (count <= 0) count = lessonIds.length;
  if (count <= 0) {
    return { ok: false, generated: 0, error: "Khoá chưa cấu hình số buổi / giáo trình" };
  }

  const holidayRows = await db.holiday.findMany({
    where: { OR: [{ centerId: cls.centerId }, { centerId: null }] },
    select: { date: true, endDate: true },
  });
  const holidays = expandHolidaySet(holidayRows);

  const from = cls.startDate ?? new Date();
  const dates = planDates(from, count, holidays);
  if (dates.length === 0) return { ok: false, generated: 0, error: "Không tính được ngày buổi học" };

  const data = dates.map((d, i) => ({
    classId,
    // Ngày ĐÃ kèm giờ (theo giai đoạn hoặc theo thứ).
    date: d,
    lessonId: lessonIds[i] ?? null,
    // W2-4b — phòng buổi mặc định = phòng của lớp (cho soát trùng phòng per-buổi).
    roomId: cls.roomId ?? null,
    centerId: cls.centerId, // FL3-02 — denormalize từ class cho scopedDb
  }));

  // W2-4 — cảnh báo trùng GV/phòng (KHÔNG chặn sinh buổi; default an toàn).
  const warning = await warnIfConflict(cls, conflictGroups(dates));
  await db.classSession.createMany({ data });
  return {
    ok: true,
    generated: data.length,
    ...mergeWarnings(warning, shortPlanWarning(dates.length, count)),
  };
}

/** Kế hoạch đóng, không đủ chỗ cho hết số buổi của khoá → nói thẳng, đừng sinh thiếu im lặng. */
function shortPlanWarning(got: number, want: number): string | undefined {
  if (got >= want) return undefined;
  return `Kế hoạch lịch chỉ đủ chỗ cho ${got}/${want} buổi — bỏ trống “đến ngày” của giai đoạn cuối (để mở) hoặc kéo dài giai đoạn cuối rồi sinh lại.`;
}

function mergeWarnings(...parts: (string | undefined)[]): { warning?: string } {
  const w = parts.filter(Boolean).join(" ");
  return w ? { warning: w } : {};
}

/** Một khung giờ + các ngày dùng khung giờ đó (lớp nhiều ca / nhiều giai đoạn). */
interface ConflictGroup {
  startTime: string;
  endTime: string | null;
  dates: Date[];
}

/**
 * W2-4 / T4.2 — soát trùng GV/phòng cho lô buổi sắp sinh. KHÔNG chặn (chỉ cảnh báo)
 * để không khoá vận hành lớp. Bỏ qua khi lớp chưa có giờ (date 00:00 → không đủ dữ
 * liệu kết luận trùng). Liệt kê tối đa 3 ngày trùng cho dễ xử lý.
 *
 * BGĐ 31/07 — lớp có giờ KHÁC NHAU theo thứ ⇒ soát theo TỪNG NHÓM THỨ với giờ của
 * chính thứ đó (trước đây áp 1 giờ chung cho mọi ngày → sai khi 2 ca lệch giờ).
 */
async function warnIfConflict(
  cls: {
    id: string;
    centerId: string | null;
    teacherId: string | null;
    roomId: string | null;
  },
  groups: ConflictGroup[],
): Promise<string | undefined> {
  if (!cls.teacherId && !cls.roomId) return undefined;
  try {
    const all: { date: Date; messages: string[] }[] = [];
    for (const g of groups) {
      if (g.dates.length === 0) continue;
      const conflicts = await detectBatchConflicts({
        // centerId = null → soát toàn hệ thống: GV có thể dạy 2 cơ sở.
        centerId: null,
        excludeClassId: cls.id,
        classStartTime: g.startTime,
        classEndTime: g.endTime,
        teacherId: cls.teacherId,
        roomId: cls.roomId,
        dates: g.dates,
      });
      all.push(...conflicts);
    }
    all.sort((a, b) => a.date.getTime() - b.date.getTime());
    return summarizeConflicts(all);
  } catch {
    return undefined; // best-effort: lỗi soát trùng không chặn sinh buổi
  }
}

/** Gộp danh sách ngày trùng thành 1 câu cảnh báo VI (undefined nếu không trùng). */
export function summarizeConflicts(
  conflicts: { date: Date; messages: string[] }[],
): string | undefined {
  if (conflicts.length === 0) return undefined;
  const shown = conflicts.slice(0, 3).map((c) => formatDateVN(c.date));
  const more = conflicts.length > shown.length ? ` (+${conflicts.length - shown.length} buổi nữa)` : "";
  const kinds = [...new Set(conflicts.flatMap((c) => c.messages))].join("; ");
  return `Cảnh báo xếp lịch — ${kinds}. Ngày: ${shown.join(", ")}${more}.`;
}
