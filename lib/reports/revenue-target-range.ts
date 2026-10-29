// lib/reports/revenue-target-range.ts — B-02 · Mục tiêu doanh thu của MỘT KHOẢNG NGÀY.
//
// Phần THUẦN: không `server-only`, không Prisma — Vitest chạy được không cần Postgres
// (cùng khuôn `lib/reports/revenue-daily.ts` và `revenue-target-scope.ts`). Đường chạm
// DB nằm ở `lib/reports/revenue-target-data.ts` (`getRevenueTargetsForRange`).
//
// ┌─ Vì sao KHÔNG dùng lại `buildRevenueTargetReport` ────────────────────────────────┐
// │ `lib/reports/revenue-target.ts:65` gom mục tiêu bằng                              │
// │     `for (const t of targets) targetByPeriod.set(t.period, t.targetAmount)`        │
// │ tức GÁN ĐÈ, không cộng. Đúng cho chỗ nó sinh ra (`/bao-cao/doanh-thu` lọc đúng     │
// │ MỘT `centerId` ⇒ mỗi kỳ nhiều nhất một dòng), nhưng dashboard QLCS cho chọn N cơ   │
// │ sở cùng lúc: CS1 đặt 30tr + CS2 đặt 20tr cho tháng 8 thì dòng sau ĐÈ dòng trước,   │
// │ "mục tiêu" ra 20tr và tỷ lệ hoàn thành phồng gấp 2,5 lần — im lặng, không lỗi.     │
// │ Hàm này CỘNG, và cộng theo đúng ba luật phạm vi bên dưới.                          │
// │ ⚠️ Lỗi đè đó VẪN CÒN trên `manager-dashboard.tsx:125` (nó nạp mục tiêu nhiều cơ    │
// │ sở qua `getRevenueTargets` rồi đưa vào đúng hàm gán đè) — việc khác, không sửa ở   │
// │ đây để không đổi im lặng con số của một màn ngoài phạm vi B-02.                    │
// └──────────────────────────────────────────────────────────────────────────────────┘
//
// ┌─ Ba luật phạm vi (§B.6.6 PRD CDB-dashboard) ──────────────────────────────────────┐
// │ 1. Chọn N cơ sở cụ thể  → CHỈ dòng của N cơ sở đó, CỘNG lại. Không lấy dòng        │
// │    `centerId = NULL` (mục tiêu công ty) — nó không phải mục tiêu của N cơ sở.      │
// │ 2. Xem toàn hệ thống + kỳ đó CÓ dòng công ty → CHỈ dòng công ty. Cộng thêm mục     │
// │    tiêu từng cơ sở là ĐẾM ĐÔI: `@@unique([centerId, period])` với `centerId`       │
// │    nullable cho phép hai loại dòng cùng tồn tại cho cùng một kỳ.                   │
// │ 3. Xem toàn hệ thống + kỳ đó KHÔNG có dòng công ty → CỘNG mục tiêu các cơ sở.      │
// │    (Đây là phần VÁ LỖI: đường cũ `getRevenueTargets` lấy cứng `centerId: null` khi │
// │    actor cấp hội sở ⇒ cơ sở đặt mục tiêu đủ cả mà màn của hội sở vẫn "chưa đặt".)  │
// │ Luật 2 và 3 quyết định theo TỪNG KỲ, không quyết một lần cho cả khoảng.            │
// └──────────────────────────────────────────────────────────────────────────────────┘
//
// ┌─ Mục tiêu KHÔNG BAO GIỜ bị chia theo số ngày ─────────────────────────────────────┐
// │ `RevenueTarget` là con số CAM KẾT cho TRỌN một tháng. Khoảng 15/08 → 10/09 chạm    │
// │ hai tháng ⇒ mục tiêu ở đây là mục tiêu trọn tháng 8 CỘNG trọn tháng 9. Tự nhân     │
// │ 27/61 rồi in ra ô "Mục tiêu" là bịa một con số chưa ai cam kết, và người đọc không │
// │ có cách nào biết. Phần so sánh công bằng nằm ở `progressRate` — một con số RIÊNG,  │
// │ nhãn riêng, và màn hình phải nói ra cách tính (AC của B-02).                       │
// └──────────────────────────────────────────────────────────────────────────────────┘
import type { RevenueTargetRow } from "@/lib/reports/revenue-target";

