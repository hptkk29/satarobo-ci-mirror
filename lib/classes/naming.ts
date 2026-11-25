// T3.4 — quy ước TÊN HIỂN THỊ của lớp: `tênkhoá.giờ-thứ.phòng`
//   vd: `sata4.17h30-T2&17h30-T6.P302`
//
// QĐ-6: convention dùng cho `Class.name` (tên hiển thị, SỬA ĐƯỢC), KHÔNG thay
// `Class.classCode` — mã khoá vẫn là chuỗi auto-seq `CS1.SATA3.26.001` (lib/codegen.ts).
// Lý do: format này không có seq (2 lớp cùng khoá+giờ+thứ+phòng sẽ đụng @@unique) và
// nhúng phòng/giờ nên sẽ LỆCH ngay khi admin đổi phòng/lịch sau lúc tạo.
//
// THUẦN (không đụng DB / không import Prisma) để dùng chung cho form client + server.

/** 0=CN … 6=T7 → nhãn thứ tiếng Việt. */
const WEEKDAY_LABEL = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

/** "17:30" → "17h30" · "08:00" → "08h". Không hợp lệ → null. */
export function formatClassTimeToken(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hh = m[1]!.padStart(2, "0");
  const mm = m[2]!;
  return mm === "00" ? `${hh}h` : `${hh}h${mm}`;
}

/** Mã khoá cho tên lớp: bỏ ký tự lạ, thường hoá (`SATA_4` → `sata4`). */
export function classCourseToken(code: string | null | undefined, slug?: string | null): string {
  const raw = (code || slug || "").trim();
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface BuildClassDisplayNameInput {
  /** Course.code (ưu tiên) */
  courseCode?: string | null;
  /** Course.slug (dự phòng khi chưa có code) */
  courseSlug?: string | null;
  /** 0=CN … 6=T7 */
  scheduleDays: number[];
  /** Giờ bắt đầu "HH:mm" chung cả tuần (dùng khi lớp KHÔNG có slot riêng theo thứ). */
  startTime?: string | null;
  /**
   * BGĐ 31/07 — giờ RIÊNG theo từng thứ (lớp 2 ca khác giờ). Có phần tử thì THẮNG
   * `startTime` chung → tên ra đúng dạng `sata4.17h30-T2&08h-T6.P302`.
   */
  slots?: { weekday: number; startTime: string }[] | null;
  /** Room.code, vd "P302" */
  roomCode?: string | null;
}

/**
 * Gợi ý tên lớp theo convention. Thiếu dữ liệu thì BỎ đoạn đó (không chèn dấu chấm
 * thừa); thiếu hết → chuỗi rỗng (form giữ tên người dùng tự nhập).
 */
export function buildClassDisplayName(input: BuildClassDisplayNameInput): string {
  const parts: string[] = [];

  const course = classCourseToken(input.courseCode, input.courseSlug);
  if (course) parts.push(course);

  // Giờ theo từng thứ: ưu tiên slot riêng, lùi về giờ chung.
  const slotTime = new Map<number, string>();
  for (const s of input.slots ?? []) {
    if (Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6 && s.startTime) {
      if (!slotTime.has(s.weekday)) slotTime.set(s.weekday, s.startTime);
    }
  }
  const commonTime = formatClassTimeToken(input.startTime);

  // Tập thứ: scheduleDays là nguồn chính (đặt giờ riêng cho 1 thứ KHÔNG làm mất
  // các thứ còn lại); chưa chọn thứ nào thì suy từ slot.
  const declared = [...new Set(input.scheduleDays)].filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6,
  );
  const days = (declared.length > 0 ? declared : [...slotTime.keys()])
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    // T2..T7 trước, CN cuối (đọc theo tuần học thay vì 0..6).
    .sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b));

  if (days.length > 0) {
    const token = days
      .map((d) => {
        const time = formatClassTimeToken(slotTime.get(d)) ?? commonTime;
        return time ? `${time}-${WEEKDAY_LABEL[d]}` : WEEKDAY_LABEL[d];
      })
      .join("&");
    parts.push(token);
  }

  const room = (input.roomCode ?? "").trim().replace(/\s+/g, "");
  if (room) parts.push(room);

  return parts.join(".");
}
