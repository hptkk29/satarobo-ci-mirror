// BGĐ 31/07 — GIỜ HỌC THEO TỪNG THỨ (lớp 2 ca khác giờ: 17h30-T2 & 08h-T6).
//
// 2-phase: `ClassScheduleSlot` là nguồn CHÍNH; lớp chưa có slot → suy từ
// `Class.scheduleDays` + `startTime/endTime` chung (hành vi cũ, không vỡ dữ liệu).
// MỌI nơi cần "buổi thứ X mấy giờ" đọc qua đây, KHÔNG đọc thẳng Class.startTime.
//
// THUẦN (không đụng DB / Prisma) để dùng chung form client + server + test.

import { vnDateAt, vnParts } from "@/lib/time/vn";

export interface ClassTimeSlot {
  /** 0=CN … 6=T7 */
  weekday: number;
  /** "HH:mm" */
  startTime: string;
  endTime: string | null;
}

export interface ResolveSlotsInput {
  scheduleDays: number[];
  /** Giờ chung cả tuần (lớp cũ / lớp 1 ca). */
  startTime?: string | null;
  endTime?: string | null;
  /** Slot riêng theo thứ — có phần tử thì THẮNG giờ chung. */
  slots?: { weekday: number; startTime: string; endTime?: string | null }[] | null;
}

const isWeekday = (d: number) => Number.isInteger(d) && d >= 0 && d <= 6;

/** T2..T7 trước, CN cuối (đọc theo tuần học thay vì 0..6). */
function byWeekOrder(a: number, b: number): number {
  return (a === 0 ? 7 : a) - (b === 0 ? 7 : b);
}

/**
 * Lịch hiệu lực của lớp: mỗi thứ học 1 ca, kèm giờ của ĐÚNG thứ đó.
 *
 * - Tập THỨ lấy từ `scheduleDays` (nguồn chính); rỗng thì lấy từ slot.
 * - Giờ mỗi thứ: slot của thứ đó → lùi về giờ chung (`startTime/endTime`).
 *   ⇒ đặt giờ riêng cho MỘT thứ không làm mất các thứ còn lại.
 * - Không có thứ nào → [] (lớp chưa có lịch).
 */
export function resolveClassSlots(input: ResolveSlotsInput): ClassTimeSlot[] {
  const byDay = new Map<number, { startTime: string; endTime: string | null }>();
  for (const s of input.slots ?? []) {
    if (!isWeekday(s.weekday) || !s.startTime) continue;
    if (byDay.has(s.weekday)) continue; // unique(classId, weekday) — phòng dữ liệu bẩn
    byDay.set(s.weekday, { startTime: s.startTime, endTime: s.endTime ?? null });
  }

  const declared = [...new Set(input.scheduleDays.filter(isWeekday))];
  const days = (declared.length > 0 ? declared : [...byDay.keys()]).sort(byWeekOrder);

  return days.map((weekday) => {
    const slot = byDay.get(weekday);
    return {
      weekday,
      startTime: slot?.startTime ?? input.startTime ?? "",
      endTime: slot ? slot.endTime : (input.endTime ?? null),
    };
  });
}

/** Các thứ lớp học (0=CN…6=T7), thứ tự tuần học. */
export function slotWeekdays(slots: ClassTimeSlot[]): number[] {
  return slots.map((s) => s.weekday);
}

/** Giờ bắt đầu của 1 thứ cụ thể; không học thứ đó → null. */
export function startTimeForWeekday(slots: ClassTimeSlot[], weekday: number): string | null {
  return slots.find((s) => s.weekday === weekday)?.startTime || null;
}

/** Giờ kết thúc của 1 thứ cụ thể. */
export function endTimeForWeekday(slots: ClassTimeSlot[], weekday: number): string | null {
  return slots.find((s) => s.weekday === weekday)?.endTime ?? null;
}

