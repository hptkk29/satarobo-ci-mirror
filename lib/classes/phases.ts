// lib/classes/phases.ts — KẾ HOẠCH LỊCH HỌC NHIỀU GIAI ĐOẠN (07/08/2026).
//
// VÌ SAO: `ClassScheduleSlot` có unique(classId, weekday) và không mang chiều thời gian
// ⇒ một lớp chỉ biểu diễn được ĐÚNG MỘT lịch cho cả vòng đời. Thực tế lớp đổi nhịp giữa
// khoá ("tháng 7 học 2 buổi/tuần, tháng 8 còn 1 buổi/tuần") hoặc đổi giờ theo mùa.
//
// MÔ HÌNH: lịch của lớp = dãy GIAI ĐOẠN không chồng lấn, mỗi giai đoạn có tập (thứ, giờ)
// riêng và khoảng ngày hiệu lực [effectiveFrom, effectiveTo]. Giai đoạn CUỐI được để
// `effectiveTo = null` = mở, kéo dài tới khi đủ số buổi của khoá. Khoảng TRỐNG giữa hai
// giai đoạn là hợp lệ và có nghĩa (nghỉ hè, nghỉ Tết) — không sinh buổi trong khoảng đó.
//
// THUẦN: không đụng DB / Prisma / server-only ⇒ dùng chung được cho form client, server
// action và unit test (test không cần Postgres).
//
// ⚠️ Mọi mốc ngày ở đây so theo LỊCH VIỆT NAM qua `@/lib/time/vn` — KHÔNG dùng
// `getDay()` / `new Date(y,m,d)` (bug "chạy máy tôi thì được" 06/08/2026: máy dev +07
// đúng, Vercel UTC lệch 1 ngày).

import {
  parseVnYmd,
  vnAddDays,
  vnDateAt,
  vnParts,
  vnStartOfDay,
  vnWeekday,
  vnYmd,
} from "@/lib/time/vn";
import type { ClassTimeSlot } from "@/lib/classes/slots";
import { parseHm } from "@/lib/classes/slots";
import type { SchedulePhaseInput } from "@/lib/classes/phase-form";

/** Giờ học của MỘT thứ trong MỘT giai đoạn. */
export interface PhaseSlot {
  /** 0=CN … 6=T7 */
  weekday: number;
  /** "HH:mm" */
  startTime: string;
  /** "HH:mm" — null = không khai giờ kết thúc (lùi về giờ chung của lớp khi hiển thị). */
  endTime: string | null;
}

/** Một giai đoạn lịch. `effectiveTo` TÍNH CẢ ngày đó; null = mở tới khi đủ buổi. */
export interface SchedulePhase {
  id?: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  slots: PhaseSlot[];
  note?: string | null;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const isWeekday = (d: number) => Number.isInteger(d) && d >= 0 && d <= 6;

/** T2..T7 trước, CN cuối — đọc theo tuần học thay vì 0..6. */
function byWeekOrder(a: number, b: number): number {
  return (a === 0 ? 7 : a) - (b === 0 ? 7 : b);
}

/** Nhãn thứ tiếng Việt (dùng chung cho UI + thông báo lỗi). */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: "T2",
  2: "T3",
  3: "T4",
  4: "T5",
  5: "T6",
  6: "T7",
  0: "CN",
};

/** Sắp giai đoạn theo ngày bắt đầu tăng dần (bản sao, không sửa mảng gốc). */
export function sortPhases<T extends { effectiveFrom: Date }>(phases: readonly T[]): T[] {
  return [...phases].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
}

/**
 * Giai đoạn phủ ngày `d`. So bằng KHOÁ NGÀY "YYYY-MM-DD" theo lịch VN, không so
 * timestamp — để buổi 19:00 ngày cuối giai đoạn vẫn thuộc giai đoạn đó (so timestamp
 * thì `effectiveTo` = 00:00 sẽ cắt mất chính ngày cuối).
 */
