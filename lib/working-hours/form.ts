// lib/working-hours/form.ts — lớp THUẦN giữa màn quản trị giờ làm việc và DB (Q-C, 19/08/2026).
//
// Vì sao tách khỏi `_actions.ts`: phần dễ sai nhất của màn này KHÔNG phải truy vấn mà là
// bốn phép chuyển đổi dưới đây (kế thừa ↔ khai riêng, "" ↔ null, sao chép giờ sang ngày
// khác, thứ tự hiển thị Thứ Hai-trước). Để chúng ở file thuần thì Vitest chạy được mà
// không cần Postgres, cũng không cần dựng session giả.
//
// KHÔNG import Prisma, KHÔNG "server-only" — file này còn được component client đọc kiểu.

import { z } from "zod";
import {
  WEEKDAY_LABELS_VN,
  formatHhMm,
  parseHhMm,
  type WorkingHourDay,
  type WorkingHourRuleRow,
  type WorkingHourWeek,
} from "./rules";

/**
 * Thứ tự HIỂN THỊ trên bảng: Thứ Hai → Chủ nhật (cách người Việt đọc lịch).
 *
 * Cố ý KHÁC thứ tự chỉ số 0=CN…6=T7 của `Date.getDay()` mà cả engine lẫn cột
 * `WorkingHourRule.weekday` dùng. Đổi chỉ số cho "thuận mắt" là cách chắc chắn nhất để
 * lệch một ngày giữa màn hình và dữ liệu; ở đây chỉ đổi THỨ TỰ DUYỆT, chỉ số giữ nguyên.
 */
export const WEEKDAY_DISPLAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/** Một dòng trên bảng 7 thứ của màn quản trị. */
export type WorkingHourDayForm = {
  /** 0=CN … 6=T7 — cùng chỉ số với DB và engine. */
  weekday: number;
  /**
   * `false` = đang KẾ THỪA từ bậc trên (chưa có dòng riêng cho cặp đơn vị×vai này);
   * `true` = có dòng khai riêng. Đây là thứ phân biệt "chưa khai" với "khai trùng giá
   * trị" — hai trạng thái nhìn giống hệt nhau trên màn hình nếu không có cờ này.
   */
  declared: boolean;
  isClosed: boolean;
  /** "HH:mm"; rỗng khi nghỉ cả ngày. */
  openTime: string;
  closeTime: string;
  /** Giá trị của BẬC TRÊN, luôn hiện để người dùng so được với thứ mình đang khai. */
  inheritedLabel: string;
};

/** Mô tả một ngày bằng tiếng Việt cho phần "bậc trên đang là gì". */
export function describeDay(day: WorkingHourDay): string {
  if (day.isClosed) return "Nghỉ cả ngày";
  const open = formatHhMm(day.openMinute);
  const close = formatHhMm(day.closeMinute);
  return open && close ? `${open} – ${close}` : "Không xác định";
}

/**
 * Dựng 7 dòng của bảng từ (dòng khai riêng đã có) + (bảng tuần kế thừa từ bậc trên).
 *
 * Mảng trả về xếp theo CHỈ SỐ THỨ (index 0 = Chủ nhật) chứ không theo thứ tự hiển thị —
 * chỗ nào cần Thứ-Hai-trước thì duyệt qua `WEEKDAY_DISPLAY_ORDER`. Trộn hai thứ tự này
 * trong cùng một mảng là nguồn lỗi lệch ngày kinh điển.
 */
export function buildFormDays(
  ownRows: readonly WorkingHourRuleRow[],
  inheritedWeek: WorkingHourWeek,
): WorkingHourDayForm[] {
  const byWeekday = new Map<number, WorkingHourRuleRow>();
  for (const row of ownRows) byWeekday.set(row.weekday, row);

  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const inheritedLabel = describeDay(inheritedWeek[weekday]);
    const own = byWeekday.get(weekday);
    if (!own) {
      // Chưa khai riêng → hiện đúng giá trị đang có hiệu lực, nhưng gắn cờ kế thừa.
      const day = inheritedWeek[weekday];
      return {
        weekday,
        declared: false,
        isClosed: day.isClosed,
        openTime: day.isClosed ? "" : (formatHhMm(day.openMinute) ?? ""),
        closeTime: day.isClosed ? "" : (formatHhMm(day.closeMinute) ?? ""),
        inheritedLabel,
      };
    }
    return {
      weekday,
      declared: true,
      isClosed: own.isClosed,
      openTime: own.isClosed ? "" : (own.openTime ?? ""),
      closeTime: own.isClosed ? "" : (own.closeTime ?? ""),
      inheritedLabel,
    };
  });
}

/**
 * Nút "Áp dụng cho các ngày còn lại": chép GIỜ MỞ/ĐÓNG của `sourceWeekday` sang 6 thứ kia.
 *
 * CỐ Ý KHÔNG chép công tắc "Nghỉ cả ngày". Sata Robo nghỉ Thứ Hai và mở T3–CN: nếu nút
 * này chép luôn trạng thái nghỉ thì thao tác thường gặp nhất ("đổi giờ đóng cửa cho cả
 * tuần") sẽ âm thầm MỞ CỬA Thứ Hai — hỏng nghiệp vụ mà người bấm không hề thấy. Ngày
 * đang đặt nghỉ giữ nguyên là nghỉ; chỉ ngày đang mở mới nhận giờ mới.
 *
 * Mọi ngày bị chép đều chuyển sang `declared: true`: đã đặt tay thì không còn là kế thừa.
 */