/** "HH:mm" → {h, m}; không hợp lệ → 00:00. */
export function parseHm(time: string | null | undefined): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((time ?? "").trim());
  if (!m) return { h: 0, m: 0 };
  return { h: Number(m[1]), m: Number(m[2]) };
}

/** "HH:mm" theo đồng hồ VN của một thời điểm (không phụ thuộc TZ máy chạy). */
export function vnHm(d: Date): string {
  const p = vnParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * Khoảng giờ HIỂN THỊ của MỘT buổi: giờ bắt đầu lấy từ chính buổi, độ dài suy từ khung
 * giờ lớp (thiếu → chỉ trả giờ bắt đầu).
 *
 * ⚠️ 07/08 — đừng in thẳng `Class.startTime–endTime` cho buổi nữa. Với lớp dùng Kế hoạch
 * lịch học nhiều giai đoạn, hai field đó chỉ là BẢN SAO của giai đoạn đang hiệu lực; buổi
 * 08:00 của giai đoạn sau vẫn bị in "17:30–19:30" của giai đoạn trước (phụ huynh đưa con
 * sai giờ). `ClassSession.date` đã mang giờ đúng từ lúc sinh.
 */
export function sessionTimeRange(
  date: Date,
  classStartTime: string | null | undefined,
  classEndTime: string | null | undefined,
): { start: string; end: string | null } {
  const p = vnParts(date);

  // Buổi CŨ còn nằm ở 00:00 giờ VN (dữ liệu sinh trước đợt vá giờ buổi 06/08) KHÔNG mang
  // giờ thật — in thẳng ra là phụ huynh thấy "00:00". Lùi về giờ lớp như hành vi trước
  // 07/08. Cùng chốt chặn với `rowsToSlots` (lib/lms/schedule-conflict.ts): không lớp nào
  // học lúc nửa đêm, nên 00:00 luôn là dữ liệu chưa backfill chứ không phải giờ hợp lệ.
  if (p.hour === 0 && p.minute === 0 && classStartTime) {
    return { start: classStartTime, end: classEndTime ?? null };
  }

  const start = vnHm(date);
  if (!classStartTime || !classEndTime) return { start, end: null };

  const s = parseHm(classStartTime);
  const e = parseHm(classEndTime);
  const durMin = e.h * 60 + e.m - (s.h * 60 + s.m);
  if (durMin <= 0) return { start, end: null };

  const endMin = ((p.hour * 60 + p.minute + durMin) % 1440 + 1440) % 1440;
  return {
    start,
    end: `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`,
  };
}

/**
 * Gắn giờ của ĐÚNG thứ vào 1 ngày (dùng khi sinh buổi học).
 *
 * ⚠️ Thứ và giờ tính theo LỊCH VN, không theo TZ máy chạy: `17:30` phải luôn ra
 * 17h30 giờ VN dù server chạy UTC (Vercel). Bản cũ dùng `new Date(y,m,d,h,m)` nên
 * trên UTC ghi thành 17h30Z = 00h30 hôm sau ở VN → cả lớp nhảy sang ngày kế.
 */
export function applySlotTimeToDate(
  date: Date,
  slots: ClassTimeSlot[],
  fallbackStartTime?: string | null,
): Date {
  const p = vnParts(date);
  // Thứ này KHÔNG có slot riêng (vd lớp khai giờ T7, nay thêm buổi T5) → lùi về giờ
  // CHUNG của lớp. Thiếu bước này, parseHm(null) trả 00:00 và buổi được lưu 00:00 giờ
  // VN = 17:00Z ⇒ tab điểm danh hiện "17:00" cho mọi buổi, và phép so trùng lấy nhầm
  // mốc nên báo trùng oan với lớp khác cùng ngày. Ca thật 06/08/2026.
  const gio = startTimeForWeekday(slots, p.weekday) ?? fallbackStartTime ?? null;
  const { h, m } = parseHm(gio);
  return vnDateAt(p.year, p.month, p.day, h, m);
}