export function phaseForDate<T extends SchedulePhase>(
  phases: readonly T[],
  d: Date,
): T | null {
  const key = vnYmd(d);
  for (const p of sortPhases(phases)) {
    if (vnYmd(p.effectiveFrom) > key) continue;
    if (p.effectiveTo && vnYmd(p.effectiveTo) < key) continue;
    return p;
  }
  return null;
}

/** Ca học của đúng ngày `d` (giai đoạn phủ nó × thứ của nó); không học → null. */
export function slotForDate(phases: readonly SchedulePhase[], d: Date): PhaseSlot | null {
  const phase = phaseForDate(phases, d);
  if (!phase) return null;
  return phase.slots.find((s) => s.weekday === vnWeekday(d)) ?? null;
}

/**
 * Lịch hiệu lực (dạng `ClassTimeSlot[]` mà phần còn lại của repo đang dùng) tại một
 * ngày cụ thể. Trả `null` khi ngày đó không thuộc giai đoạn nào ⇒ caller tự quyết lùi
 * về lịch cũ của lớp hay coi như không học.
 */
export function classSlotsAt(
  phases: readonly SchedulePhase[],
  at: Date,
): ClassTimeSlot[] | null {
  const phase = phaseForDate(phases, at);
  if (!phase) return null;
  return [...phase.slots]
    .sort((a, b) => byWeekOrder(a.weekday, b.weekday))
    .map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime }));
}

export interface ComputePhasedDatesInput {
  /** Ngày bắt đầu quét (inclusive). */
  from: Date;
  /** Số buổi cần xếp. */
  count: number;
  phases: readonly SchedulePhase[];
  /** Ngày nghỉ "YYYY-MM-DD" (lịch VN) — buổi rơi vào đây bị đẩy sang buổi kế. */
  holidays: Set<string>;
  /**
   * Ngày ĐÃ BỊ CHIẾM "YYYY-MM-DD" — buổi đã điểm danh/đã hoàn tất nằm nguyên chỗ, không
   * xếp thêm buổi mới vào cùng ngày (một lớp không học 2 buổi trong 1 ngày).
   */
  blockedDays?: Set<string>;
  /**
   * "YYYY-MM-DD" — quét CHO ĐẾN HẾT ngày này rồi mới bắt đầu đếm `count`.
   *
   * Vì sao cần: khi dời lịch, các ứng viên rơi trước buổi bị khoá cuối cùng đều bị bỏ
   * qua ở bước ghép. Chốt số ứng viên bằng một hằng (`count + đệm`) thì dãy dừng quá
   * sớm và thuật toán báo oan "kế hoạch không đủ chỗ" dù giai đoạn cuối đang mở — ca
   * thật: lớp 40 buổi, buổi #30 bị khoá ở 27/02/2027, đổi sang 3 buổi/tuần.
   */
  untilKey?: string | null;
}

export interface ComputePhasedDatesResult {
  /** Thời điểm BẮT ĐẦU từng buổi (đã gắn giờ của giai đoạn tương ứng). */
  dates: Date[];
  /** true = kế hoạch hết chỗ trước khi xếp đủ `count` buổi (tính SAU `untilKey`). */
  exhausted: boolean;
}

/**
 * Xếp `count` buổi kể từ `from` theo dãy giai đoạn.
 *
 * Khác `computeSessionDates` (một bộ `scheduleDays` duy nhất, trả mốc 00:00 rồi để
 * caller gắn giờ) ở hai điểm quan trọng:
 *   • Thứ VÀ giờ đổi theo giai đoạn ⇒ hàm này trả thẳng thời điểm có giờ. Gắn giờ ở
 *     ngoài là sai: caller không biết ngày đó thuộc giai đoạn nào.
 *   • Có `exhausted` — mọi giai đoạn đều đóng mà chưa đủ buổi thì phải BÁO, không được
 *     im lặng trả thiếu (buổi thiếu sẽ bị caller nuốt bằng `?? ngày cũ`).
 */
