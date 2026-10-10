// lib/reports/revenue-daily.ts — B-04 · doanh thu chi tiết theo NGÀY.
//
// Trước bản này KHÔNG có trục ngày ở đâu cả: mọi phép gom tiền trong repo đều theo
// THÁNG (`monthKeyVN`). Hệ quả là QLCS không nhìn được hình dạng dòng tiền trong kỳ —
// một tháng "đạt mục tiêu" nhờ đúng hai ngày lớn trông y hệt một tháng chảy đều.
//
// ┌─ Ba luật không được phá ────────────────────────────────────────────────────────┐
// │ 1. MỘT công thức thực thu. Hàm này KHÔNG tự cộng tiền — nó gọi `butToanThucThu` │
// │    (`lib/finance/thuc-thu.ts`, chốt B3 24/08) và dùng `WHERE_THUC_THU` cho truy │
// │    vấn. Viết công thức thứ hai ở đây là tab Tài chính lệch chính nó ở màn khác. │
// │ 2. NGÀY TRỐNG RA 0, KHÔNG rụng dòng. Biểu đồ bỏ ngày là biểu đồ nói dối về hình │
// │    dạng: đường nối thẳng qua Chủ nhật trông như doanh thu chảy đều.             │
// │ 3. "Ngày" là ngày lịch GIỜ VIỆT NAM (`vnDayKey`, UTC+7 không DST). Gom theo     │
// │    ngày UTC thì toàn bộ giao dịch 00:00–07:00 giờ VN rơi về hôm trước.          │
// └────────────────────────────────────────────────────────────────────────────────┘
//
// Bút toán hoàn (`REFUNDED`) mang số ÂM và `paidDate` là NGÀY HOÀN, không phải ngày thu
// gốc ⇒ một ngày có thể ra doanh thu ÂM. Đó là đúng theo định nghĩa thuần, nên biểu đồ
// phải chịu được giá trị âm (trục Y không neo 0).
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import {
  WHERE_THUC_THU,
  butToanThucThu,
  type ThucThuButToan,
} from "@/lib/finance/thuc-thu";
import { shiftDayKey, vnDayKey, vnDayStartUtc } from "@/lib/students/birthday-dates";
import type { ScopeFilters } from "@/lib/reports/scope-filters";

/**
 * Trần số NGÀY được vẽ. Cận trên của bộ lọc A-02 đã kẹp về hôm nay, nhưng cận DƯỚI thì
 * tự do: `?dateFrom=1900-01-01` gõ tay là ~46.000 dòng bảng + 46.000 điểm biểu đồ, đủ
 * treo trang ngay trên server.
 *
 * Cách chặn cố ý KHÔNG phải "gom sang tuần khi khoảng quá dài" (đề xuất trong PRD §B.6.5
 * bẫy B4): đổi đơn vị trục giữa chừng làm hai lần xem cùng một màn ra hai loại số. Ở đây
 * cắt bớt KHOẢNG (giữ phần gần nhất) và bắt màn hình NÓI RA là đã cắt — người xem thấy
 * mình đang nhìn cái gì, thay vì thấy một con số lạ không giải thích được.
 */
export const DAILY_REVENUE_MAX_DAYS = 366;

/**
 * Trần số bút toán đọc về. Vượt trần thì phần ĐUÔI (ngày gần nhất) thiếu số — quét theo
 * `paidDate` tăng dần nên chỗ bị cắt là xác định được, và `completeThroughDay` nói đúng
 * số liệu còn đủ tới ngày nào.
 */
export const DAILY_REVENUE_SCAN_MAX = 50_000;

/** Bút toán phẳng kèm ngày thu + cơ sở — đủ để gom theo ngày mà không đọc lại DB. */
export type DailyRevenueScanRow = ThucThuButToan & {
  centerId: string | null;
  paidDate: Date;
};

/** Một ngày trên trục. LUÔN có mặt, kể cả khi không phát sinh gì. */
export type DailyRevenuePoint = {
  /** "YYYY-MM-DD" theo giờ VN. */
  day: string;
  /** Thực thu thuần của ngày. CÓ THỂ ÂM (ngày hoàn tiền). */
  revenue: number;
  /** Số bút toán ĐƯỢC TÍNH của ngày (đã loại PENDING/REJECTED và bản gốc bị thay thế). */
  txnCount: number;
  /** `null` khi công tắc "Tách theo cơ sở" tắt. Bật thì có ô cho MỌI cơ sở đang chọn. */
  byCenter: Record<string, number> | null;
};