export function applyHoursToOtherDays(
  days: readonly WorkingHourDayForm[],
  sourceWeekday: number,
): WorkingHourDayForm[] {
  const source = days.find((d) => d.weekday === sourceWeekday);
  if (!source || source.isClosed) return [...days];
  return days.map((d) => {
    if (d.weekday === sourceWeekday || d.isClosed) return d;
    return { ...d, declared: true, openTime: source.openTime, closeTime: source.closeTime };
  });
}

// ─── Zod: dữ liệu form gửi lên Server Action ────────────────────────────────────

const dayInputSchema = z
  .object({
    weekday: z.number().int().min(0, "Thứ không hợp lệ").max(6, "Thứ không hợp lệ"),
    isClosed: z.boolean(),
    openTime: z.string().trim(),
    closeTime: z.string().trim(),
  })
  .superRefine((day, ctx) => {
    const label = WEEKDAY_LABELS_VN[day.weekday];
    if (day.isClosed) {
      // Nghỉ mà vẫn còn giờ = dữ liệu tự mâu thuẫn. Chặn ở đây thay vì "im lặng bỏ giờ
      // đi": nếu người dùng gõ giờ rồi mới bật công tắc, họ cần biết giờ đó bị bỏ.
      if (day.openTime !== "" || day.closeTime !== "") {
        ctx.addIssue({
          code: "custom",
          path: ["openTime"],
          message: `${label}: đã chọn "Nghỉ cả ngày" thì phải bỏ trống giờ mở/đóng`,
        });
      }
      return;
    }
    const open = parseHhMm(day.openTime);
    const close = parseHhMm(day.closeTime);
    if (open === null) {
      ctx.addIssue({
        code: "custom",
        path: ["openTime"],
        message: `${label}: giờ mở cửa phải dạng HH:mm (ví dụ 07:45)`,
      });
    }
    if (close === null) {
      ctx.addIssue({
        code: "custom",
        path: ["closeTime"],
        message: `${label}: giờ đóng cửa phải dạng HH:mm (ví dụ 21:00)`,
      });
    }
    // Engine coi cửa sổ `close <= open` là DÒNG HỎNG và bỏ qua (rơi xuống bậc dưới) —
    // tức khai sai ở đây không báo lỗi lúc chạy, chỉ lặng lẽ dùng giờ của bậc trên.
    // Chặn ngay lúc nhập là chỗ DUY NHẤT người dùng còn thấy được cái sai.
    if (open !== null && close !== null && close <= open) {
      ctx.addIssue({
        code: "custom",
        path: ["closeTime"],
        message: `${label}: giờ mở cửa phải sớm hơn giờ đóng cửa`,
      });
    }
  });

export const workingHourFormSchema = z
  .object({
    /** Center.id — Server Action tự đổi sang OrgUnit.id, client KHÔNG tự đoán. */
    centerId: z.string().trim().min(1, "Thiếu mã cơ sở"),
    /** RoleDef.code, hoặc "*" = áp cho mọi vai. */
    roleCode: z.string().trim().min(1, "Thiếu mã vai trò"),
    /**
     * CHỈ những thứ được KHAI RIÊNG. Thứ vắng mặt = trả về kế thừa (Server Action xoá
     * dòng tương ứng). Nhờ vậy "bỏ khai riêng" không cần thêm một action thứ hai.
     */
    days: z.array(dayInputSchema).max(7, "Một tuần chỉ có 7 thứ"),
  })
  .superRefine((form, ctx) => {
    const seen = new Set<number>();
    for (const day of form.days) {
      if (seen.has(day.weekday)) {
        ctx.addIssue({
          code: "custom",
          path: ["days"],
          message: `${WEEKDAY_LABELS_VN[day.weekday]}: bị khai hai lần`,
        });
      }
      seen.add(day.weekday);
    }
  });

export type WorkingHourFormInput = z.infer<typeof workingHourFormSchema>;

/** Thông điệp lỗi ĐẦU TIÊN của Zod, để Server Action trả một chuỗi tiếng Việt cho toast. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dữ liệu không hợp lệ";
}

/**
 * Form đã hợp lệ → các dòng sẵn sàng ghi `WorkingHourRule`.
 *
 * Ngày nghỉ ghi `null` chứ không phải `""`: cột còn giữ giờ của lần khai trước sẽ đánh
 * lừa mọi người đọc thẳng DB (và cả chính màn này nếu sau đó công tắc nghỉ bị tắt).
 */
export function toRuleRows(
  orgUnitId: string,
  form: WorkingHourFormInput,
): WorkingHourRuleRow[] {
  return form.days.map((day) => ({
    orgUnitId,
    roleCode: form.roleCode,
    weekday: day.weekday,
    openTime: day.isClosed ? null : day.openTime,
    closeTime: day.isClosed ? null : day.closeTime,
    isClosed: day.isClosed,
  }));
}

/** Các thứ KHÔNG được khai riêng ⇒ dòng cũ (nếu có) phải bị xoá để quay về kế thừa. */
export function weekdaysToClear(form: WorkingHourFormInput): number[] {
  const declared = new Set(form.days.map((d) => d.weekday));
  return [0, 1, 2, 3, 4, 5, 6].filter((weekday) => !declared.has(weekday));
}

/** Dòng bảng → payload gửi lên action (bỏ ngày đang kế thừa, bỏ giờ của ngày nghỉ). */
export function daysToPayload(
  days: readonly WorkingHourDayForm[],
): WorkingHourFormInput["days"] {
  return days
    .filter((d) => d.declared)
    .map((d) => ({
      weekday: d.weekday,
      isClosed: d.isClosed,
      openTime: d.isClosed ? "" : d.openTime,
      closeTime: d.isClosed ? "" : d.closeTime,
    }));
}