export function computePhasedSessionDates(
  input: ComputePhasedDatesInput,
): ComputePhasedDatesResult {
  const { from, count, holidays } = input;
  const blocked = input.blockedDays ?? new Set<string>();
  const phases = sortPhases(input.phases).filter((p) => p.slots.length > 0);
  const out: Date[] = [];
  if (count <= 0 || phases.length === 0) return { dates: out, exhausted: count > 0 };

  // Mốc dừng: nếu MỌI giai đoạn đều có ngày kết thúc thì quét không vượt quá ngày cuối.
  const openEnded = phases.some((p) => p.effectiveTo === null);
  const lastEndKey = openEnded
    ? null
    : phases.reduce(
        (acc, p) => {
          const k = vnYmd(p.effectiveTo as Date);
          return k > acc ? k : acc;
        },
        vnYmd(phases[0].effectiveFrom),
      );

  const untilKey = input.untilKey ?? null;
  let cur = vnStartOfDay(from);
  // Chặn vòng lặp vô hạn: đủ cho ~1 buổi/tuần + đệm khoảng nghỉ dài + vùng tới untilKey.
  const maxIter = count * 7 * 10 + 4000;
  let i = 0;
  /** Số ứng viên sinh ra SAU `untilKey` — mới là cái phải đủ `count`. */
  let afterUntil = 0;
  while (i < maxIter) {
    i++;
    const key = vnYmd(cur);
    const pastUntil = untilKey === null || key > untilKey;
    if (pastUntil && afterUntil >= count) break;
    if (lastEndKey !== null && key > lastEndKey) break; // hết kế hoạch

    const slot = slotForDate(phases, cur);
    if (slot && !holidays.has(key) && !blocked.has(key)) {
      const p = vnParts(cur);
      const { h, m } = parseHm(slot.startTime);
      out.push(vnDateAt(p.year, p.month, p.day, h, m));
      if (pastUntil) afterUntil++;
    }
    cur = vnAddDays(cur, 1);
  }

  return { dates: out, exhausted: afterUntil < count };
}

/** Một buổi đã sinh, kèm lý do bị khoá (null = được dời). */
export interface SessionForPlan {
  id: string;
  date: Date;
  lockReason: string | null;
}

export interface AssignedSession {
  id: string;
  oldDate: Date;
  /** null = giữ nguyên ngày cũ. */
  newDate: Date | null;
  keepReason: string | null;
}

/**
 * Rải `candidates` (ngày ứng viên theo kế hoạch, tăng dần) vào các buổi CÒN DỜI ĐƯỢC, GIỮ
 * ĐÚNG THỨ TỰ của cả dãy.
 *
 * Vì sao cần con trỏ `minKey` chứ không chỉ "lấy ngày trống kế tiếp": buổi bị khoá đứng
 * nguyên chỗ cũ. Nếu buổi 11 bị khoá ở 20/08 mà buổi 12 được rải vào 12/08 thì giáo trình
 * chạy ngược — học viên học bài 12 trước bài 11, và học bạ (đọc theo `planId`) sai bài.
 * Con trỏ đảm bảo ngày của buổi sau luôn ≥ ngày của buổi trước.
 *
 * Tách khỏi tầng DB để test được không cần Postgres — đây là chỗ dễ sai nhất của tính năng.
 */