export type DailyRevenueReport = {
  points: DailyRevenuePoint[];
  /** Thứ tự cột khi tách theo cơ sở; rỗng khi gộp. */
  centerIds: string[];
  /**
   * Tổng thực thu của khoảng đang vẽ, lấy bằng `aggregate` (SQL cộng) ⇒ ĐÚNG kể cả khi
   * danh sách bút toán bị cắt ở trần quét. So với tổng các điểm để phát hiện lệch.
   */
  total: number;
  /** Khoảng ĐANG VẼ (đã cắt theo `DAILY_REVENUE_MAX_DAYS` nếu cần). */
  fromKey: string;
  toKey: string;
  /** true = khoảng người dùng chọn dài hơn trần, màn hình phải nói ra. */
  rangeTrimmed: boolean;
  /** true = vượt trần quét bút toán; các ngày cuối thiếu số. */
  truncated: boolean;
  /** Khi `truncated`: ngày cuối cùng còn đủ số liệu. `null` khi không cắt. */
  completeThroughDay: string | null;
};

/** THUẦN — mọi ngày lịch từ `fromKey` tới `toKey`, BAO GỒM cả hai đầu. */
export function dayKeysInRange(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  // So sánh chuỗi là đủ và đúng với dạng YYYY-MM-DD (thứ tự từ điển = thứ tự thời gian),
  // và tránh hẳn phép cộng 86.400.000ms — thứ sẽ lệch nếu sau này có múi giờ đổi giờ.
  for (let k = fromKey; k <= toKey; k = shiftDayKey(k, 1)) {
    out.push(k);
    // Chốt chặn cứng, KHÔNG chỉ dựa vào `trimDayRange` ở chỗ gọi: chuỗi rác lọt qua đây
    // sẽ thành vòng lặp vô hạn ngay trên server.
    if (out.length >= DAILY_REVENUE_MAX_DAYS) break;
  }
  return out;
}

/**
 * THUẦN — cắt khoảng về đúng trần, GIỮ phần gần hiện tại nhất.
 *
 * Cắt ở đầu chứ không ở cuối: người xem quan tâm những ngày vừa rồi, không phải năm 1900.
 */
export function trimDayRange(
  fromKey: string,
  toKey: string,
  maxDays: number = DAILY_REVENUE_MAX_DAYS,
): { fromKey: string; toKey: string; trimmed: boolean } {
  const somNhat = shiftDayKey(toKey, -(maxDays - 1));
  if (fromKey >= somNhat) return { fromKey, toKey, trimmed: false };
  return { fromKey: somNhat, toKey, trimmed: true };
}

/**
 * THUẦN — gom thực thu theo NGÀY VN, trả đủ mọi ngày trong khoảng.
 *
 * ⚠️ Thứ tự hai bước KHÔNG được đảo: lọc `butToanThucThu` chạy trên TOÀN mảng TRƯỚC khi
 * chia theo ngày. Chia trước rồi lọc sau thì một bản gốc bị điều chỉnh sang ngày khác sẽ
 * nằm một mình trong ngày của nó, không có bản ADJUSTED nào bên cạnh để loại nó ⇒ sống
 * sót ⇒ cộng đôi đúng khoản tiền vừa được sửa.
 */
export function buildDailyRevenue(
  rows: readonly DailyRevenueScanRow[],
  opts: {
    fromKey: string;
    toKey: string;
    centerIds: readonly string[];
    groupByCenter: boolean;
  },
): DailyRevenuePoint[] {
  const days = dayKeysInRange(opts.fromKey, opts.toKey);
  const khoi = new Map<string, DailyRevenuePoint>();
  for (const day of days) {
    khoi.set(day, {
      day,
      revenue: 0,
      txnCount: 0,
      // Cơ sở không phát sinh vẫn có ô 0: bảng nhảy số cột theo dữ liệu là cách nhanh
      // nhất để người xem tưởng cơ sở đó "không được tính".
      byCenter: opts.groupByCenter
        ? Object.fromEntries(opts.centerIds.map((id) => [id, 0]))
        : null,
    });
  }

  const chon = new Set(opts.centerIds);
  for (const r of butToanThucThu([...rows])) {
    const diem = khoi.get(vnDayKey(r.paidDate));
    if (!diem) continue; // ngoài khoảng đang vẽ
    diem.revenue += r.amount;
    diem.txnCount += 1;
    // Cơ sở lạ vẫn vào tổng ngày (tiền là có thật) nhưng KHÔNG sinh cột mới — truy vấn
    // đã lọc `centerId IN centerIds` nên ca này không xảy ra trên đường chạy thật.
    if (diem.byCenter && r.centerId && chon.has(r.centerId)) {
      diem.byCenter[r.centerId] = (diem.byCenter[r.centerId] ?? 0) + r.amount;
    }
  }

  return days.map((d) => khoi.get(d)!);
}

