// lib/lead/stale-lead.ts — C-05: ĐỒNG HỒ "chưa tiếp cận lại" + hai ngưỡng cảnh báo.
//
// Nối hai thứ đã có, KHÔNG dựng lại cái nào:
//   • `lib/lead/activity-clock.ts` trả MỐC tiếp cận gần nhất (`lastLeadOutreachAt`);
//   • file này biến mốc đó thành SỐ NGÀY + mức cảnh báo mà bảng C-05 vẽ ra.
//
// ⚠️ Module THUẦN — không `server-only`, không Prisma, không zod. Cùng lý do đã tách
// `activity-clock.ts` và `lost-status-labels.ts`: nó được dùng ở cả tầng đọc DB lẫn tầng
// vẽ, kéo Prisma/zod vào là biến mọi test dùng nó thành test cần DB (và kéo zod xuống
// trình duyệt cho đúng hai bảng chữ). Đường đọc CẤU HÌNH nằm ở `stale-lead-config.ts`.
//
// ┌─ Vì sao "chưa tiếp cận lần nào" KHÔNG được quy về 0 ngày ─────────────────────────┐
// │ `lastLeadOutreachAt` cố ý trả `null` khi chưa có lần chạm nào, và cố ý KHÔNG tự    │
// │ rơi về `Lead.createdAt` — quy ước đó thuộc về chỗ hiển thị, tức là ĐÂY. Quy null   │
// │ thành 0 là làm cho phiếu bị bỏ quên lâu nhất hiện màu xanh: đúng cái "làm đẹp giả" │
// │ mà spec cảnh báo ở dòng 54. Ở đây null ⇒ đếm từ lúc phiếu VÀO HỆ THỐNG, kèm cờ     │
// │ `fromCreatedAt` để màn hình nói thẳng "chưa tiếp cận lần nào".                     │
// └───────────────────────────────────────────────────────────────────────────────────┘

/**
 * Ngưỡng VÀNG — quyết định 12(a) của chủ dự án, chốt 24/08/2026: lead treo ≥ 2 ngày.
 *
 * Đây là DEFAULT của khoá cấu hình `crm.staleLeadWarnDays` (registry, `centerOverridable`)
 * — hai chỗ phải bằng nhau, và `lib/settings/registry.test.ts` ghim điều đó.
 */
export const STALE_LEAD_WARN_DAYS = 2;

/** Ngưỡng ĐỎ — cùng quyết định 12(a): ≥ 7 ngày. Default của `crm.staleLeadDangerDays`. */
export const STALE_LEAD_DANGER_DAYS = 7;

export type StaleLeadThresholds = {
  /** Số ngày chưa tiếp cận bắt đầu cảnh báo vàng. */
  warnDays: number;
  /** Số ngày chưa tiếp cận bắt đầu cảnh báo đỏ. */
  dangerDays: number;
};

export const DEFAULT_STALE_LEAD_THRESHOLDS: StaleLeadThresholds = {
  warnDays: STALE_LEAD_WARN_DAYS,
  dangerDays: STALE_LEAD_DANGER_DAYS,
};

export type StaleLevel = "OK" | "WARN" | "DANGER";

/**
 * Số ngày TRÒN đã trôi qua giữa hai mốc — đúng nghĩa đen của spec C-05 ("now − lần gần
 * nhất"), KHÔNG phải hiệu số ngày lịch.
 *
 * Chọn "thời lượng đã trôi" thay vì "ngày lịch VN" là có chủ ý: hiệu ngày lịch làm một
 * cuộc gọi lúc 23h tối qua trở thành "1 ngày chưa tiếp cận" ngay 8h sáng nay, nên ngưỡng
 * vàng sẽ nổ sớm hơn thực tế gần một ngày và người dùng mất tin vào cột này.
 *
 * Mốc ở TƯƠNG LAI (đồng hồ máy lệch, dữ liệu nhập tay) → 0, không bao giờ ra số âm.
 */
export function daysSince(moc: Date, now: Date): number {
  const ms = now.getTime() - moc.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}

/**
 * Mức cảnh báo của một số ngày chưa tiếp cận. Ngưỡng là **≥**, không phải **>** — "vàng
 * 2 ngày" nghĩa là ngày thứ 2 đã vàng.
 *
 * Xét ĐỎ trước VÀNG: ai đó đặt cấu hình ngược (đỏ < vàng) thì kết quả nghiêng về ĐỎ chứ
 * không rơi xuống "bình thường". Cảnh báo thừa thì người ta bỏ qua; cảnh báo THIẾU thì
 * lead nằm chết mà không ai biết.
 */
export function staleLevel(
  days: number,
  thresholds: StaleLeadThresholds = DEFAULT_STALE_LEAD_THRESHOLDS,
): StaleLevel {
  if (days >= thresholds.dangerDays) return "DANGER";
  if (days >= thresholds.warnDays) return "WARN";
  return "OK";
}

export type OutreachClock = {
  /** Mốc tiếp cận gần nhất; `null` = chưa chạm khách lần nào. */
  lastOutreachAt: Date | null;
  /** Số ngày chưa tiếp cận lại (cột C-05). */
  days: number;
  /** true = `days` đếm từ lúc phiếu VÀO HỆ THỐNG vì chưa có lần tiếp cận nào. */
  fromCreatedAt: boolean;
  level: StaleLevel;
};

/**
 * Gộp mốc tiếp cận + mốc tạo phiếu thành đúng thứ một dòng bảng C-05 cần.
 *
 * @param lastOutreachAt kết quả của `lastLeadOutreachAt(...)` (`lib/lead/activity-clock.ts`).
 */
export function buildOutreachClock(args: {
  lastOutreachAt: Date | null;
  createdAt: Date;
  now: Date;
  thresholds?: StaleLeadThresholds;
}): OutreachClock {
  const moc = args.lastOutreachAt ?? args.createdAt;
  const days = daysSince(moc, args.now);
  return {
    lastOutreachAt: args.lastOutreachAt,
    days,
    fromCreatedAt: args.lastOutreachAt === null,
    level: staleLevel(days, args.thresholds ?? DEFAULT_STALE_LEAD_THRESHOLDS),
  };
}

/** Nhãn tiếng Việt của mức cảnh báo — dùng cho `title`/aria, không chỉ cho màu. */
export const STALE_LEVEL_LABEL: Record<StaleLevel, string> = {
  OK: "Trong hạn chăm sóc",
  WARN: "Chậm tiếp cận",
  DANGER: "Bỏ quên lâu",
};

/**
 * Màu chip theo mức. Để cạnh nhãn (không rải class trong JSX) vì đây là cùng MỘT quyết
 * định hiển thị; tách ra là hai chỗ trôi lệch.
 */
export const STALE_LEVEL_BADGE: Record<StaleLevel, string> = {
  OK: "bg-muted text-muted-foreground",
  WARN: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  DANGER: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200",
};