export function assignPhasedDates(input: {
  /** Buổi từ mốc áp dụng trở đi, ĐÃ sắp theo ngày cũ tăng dần. */
  sessions: readonly SessionForPlan[];
  /** Mốc áp dụng (00:00 giờ VN). */
  from: Date;
  /** Ngày ứng viên do `computePhasedSessionDates` sinh (đã kèm giờ, tăng dần). */
  candidates: readonly Date[];
}): { items: AssignedSession[]; ranOut: boolean } {
  const items: AssignedSession[] = [];
  const list = input.sessions;

  // Ngày của buổi KHOÁ gần nhất đứng SAU mỗi vị trí — trần trên cho buổi dời được ở vị
  // trí đó. Thiếu trần này thì buổi trống đứng TRƯỚC một buổi khoá có thể bị đẩy ra SAU
  // nó (kế hoạch mới thưa hơn lịch cũ) ⇒ giáo trình chạy ngược.
  const nextLockedKey: (string | null)[] = new Array(list.length).fill(null);
  let seen: string | null = null;
  for (let i = list.length - 1; i >= 0; i--) {
    nextLockedKey[i] = seen;
    if (list[i].lockReason) seen = vnYmd(list[i].date);
  }

  let ci = 0;
  let minKey = vnYmd(input.from);

  for (const [i, s] of list.entries()) {
    if (s.lockReason) {
      items.push({ id: s.id, oldDate: s.date, newDate: null, keepReason: s.lockReason });
      const k = vnYmd(s.date);
      // Buổi khoá đẩy con trỏ qua NGÀY của nó — buổi sau không được xếp trùng/trước nó.
      if (k >= minKey) minKey = vnYmd(vnAddDays(s.date, 1));
      continue;
    }

    while (ci < input.candidates.length && vnYmd(input.candidates[ci]) < minKey) ci++;
    if (ci >= input.candidates.length) return { items, ranOut: true };

    const nd = input.candidates[ci];
    const cap = nextLockedKey[i];
    if (cap !== null && vnYmd(nd) >= cap) {
      // Không còn chỗ TRƯỚC buổi khoá kế tiếp → giữ nguyên ngày cũ (vốn đã đúng thứ tự)
      // và nói rõ lý do. KHÔNG tiêu ứng viên này: buổi sau còn dùng được.
      items.push({
        id: s.id,
        oldDate: s.date,
        newDate: null,
        keepReason: `kế hoạch mới không còn chỗ trước buổi đã khoá ngày ${cap}`,
      });
      const k = vnYmd(s.date);
      if (k >= minKey) minKey = vnYmd(vnAddDays(s.date, 1));
      continue;
    }

    ci++;
    minKey = vnYmd(vnAddDays(nd, 1));
    items.push({ id: s.id, oldDate: s.date, newDate: nd, keepReason: null });
  }
  return { items, ranOut: false };
}

/**
 * Bản sao lịch PHẲNG để ghi vào `Class` NGAY LÚC TẠO, quy chiếu theo NGÀY KHAI GIẢNG.
 *
 * Khác `legacyScheduleFromPhases` ở chỗ KHÔNG BAO GIỜ trả null khi kế hoạch có nội dung:
 * lớp khai giảng tháng sau thì hôm nay chưa giai đoạn nào hiệu lực, hàm kia trả null
 * (đúng cho cron: giữ nguyên bản sao đang có) — nhưng lớp VỪA TẠO chưa có bản sao nào để
 * giữ, nên nó sẽ nằm im với `scheduleDays: []` suốt cả kỳ trước khai giảng. Khi đó ~40 chỗ
 * đọc lịch kiểu cũ đều hỏng lặng: bảng công GV 0 giờ, lưới lịch tuần mất lớp, dò trùng
 * phòng bỏ qua, PDF học bạ in "—". Không giai đoạn nào phủ ngày khai giảng thì lùi về
 * giai đoạn ĐẦU.
 */
export function flatScheduleAtStart(
  phases: readonly SchedulePhase[],
  startDate: Date | null,
): { scheduleDays: number[]; startTime: string | null; endTime: string | null; slots: PhaseSlot[] } {
  const derived = legacyScheduleFromPhases(phases, startDate ?? new Date());
  if (derived) return derived;

  const first = sortPhases(phases).filter((p) => p.slots.length > 0)[0];
  if (!first) return { scheduleDays: [], startTime: null, endTime: null, slots: [] };

  const slots = [...first.slots].sort((a, b) => byWeekOrder(a.weekday, b.weekday));
  return {
    scheduleDays: slots.map((s) => s.weekday),
    startTime: slots[0]?.startTime ?? null,
    endTime: slots[0]?.endTime ?? null,
    slots,
  };
}