function emptyReport(
  fromKey: string,
  toKey: string,
  centerIds: readonly string[],
  groupByCenter: boolean,
  rangeTrimmed: boolean,
): DailyRevenueReport {
  return {
    points: buildDailyRevenue([], { fromKey, toKey, centerIds, groupByCenter }),
    centerIds: groupByCenter ? [...centerIds] : [],
    total: 0,
    fromKey,
    toKey,
    rangeTrimmed,
    truncated: false,
    completeThroughDay: null,
  };
}

/**
 * B-04 — doanh thu thực thu theo từng ngày trong khoảng của bộ lọc A-02.
 *
 * ⚠️ Hàm này KHÔNG tự kiểm quyền — nó nhận `Actor` đã dựng sau `auth()`. Chỗ gọi vẫn
 * phải gác cửa (`checkPermission("payments:view")`) như mọi màn tiền khác.
 *
 * Cách ly cơ sở HAI LỚP, cùng lý do với `getRevenueByLeadChild`: đọc qua `scopedDb(actor)`
 * (`Payment` ∈ `SCOPED_MODELS`) VÀ tự lọc `centerId IN filters.centerIds`. Lớp thứ hai lo
 * phần lớp thứ nhất không lo — HO/SUPER_ADMIN bypass scope, nên chỉ dựa `scopedDb` thì
 * họ chọn một cơ sở mà vẫn ra số toàn hệ thống.
 *
 * Mốc thời gian là `Payment.paidDate` (ngày tiền về), khớp `lib/reports/trung-tam.ts` và
 * `revenue-by-child.ts` — đổi sang `confirmedAt` là lệch các màn kia đúng bằng độ trễ
 * duyệt của kế toán.
 */
export async function getDailyRevenue(
  actor: Actor,
  filters: ScopeFilters,
): Promise<DailyRevenueReport> {
  // Khoá ngày suy từ chính mốc của bộ lọc (đã neo giờ VN ở `buildScopeFilters`) — không
  // đọc lại searchParams, để trục ngày không thể lệch với thanh lọc đang hiển thị.
  const goc = trimDayRange(vnDayKey(filters.dateFrom), vnDayKey(filters.dateTo));

  if (filters.centerIds.length === 0) {
    return emptyReport(
      goc.fromKey,
      goc.toKey,
      filters.centerIds,
      filters.groupByCenter,
      goc.trimmed,
    );
  }

  const sdb = scopedDb(actor);
  // Cận dưới đi theo khoảng ĐÃ CẮT, nếu không thì tổng `aggregate` phủ khoảng rộng hơn
  // phần được vẽ ⇒ con số tổng không khớp biểu đồ ngay bên cạnh nó.
  const dateFrom = goc.trimmed ? vnDayStartUtc(goc.fromKey) : filters.dateFrom;
  const where = {
    ...WHERE_THUC_THU,
    centerId: { in: [...filters.centerIds] },
    paidDate: { gte: dateFrom, lte: filters.dateTo },
  };

  const [scanned, tongAgg] = await Promise.all([
    sdb.payment.findMany({
      where,
      select: {
        id: true,
        amount: true,
        accountantStatus: true,
        adjustmentOfId: true,
        centerId: true,
        paidDate: true,
      },
      orderBy: { paidDate: "asc" },
      take: DAILY_REVENUE_SCAN_MAX + 1,
    }),
    sdb.payment.aggregate({ where, _sum: { amount: true } }),
  ]);

  const truncated = scanned.length > DAILY_REVENUE_SCAN_MAX;
  const rows = (truncated ? scanned.slice(0, DAILY_REVENUE_SCAN_MAX) : scanned).map(
    (p): DailyRevenueScanRow => ({
      id: p.id,
      amount: p.amount,
      accountantStatus: p.accountantStatus as string,
      adjustmentOfId: p.adjustmentOfId,
      centerId: p.centerId,
      paidDate: p.paidDate,
    }),
  );

  // Ngày của bút toán cuối cùng đọc được có thể mới nạp được MỘT PHẦN ⇒ ngày còn đủ số
  // là ngày liền TRƯỚC nó. Nói hụt một ngày còn hơn khẳng định thừa một ngày.
  const cuoi = rows[rows.length - 1];
  const completeThroughDay =
    truncated && cuoi ? shiftDayKey(vnDayKey(cuoi.paidDate), -1) : null;

  return {
    points: buildDailyRevenue(rows, {
      fromKey: goc.fromKey,
      toKey: goc.toKey,
      centerIds: filters.centerIds,
      groupByCenter: filters.groupByCenter,
    }),
    centerIds: filters.groupByCenter ? [...filters.centerIds] : [],
    total: tongAgg._sum.amount ?? 0,
    fromKey: goc.fromKey,
    toKey: goc.toKey,
    rangeTrimmed: goc.trimmed,
    truncated,
    completeThroughDay,
  };
}