export type { RevenueTargetRow };

/**
 * Chốt chặn vòng lặp khi duyệt tháng. KHÔNG phải giới hạn nghiệp vụ: bộ lọc A-02 đã kẹp
 * cận trên về hôm nay và `trimDayRange` (B-04) cắt khoảng về ≤ 366 ngày ⇒ tối đa 13
 * tháng trên đường chạy thật. Hằng này chỉ để một chuỗi rác lọt vào không biến thành
 * vòng lặp vô hạn ngay trên server.
 */
export const TARGET_MONTH_LOOP_GUARD = 400;

/** "YYYY-MM-DD" → số thứ tự ngày (UTC). Chỉ dùng để ĐẾM ngày lịch, không so giờ. */
function dayIndex(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

/** Số ngày của một kỳ "YYYY-MM" (tự đúng năm nhuận qua ngày 0 của tháng kế). */
export function daysInMonth(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

/** "2026-08" → "2026-09"; qua tháng 12 thì sang năm mới. */
function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const ny = m! === 12 ? y! + 1 : y!;
  const nm = m! === 12 ? 1 : m! + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** "2026-08" → "08/2026" — nhãn kỳ cho người đọc. */
export function formatPeriodVN(period: string): string {
  const [y, m] = period.split("-");
  return `${m}/${y}`;
}

/**
 * Mọi kỳ (tháng VN) mà khoảng ngày CHẠM tới, kể cả chỉ chạm một ngày.
 *
 * So sánh chuỗi là đủ và đúng với dạng `YYYY-MM` / `YYYY-MM-DD` (thứ tự từ điển = thứ
 * tự thời gian). Khoảng đảo ngược trả RỖNG chứ không lặp — bộ lọc A-02 đã hoán đổi
 * từ/đến trước khi tới đây, nhưng hàm thuần không được dựa vào thiện chí của chỗ gọi.
 */
export function monthKeysInRange(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  if (fromKey > toKey) return out;
  const end = toKey.slice(0, 7);
  for (let p = fromKey.slice(0, 7); p <= end; p = nextPeriod(p)) {
    out.push(p);
    if (out.length >= TARGET_MONTH_LOOP_GUARD) break;
  }
  return out;
}

/** Số ngày của kỳ `period` thực sự nằm trong khoảng. 0 khi không chạm. */
export function daysOfMonthInRange(period: string, fromKey: string, toKey: string): number {
  const first = `${period}-01`;
  const last = `${period}-${String(daysInMonth(period)).padStart(2, "0")}`;
  const lo = fromKey > first ? fromKey : first;
  const hi = toKey < last ? toKey : last;
  if (lo > hi) return 0;
  return dayIndex(hi) - dayIndex(lo) + 1;
}

/**
 * Chế độ lấy mục tiêu.
 * - `CENTERS` — cộng mục tiêu của đúng `centerIds`, KHÔNG đụng dòng toàn hệ thống.
 * - `SYSTEM`  — người xem đang nhìn TOÀN hệ thống: ưu tiên dòng toàn hệ thống của từng
 *   kỳ, kỳ nào không có thì cộng mục tiêu các cơ sở.
 */
export type TargetScopeMode =
  | { kind: "CENTERS"; centerIds: readonly string[] }
  | { kind: "SYSTEM"; centerIds: readonly string[] };

/**
 * Chọn chế độ từ bộ lọc + tư cách của người xem.
 *
 * ⚠️ `isAllCenters` MỘT MÌNH là chưa đủ. Với quản lý cơ sở giữ 2 cơ sở, "tất cả" nghĩa
 * là "cả 2 cơ sở của tôi", không phải "cả công ty" — lấy dòng `centerId = NULL` cho họ
 * là đem mục tiêu của TOÀN hệ thống làm mẫu số cho doanh thu 2 cơ sở, tỷ lệ hoàn thành
 * tụt xuống vô nghĩa. Chỉ người ĐẶT được mục tiêu toàn hệ thống (`checkRevenueTargetScope`
 * — hội sở/quản trị) mới được đọc nó ở đây, và chỉ khi họ chưa thu hẹp phạm vi.
 */
export function targetScopeMode(args: {
  isAllCenters: boolean;
  isGlobalAllowed: boolean;
  centerIds: readonly string[];
}): TargetScopeMode {
  const kind = args.isAllCenters && args.isGlobalAllowed ? "SYSTEM" : "CENTERS";
  return { kind, centerIds: args.centerIds };
}

/** Mục tiêu đến từ đâu — để màn hình nói được, thay vì để người đọc đoán. */
export type TargetSource = "SYSTEM" | "CENTERS" | "NONE";

export type PeriodTarget = {
  /** "YYYY-MM". */
  period: string;
  /** Mục tiêu TRỌN tháng. `null` = kỳ này chưa ai đặt (KHÁC hẳn 0). */
  target: number | null;
  source: TargetSource;
  /** Số cơ sở đã góp vào con số trên (0 khi lấy dòng toàn hệ thống hoặc chưa đặt). */
  centerCount: number;
  /** Số ngày của tháng này nằm trong khoảng đang xem. */
  daysInRange: number;
  /** Tổng số ngày của tháng. */
  daysInMonth: number;
};

export type RangeTargetSummary = {
  periods: PeriodTarget[];
  /** Σ mục tiêu của các kỳ ĐÃ đặt. `null` khi KHÔNG kỳ nào được đặt. */
  totalTarget: number | null;
  periodsWithTarget: string[];
  periodsMissingTarget: string[];
  /** Mọi kỳ chạm khoảng đều đã có mục tiêu. */
  fullyTargeted: boolean;
  /** Khoảng KHÔNG trùng biên tháng (ít nhất một tháng bị cắt). */
  partialMonths: boolean;
  /** Σ ngày thực nằm trong khoảng. */
  daysInRange: number;
  /** Σ ngày của MỌI tháng chạm khoảng — mẫu số của tiến độ. */
  daysInMonths: number;
  /** `daysInRange / daysInMonths` ∈ (0, 1]. Phần thời gian đã được tính. */
  coverage: number;
  /**
   * Số cơ sở KHÁC NHAU đã góp vào con số mục tiêu (đếm trên cả khoảng, không phải max
   * theo kỳ). Đây là thứ màn hình dùng để tự khai "cộng mục tiêu của N cơ sở" — đúng
   * chỗ từng sai, nên con số phải nói ra nguồn gốc của chính nó.
   */
  contributingCenters: number;
  /** Có ít nhất một kỳ lấy dòng mục tiêu TOÀN HỆ THỐNG. */
  usesSystemTarget: boolean;
};

/** THUẦN — gom mục tiêu của mọi kỳ chạm khoảng theo đúng ba luật phạm vi ở đầu tệp. */
export function buildRangeTarget(
  rows: readonly RevenueTargetRow[],
  opts: { fromKey: string; toKey: string; mode: TargetScopeMode },
): RangeTargetSummary {
  const chon = new Set(opts.mode.centerIds);
  const daGop = new Set<string>();
  const periods = monthKeysInRange(opts.fromKey, opts.toKey).map((period): PeriodTarget => {
    const cungKy = rows.filter((r) => r.period === period);
    const dongToanHe = cungKy.filter((r) => r.centerId === null);
    // Lọc theo `centerIds` ở CẢ HAI chế độ: dòng của cơ sở ngoài phạm vi đang chọn
    // không bao giờ được cộng vào, kể cả khi người xem là hội sở.
    const dongCoSo = cungKy.filter((r) => r.centerId !== null && chon.has(r.centerId));

    const daysInRangeOfMonth = daysOfMonthInRange(period, opts.fromKey, opts.toKey);
    const base = { period, daysInRange: daysInRangeOfMonth, daysInMonth: daysInMonth(period) };

    if (opts.mode.kind === "SYSTEM" && dongToanHe.length > 0) {
      const target = dongToanHe.reduce((s, r) => s + r.targetAmount, 0);
      return { ...base, target, source: "SYSTEM", centerCount: 0 };
    }
    if (dongCoSo.length > 0) {
      const target = dongCoSo.reduce((s, r) => s + r.targetAmount, 0);
      for (const r of dongCoSo) daGop.add(r.centerId!);
      const centerCount = new Set(dongCoSo.map((r) => r.centerId)).size;
      return { ...base, target, source: "CENTERS", centerCount };
    }
    return { ...base, target: null, source: "NONE", centerCount: 0 };
  });

  const daT = periods.filter((p) => p.target !== null);
  const daysInRange = periods.reduce((s, p) => s + p.daysInRange, 0);
  const daysInMonths = periods.reduce((s, p) => s + p.daysInMonth, 0);

  return {
    periods,
    // `null` chứ không phải 0 khi chưa kỳ nào đặt — 0 đọc thành "mục tiêu bằng không".
    totalTarget: daT.length > 0 ? daT.reduce((s, p) => s + (p.target ?? 0), 0) : null,
    periodsWithTarget: daT.map((p) => p.period),
    periodsMissingTarget: periods.filter((p) => p.target === null).map((p) => p.period),
    fullyTargeted: periods.length > 0 && daT.length === periods.length,
    partialMonths: periods.some((p) => p.daysInRange < p.daysInMonth),
    daysInRange,
    daysInMonths,
    coverage: daysInMonths > 0 ? daysInRange / daysInMonths : 0,
    contributingCenters: daGop.size,
    usesSystemTarget: periods.some((p) => p.source === "SYSTEM"),
  };
}

/**
 * Vì sao KHÔNG có tỷ lệ hoàn thành. Mỗi giá trị là một câu phải nói ra màn hình — để
 * trống mà không giải thích thì người đọc kết luận "hệ thống hỏng".
 * - `CHUA_DAT`             — chưa kỳ nào trong khoảng được đặt mục tiêu.
 * - `THIEU_THANG`          — có kỳ đã đặt, có kỳ chưa. Chia ra là so doanh thu CẢ khoảng
 *                            với mục tiêu của một phần khoảng ⇒ tỷ lệ CAO GIẢ.
 * - `MUC_TIEU_KHONG_DUONG` — tổng mục tiêu ≤ 0, phép chia vô nghĩa.
 */
export type TargetRateBlocked = "CHUA_DAT" | "THIEU_THANG" | "MUC_TIEU_KHONG_DUONG";

export type RevenueTargetCard = {
  /** Mục tiêu TRỌN THÁNG cộng lại. `null` = chưa đặt. */
  totalTarget: number | null;
  /** Doanh thu thực thu của khoảng (do chỗ gọi truyền vào — cùng nguồn với B-04). */
  actual: number;
  /** `actual / totalTarget`. `null` khi `rateBlocked` khác null. */
  achievedRate: number | null;
  rateBlocked: TargetRateBlocked | null;
  /**
   * Tỷ lệ hoàn thành SO VỚI TIẾN ĐỘ thời gian = `achievedRate / coverage`. Chỉ có khi
   * khoảng bị cắt ngang tháng. Đây là con số RIÊNG, phải hiện kèm nhãn riêng — nó không
   * bao giờ được thay chỗ của tỷ lệ thô.
   */
  progressRate: number | null;
  summary: RangeTargetSummary;
};

/** THUẦN — dựng đúng ba con số của hàng chỉ số 1 (B-02), kèm lý do khi không chia được. */
export function buildRevenueTargetCard(
  summary: RangeTargetSummary,
  actual: number,
): RevenueTargetCard {
  const base = { totalTarget: summary.totalTarget, actual, summary };

  if (summary.totalTarget === null) {
    return { ...base, achievedRate: null, rateBlocked: "CHUA_DAT", progressRate: null };
  }
  if (!summary.fullyTargeted) {
    return { ...base, achievedRate: null, rateBlocked: "THIEU_THANG", progressRate: null };
  }
  if (summary.totalTarget <= 0) {
    return {
      ...base,
      achievedRate: null,
      rateBlocked: "MUC_TIEU_KHONG_DUONG",
      progressRate: null,
    };
  }

  const achievedRate = actual / summary.totalTarget;
  const progressRate =
    summary.coverage > 0 && summary.coverage < 1 ? achievedRate / summary.coverage : null;
  return { ...base, achievedRate, rateBlocked: null, progressRate };
}