/**
 * Lịch PHẲNG (đường nhập Excel/API cũ) → MỘT giai đoạn mở kể từ ngày khai giảng.
 *
 * Vì sao cần: `legacyPhaseFromClass` chỉ suy giai đoạn khi ĐỌC, không ghi gì. Lớp tạo bằng
 * import vì thế không có bản ghi `ClassSchedulePhase` nào ⇒ vô hình với cron đồng bộ bản
 * sao (`resyncLegacyScheduleForAllClasses` chỉ quét lớp CÓ kế hoạch) và với khối sửa lịch.
 * Ghi luôn 1 giai đoạn lúc import thì mọi lớp — nhập tay hay nhập file — cùng một mô hình.
 */
export function phaseFromFlatSchedule(input: {
  scheduleDays: number[];
  startTime: string | null;
  endTime: string | null;
  slots?: { weekday: number; startTime: string; endTime?: string | null }[] | null;
  startDate: Date | null;
}): SchedulePhase | null {
  const phase = legacyPhaseFromClass(input);
  // Giờ bắt đầu rỗng = lớp mới khai thứ chứ chưa khai giờ → kế hoạch sẽ không qua nổi
  // `validatePhases` (HH:mm) và sinh buổi lúc 00:00. Thà không có kế hoạch còn hơn có
  // kế hoạch rác: lớp vẫn chạy đường lịch phẳng như trước.
  if (!phase || phase.slots.some((s) => !HHMM.test(s.startTime))) return null;
  return phase;
}

/**
 * Kế hoạch dạng FORM (chuỗi "YYYY-MM-DD" / "HH:mm") → miền nghiệp vụ (`Date`).
 *
 * ⚠️ Ngày phải đi qua `parseVnYmd` (00:00 giờ VN). `new Date("2026-08-12")` hay
 * `z.coerce.date()` ra nửa đêm UTC = 07:00 VN và ăn mất buổi sáng của chính ngày đó.
 *
 * Dùng chung cho CẢ HAI đường vào: khối "Kế hoạch lịch học" của lớp đã tồn tại
 * (`_schedule-actions.ts`) và form tạo lớp (`classes/_actions.ts`). Hai bản chép tay
 * sẽ lệch nhau đúng vào lúc không ai ngờ.
 */
export function phaseInputsToDomain(
  input: readonly SchedulePhaseInput[],
): { ok: true; phases: SchedulePhase[] } | { ok: false; error: string } {
  const phases: SchedulePhase[] = [];
  for (const [i, p] of input.entries()) {
    const from = parseVnYmd(p.from ?? "");
    if (!from) return { ok: false, error: `Giai đoạn ${i + 1}: thiếu ngày bắt đầu.` };
    const to = p.to?.trim() ? parseVnYmd(p.to) : null;
    if (p.to?.trim() && !to) {
      return { ok: false, error: `Giai đoạn ${i + 1}: ngày kết thúc không hợp lệ.` };
    }
    phases.push({
      effectiveFrom: from,
      effectiveTo: to,
      note: p.note?.trim() || null,
      slots: (p.slots ?? []).map((s) => ({
        weekday: Number(s.weekday),
        startTime: (s.startTime ?? "").trim(),
        endTime: (s.endTime ?? "").trim() || null,
      })),
    });
  }
  return { ok: true, phases };
}

/**
 * Soát kế hoạch trước khi lưu. Trả danh sách lỗi tiếng Việt (rỗng = hợp lệ).
 * KHÔNG bỏ qua im lặng: kế hoạch sai đẻ ra lịch sai cho cả lớp.
 */
