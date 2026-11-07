// Lịch/đồng hồ Việt Nam — ĐỘC LẬP với timezone của tiến trình Node.
//
// ⚠️ VÌ SAO CÓ FILE NÀY (bug 06/08/2026 — sinh buổi học lệch 1 ngày):
// Mọi chỗ dựng "ngày giờ treo tường" bằng `new Date(y, m, d, h, min)` hay đọc thứ
// bằng `getDay()` đều chạy theo TZ CỦA MÁY CHẠY:
//   - máy dev (Windows, Asia/Saigon = +07) → trùng giờ VN → NHÌN NHƯ ĐÚNG;
//   - Vercel/CI (không set TZ ⇒ **UTC**) → lớp 17:30 T7 20/06 được ghi thành
//     `2026-06-20T17:30:00Z`, trình duyệt ở VN đọc ra **00:30 CN 21/06**.
// ⇒ Cả loạt buổi nhảy sang hôm sau và lệch thứ. Đây là lỗi "chạy máy tôi thì được".
//
// LUẬT: mọi tính toán ngày/thứ/giờ của lịch học đi qua các hàm dưới đây.
// KHÔNG dùng `getDay()/getHours()/new Date(y,m,d,…)` cho dữ liệu lịch nữa.
//
// Offset cố định +07:00: Việt Nam KHÔNG có DST (từ 1975), nên không cần bảng IANA.

export const VN_UTC_OFFSET_MINUTES = 420;

const OFFSET_MS = VN_UTC_OFFSET_MINUTES * 60_000;

/** Cùng thời điểm nhưng dịch để đọc bằng `getUTC*` ra ĐỒNG HỒ VN. */
function asVnClock(d: Date): Date {
  return new Date(d.getTime() + OFFSET_MS);
}

export interface VnParts {
  year: number;
  /** 0-11 (như `Date.getMonth`). */
  month: number;
  day: number;
  /** 0=CN … 6=T7. */
  weekday: number;
  hour: number;
  minute: number;
}

/** Các thành phần lịch VN của một thời điểm. */
export function vnParts(d: Date): VnParts {
  const c = asVnClock(d);
  return {
    year: c.getUTCFullYear(),
    month: c.getUTCMonth(),
    day: c.getUTCDate(),
    weekday: c.getUTCDay(),
    hour: c.getUTCHours(),
    minute: c.getUTCMinutes(),
  };
}

/** Thứ theo lịch VN (0=CN … 6=T7) — thay cho `date.getDay()`. */
export function vnWeekday(d: Date): number {
  return asVnClock(d).getUTCDay();
}

/** "YYYY-MM-DD" theo lịch VN — khoá so ngày (ngày nghỉ, trùng buổi…). */
export function vnYmd(d: Date): string {
  const c = asVnClock(d);
  const mm = String(c.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(c.getUTCDate()).padStart(2, "0");
  return `${c.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Thời điểm ứng với đồng hồ treo tường VN `y-m-d h:min`.
 * VD: `vnDateAt(2026, 5, 20, 17, 30)` → `2026-06-20T10:30:00.000Z` (17h30 T7 ở VN).
 */
export function vnDateAt(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - OFFSET_MS);
}

/** 00:00 giờ VN của ngày chứa `d`. */
export function vnStartOfDay(d: Date): Date {
  const p = vnParts(d);
  return vnDateAt(p.year, p.month, p.day);
}

/** 23:59:59.999 giờ VN của ngày chứa `d`. */
export function vnEndOfDay(d: Date): Date {
  const p = vnParts(d);
  return new Date(vnDateAt(p.year, p.month, p.day + 1).getTime() - 1);
}

/** Cộng/trừ `n` ngày theo LỊCH VN, giữ nguyên giờ-phút VN. */
export function vnAddDays(d: Date, n: number): Date {
  const p = vnParts(d);
  return vnDateAt(p.year, p.month, p.day + n, p.hour, p.minute);
}

/**
 * Ngày-không-giờ để lưu vào cột chỉ mang ý nghĩa NGÀY (`Class.startDate`,
 * `Class.endDate`): nửa đêm **UTC** của ngày VN. Trùng quy ước mà form admin đang
 * ghi (`z.coerce.date("2026-06-20")` → `2026-06-20T00:00:00Z`) nên so sánh
 * `endDate >= startDate` không lệch.
 */
export function vnDateOnly(d: Date): Date {
  const p = vnParts(d);
  return new Date(Date.UTC(p.year, p.month, p.day));
}

/** Parse "YYYY-MM-DD" (từ `<input type="date">`) thành 00:00 giờ VN. Sai định dạng → null. */
export function parseVnYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = vnDateAt(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Chuỗi của `<input type="datetime-local">` → `Date`, đọc theo ĐỒNG HỒ VN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Vì sao phải có (06/09/2026)
 *
 * `<input type="datetime-local">` gửi lên `"YYYY-MM-DDTHH:mm"` — KHÔNG kèm múi giờ. Theo
 * chuẩn ECMAScript, chuỗi ngày-giờ không có hậu tố múi được hiểu là giờ ĐỊA PHƯƠNG CỦA
 * TIẾN TRÌNH. Máy dev chạy +07 nên nhìn như đúng; **Vercel chạy UTC**, nên mọi
 * `new Date(value)` / `z.coerce.date()` trên chuỗi này đều ghi lệch **7 tiếng**:
 *
 *   giáo vụ nhập buổi 17:30 ngày 12/09  →  DB ghi 2026-09-12T17:30:00Z  =  00:30 13/09 VN
 *   giáo viên đặt hạn nộp 23:59 12/09   →  DB ghi 2026-09-12T23:59:00Z  =  06:59 13/09 VN
 *
 * Phụ huynh đọc ra giờ học nửa đêm và hạn nộp sang ngày hôm sau; các phép "đã diễn ra" /
 * "buổi hôm nay" cũng lệch theo. Lỗi thuộc loại "chạy máy tôi thì được".
 *
 * Chuỗi ĐÃ có múi giờ (`Z` hoặc `±hh:mm`) được tôn trọng nguyên trạng — chỉ chuỗi trần
 * mới được gán +07:00.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function parseVnDateTimeLocal(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v === "") return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (!m) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = vnDateAt(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
  );
  if (Number.isNaN(d.getTime())) return null;
  return m[6] ? new Date(d.getTime() + Number(m[6]) * 1000) : d;
}
