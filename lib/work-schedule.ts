/**
 * Tính công theo CA ĐÃ ĐĂNG KÝ (Đợt 3E — thay mô hình 2-ca cố định của FIX 6).
 *
 * Dữ liệu chấm công lưu UTC; mọi tính toán/hiển thị quy về Asia/Ho_Chi_Minh
 * (UTC+7, không DST). Đủ công = có mặt trọn (các) ca đã đăng ký của ngày đó
 * (dung sai 5'). Ca chiều (13:30–17:30) và ca tối (17:00–21:00) CHỒNG giờ →
 * khi đăng ký liền nhau tính theo KHOẢNG LIÊN TỤC (merge), không cộng máy móc.
 */
import type { WorkShift } from "@prisma/client";
import { SHIFT_DEFS, SHIFT_TOLERANCE_MIN, SHIFT_ORDER } from "@/lib/shifts";

export const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";
const VN_OFFSET_MIN = 7 * 60;

export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/** Phút-trong-ngày theo giờ tường VN của một mốc UTC. */
export function vnMinutesOfDay(date: Date): number {
  const total = Math.floor(date.getTime() / 60000) + VN_OFFSET_MIN;
  return ((total % 1440) + 1440) % 1440;
}

/** Format giờ HH:MM theo GMT+7. */
export function formatVNTime(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type Interval = { start: number; end: number };

/**
 * Gộp các ca đăng ký thành khoảng liên tục (phút). Ca chồng/nối nhau → merge;
 * ca cách nhau (vd sáng↔chiều, có nghỉ trưa) → giữ riêng để loại nghỉ trưa.
 */
export function mergeShiftIntervals(shifts: WorkShift[]): Interval[] {
  const ranges = shifts
    .map((s) => ({ start: hmToMinutes(SHIFT_DEFS[s].start), end: hmToMinutes(SHIFT_DEFS[s].end) }))
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

function overlap(a: number, b: number, c: number, d: number): number {
  return Math.max(0, Math.min(b, d) - Math.max(a, c));
}

/**
 * Module Chấm công PHẦN 3 — kiểm tra ca đăng ký có PHỦ giờ dạy không.
 * teaching: các khoảng tiết dạy {start,end} (HH:MM). Trả về true nếu có ÍT NHẤT
 * một tiết dạy KHÔNG được ca đăng ký phủ trọn → nhắc GV chọn ca phủ giờ dạy.
 */
export function teachingUncovered(
  shifts: WorkShift[],
  teaching: { start: string; end: string }[],
): boolean {
  if (teaching.length === 0) return false;
  const intervals = mergeShiftIntervals(shifts);
  return teaching.some((t) => {
    const ts = hmToMinutes(t.start);
    const te = hmToMinutes(t.end);
    return !intervals.some((iv) => iv.start <= ts && iv.end >= te);
  });
}

export type AttendanceTag = { label: string; tone: "ok" | "warn" | "danger" };

export type ShiftAttendance = {
  workedHours: number;
  expectedHours: number;
  tags: AttendanceTag[];
};

/**
 * Tính công 1 ngày theo ca đăng ký.
 * - registeredShifts rỗng + có chấm công → "Chưa đăng ký ca" (cảnh báo).
 * - đăng ký mà không quét → "Thiếu ca".
 * - Đủ công = giờ công thực ≥ giờ kỳ vọng (tổng khoảng liên tục) − dung sai.
 */
export function computeShiftAttendance(
  input: {
    checkIn: Date | null;
    checkOut: Date | null;
    geofenceFlag: boolean;
    registeredShifts: WorkShift[];
  },
  toleranceMinutes: number = SHIFT_TOLERANCE_MIN, // caller async truyền từ SystemSetting "shift.toleranceMinutes"
): ShiftAttendance {
  const { checkIn, checkOut, geofenceFlag, registeredShifts } = input;
  const tags: AttendanceTag[] = [];
  const tolH = toleranceMinutes / 60;

  if (geofenceFlag) tags.push({ label: "Ngoài vùng", tone: "danger" });

  const intervals = mergeShiftIntervals(registeredShifts);
  const expectedMin = intervals.reduce((s, i) => s + (i.end - i.start), 0);
  const expectedHours = Math.round((expectedMin / 60) * 100) / 100;

  // Không đăng ký ca.
  if (registeredShifts.length === 0) {
    if (checkIn) tags.push({ label: "Chưa đăng ký ca", tone: "warn" });
    else tags.push({ label: "—", tone: "warn" });
    return { workedHours: 0, expectedHours: 0, tags };
  }

  // Đăng ký mà không quét vào.
  if (!checkIn) {
    tags.push({ label: "Thiếu ca (không quét)", tone: "danger" });
    return { workedHours: 0, expectedHours, tags };
  }

  const ci = vnMinutesOfDay(checkIn);
  if (!checkOut) {
    tags.push({ label: "Thiếu check-out", tone: "warn" });
    return { workedHours: 0, expectedHours, tags };
  }
  const co = vnMinutesOfDay(checkOut);

  const workedMin = intervals.reduce((s, iv) => s + overlap(ci, co, iv.start, iv.end), 0);
  const workedHours = Math.round((workedMin / 60) * 100) / 100;

  const firstStart = intervals[0].start;
  const lastEnd = intervals[intervals.length - 1].end;
  const late = ci > firstStart + toleranceMinutes;
  const earlyLeave = co < lastEnd - toleranceMinutes;
  const enough = workedHours >= expectedHours - tolH;

  if (late) tags.push({ label: "Đi muộn", tone: "warn" });
  if (earlyLeave) tags.push({ label: "Về sớm", tone: "warn" });

  if (!enough) {
    tags.push({ label: `Thiếu giờ · ${workedHours}/${expectedHours}h`, tone: "danger" });
  } else if (!late && !earlyLeave && !geofenceFlag) {
    tags.push({ label: "Đủ công", tone: "ok" });
  } else if (tags.filter((t) => t.label !== "Ngoài vùng").length === 0) {
    tags.push({ label: "Đủ công", tone: "ok" });
  }

  return { workedHours, expectedHours, tags };
}

/** Nhãn gọn các ca đăng ký, vd "Sáng + Chiều". */
export function formatRegisteredShifts(shifts: WorkShift[]): string {
  if (shifts.length === 0) return "—";
  return SHIFT_ORDER.filter((s) => shifts.includes(s))
    .map((s) => SHIFT_DEFS[s].label.replace("Ca ", ""))
    .join(" + ");
}