export function validatePhases(phases: readonly SchedulePhase[]): string[] {
  const errors: string[] = [];
  if (phases.length === 0) return ["Cần ít nhất 1 giai đoạn lịch học."];

  const sorted = sortPhases(phases);

  sorted.forEach((p, idx) => {
    const n = idx + 1;
    if (Number.isNaN(p.effectiveFrom.getTime())) {
      errors.push(`Giai đoạn ${n}: ngày bắt đầu không hợp lệ.`);
      return;
    }
    if (p.effectiveTo && vnYmd(p.effectiveTo) < vnYmd(p.effectiveFrom)) {
      errors.push(`Giai đoạn ${n}: ngày kết thúc trước ngày bắt đầu.`);
    }
    if (p.slots.length === 0) {
      errors.push(`Giai đoạn ${n}: chưa chọn thứ nào trong tuần.`);
    }
    const seen = new Set<number>();
    for (const s of p.slots) {
      if (!isWeekday(s.weekday)) {
        errors.push(`Giai đoạn ${n}: thứ không hợp lệ.`);
        continue;
      }
      if (seen.has(s.weekday)) {
        errors.push(`Giai đoạn ${n}: ${WEEKDAY_LABELS[s.weekday]} bị khai 2 lần.`);
        continue;
      }
      seen.add(s.weekday);
      if (!HHMM.test(s.startTime)) {
        errors.push(`Giai đoạn ${n} · ${WEEKDAY_LABELS[s.weekday]}: giờ bắt đầu phải dạng HH:mm.`);
        continue;
      }
      if (s.endTime !== null && s.endTime !== "") {
        if (!HHMM.test(s.endTime)) {
          errors.push(`Giai đoạn ${n} · ${WEEKDAY_LABELS[s.weekday]}: giờ kết thúc phải dạng HH:mm.`);
        } else if (s.endTime <= s.startTime) {
          errors.push(
            `Giai đoạn ${n} · ${WEEKDAY_LABELS[s.weekday]}: giờ kết thúc phải sau giờ bắt đầu.`,
          );
        }
      }
    }
  });

  // Chỉ giai đoạn CUỐI được để mở — giai đoạn giữa mà mở sẽ nuốt hết phần sau.
  sorted.forEach((p, idx) => {
    if (p.effectiveTo === null && idx !== sorted.length - 1) {
      errors.push(
        `Giai đoạn ${idx + 1}: phải có ngày kết thúc (chỉ giai đoạn cuối được bỏ trống).`,
      );
    }
  });

  // Chồng lấn: giai đoạn sau phải bắt đầu SAU ngày kết thúc của giai đoạn trước.
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev.effectiveTo) continue; // đã báo lỗi "phải có ngày kết thúc" ở trên
    if (vnYmd(cur.effectiveFrom) <= vnYmd(prev.effectiveTo)) {
      errors.push(
        `Giai đoạn ${i} và ${i + 1} chồng lấn ngày — giai đoạn sau phải bắt đầu sau ngày kết thúc của giai đoạn trước.`,
      );
    }
  }

  return [...new Set(errors)];
}

/** Khoảng TRỐNG giữa các giai đoạn (hợp lệ nhưng nên cảnh báo: lớp nghỉ trong khoảng đó). */
export function findScheduleGaps(
  phases: readonly SchedulePhase[],
): { fromKey: string; toKey: string }[] {
  const sorted = sortPhases(phases);
  const gaps: { fromKey: string; toKey: string }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prevTo = sorted[i - 1].effectiveTo;
    if (!prevTo) continue;
    const gapStart = vnAddDays(prevTo, 1);
    if (vnYmd(gapStart) < vnYmd(sorted[i].effectiveFrom)) {
      gaps.push({
        fromKey: vnYmd(gapStart),
        toKey: vnYmd(vnAddDays(sorted[i].effectiveFrom, -1)),
      });
    }
  }
  return gaps;
}

/**
 * Lịch cũ của lớp → MỘT giai đoạn ngầm ("giai đoạn 1"), cho lớp chưa lập kế hoạch.
 *
 * Nhờ hàm này mà "kế hoạch là nguồn duy nhất" đúng ngay cả khi CHƯA backfill: mọi lớp
 * cũ vẫn được nhìn như có 1 giai đoạn mở, chạy y hệt hành vi trước đây. Không có thứ
 * nào (lớp chưa khai lịch) → null.
 */
export function legacyPhaseFromClass(input: {
  scheduleDays: number[];
  startTime: string | null;
  endTime: string | null;
  slots?: { weekday: number; startTime: string; endTime?: string | null }[] | null;
  startDate: Date | null;
}): SchedulePhase | null {
  const byDay = new Map<number, { startTime: string; endTime: string | null }>();
  for (const s of input.slots ?? []) {
    if (!isWeekday(s.weekday) || !s.startTime) continue;
    if (byDay.has(s.weekday)) continue;
    byDay.set(s.weekday, { startTime: s.startTime, endTime: s.endTime ?? null });
  }
  const declared = [...new Set(input.scheduleDays.filter(isWeekday))];
  const days = (declared.length > 0 ? declared : [...byDay.keys()]).sort(byWeekOrder);
  if (days.length === 0) return null;

  return {
    effectiveFrom: vnStartOfDay(input.startDate ?? new Date()),
    effectiveTo: null,
    slots: days.map((weekday) => {
      const slot = byDay.get(weekday);
      return {
        weekday,
        startTime: slot?.startTime ?? input.startTime ?? "",
        endTime: slot ? slot.endTime : (input.endTime ?? null),
      };
    }),
  };
}

/**
 * Bản sao DẪN XUẤT cho các field lịch cũ trên `Class` (`scheduleDays`, `startTime`,
 * `endTime`) + `ClassScheduleSlot`.
 *
 * Vì sao vẫn phải ghi: ~40 chỗ trong repo đọc lịch kiểu cũ (site GV, PDF học bạ, soát
 * trùng phòng/GV, dự phóng ngày kết thúc ở portal). Đổi hết một lượt là rủi ro lớn hơn
 * nhiều so với giữ một bản sao của GIAI ĐOẠN ĐANG HIỆU LỰC.
 *
 * ⚠️ Không có giai đoạn nào phủ `at` (kế hoạch còn ở tương lai, hoặc đang trong khoảng
 * nghỉ giữa 2 giai đoạn) → trả `null` để caller GIỮ NGUYÊN bản sao đang có. Trước đây
 * hàm này lùi về "giai đoạn sắp tới": lập kế hoạch đổi ca từ tháng sau là bản sao đổi
 * NGAY hôm nay, site GV và portal hiện lịch của tháng sau cho tuần này. Cron
 * `class-schedule-sync` sẽ ghi khi giai đoạn thật sự có hiệu lực.
 */
export function legacyScheduleFromPhases(
  phases: readonly SchedulePhase[],
  at: Date,
): { scheduleDays: number[]; startTime: string | null; endTime: string | null; slots: PhaseSlot[] } | null {
  const sorted = sortPhases(phases).filter((p) => p.slots.length > 0);
  if (sorted.length === 0) return null;

  const active = phaseForDate(sorted, at);
  if (!active) return null;

  const slots = [...active.slots].sort((a, b) => byWeekOrder(a.weekday, b.weekday));
  return {
    scheduleDays: slots.map((s) => s.weekday),
    // Giờ CHUNG = giờ của ca sớm nhất trong tuần; các ca lệch giờ đã có slot riêng.
    startTime: slots[0]?.startTime ?? null,
    endTime: slots[0]?.endTime ?? null,
    slots,
  };
}
