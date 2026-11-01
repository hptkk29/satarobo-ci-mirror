// lib/reports/lead.ts — R7-17: Báo cáo Lead (phễu SR.QD.217 mở rộng).
// HÀM THUẦN: nhận MẢNG record phẳng (đã query sẵn) → trả object số liệu.
// KHÔNG gọi DB ở đây (Vitest test không cần Postgres). Mirror style lib/crm/marketing-report.ts.
//
// GĐ0 — import chỉ chạm @/lib/leads/status (thuần hằng số + type-only prisma), nên
// file này vẫn test được không cần Postgres.
import type { LeadStatus } from "@prisma/client";
import { CONVERTED_STATUSES, LEAD_STATUS_LABEL_SHORT } from "@/lib/leads/status";

/** Record Lead phẳng cần cho báo cáo (đã select sẵn ở tầng page). */
export type LeadReportRecord = {
  status: string; // LeadStatus
  source: string | null;
  centerId: string | null;
  commissionSource: string | null; // CommissionSource | null
  createdAt: Date;
  convertedAt?: Date | null;
  /** Bậc lead ĐANG Ở NGAY TRƯỚC khi rụng (`Lead.droppedAtStage`). */
  droppedAtStage?: string | null;
  /** Lý do rụng do người bấm ghi (`Lead.lostNote`). */
  lostNote?: string | null;
  /** Sale đang phụ trách (`Lead.assignedToId`). null = chưa chia cho ai. */
  assignedToId?: string | null;
  /** Khoá nối sang sổ `LeadStatusHistory`. Thiếu id = lead không bao giờ khớp được
   *  dòng sổ nào ⇒ `buildFunnelReached` xử như lead chưa có sổ. */
  id?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const ratio = (num: number, denom: number): number => (denom > 0 ? num / denom : 0);

/** Nhãn nguồn hoa hồng. */
export const COMMISSION_SOURCE_LABEL: Record<string, string> = {
  MARKETING_ADMIN: "Marketing/Admin",
  SALE_SELF: "Sale tự khai thác",
  REFERRAL: "Giới thiệu",
};

/**
 * GĐ0 — nhãn và tập "đã chốt" nay lấy từ nguồn duy nhất @/lib/leads/status.
 * Re-export CONVERTED_STATUSES để call-site cũ (màn marketing) không phải đổi đường
 * import; định nghĩa chỉ còn MỘT chỗ.
 */
export { CONVERTED_STATUSES };

/** Nhãn rút gọn dùng cho trục biểu đồ và phễu. */
const statusLabel = (status: string): string =>
  LEAD_STATUS_LABEL_SHORT[status as LeadStatus] ?? status;

/**
 * Thứ tự các bước phễu chuẩn SR.QD.217 (cho FunnelChart).
 *
 * GĐ5 — còn 7 bậc (trước 8). Bậc "đã phân công" biến mất vì ASSIGNED gộp vào MOI:
 * phân công nay là `Lead.assignedToId`, không phải một nấc chuyển đổi. Các bậc còn lại
 * giữ nguyên ý nghĩa, chỉ đổi tên.
 *
 * `satisfies` để một giá trị viết sai chính tả bị TypeScript bắt — danh sách này CỐ Ý
 * là tập con của enum (DANG_HOC_THU / DANG_NUOI_DUONG / DA_MAT không phải bậc phễu)
 * nên không dùng được ràng buộc đủ-mọi-giá-trị.
 */
const FUNNEL_ORDER_STRICT = [
  "MOI",
  "DA_LIEN_HE",
  "DANG_TU_VAN",
  "DA_HEN_HOC_THU",
  "DA_HOC_THU",
  "CHO_QUYET_DINH",
  "DA_DANG_KY",
] as const satisfies readonly LeadStatus[];

export const FUNNEL_ORDER: string[] = [...FUNNEL_ORDER_STRICT];

/**
 * Rank stage phễu mà một status "đã chạm tới" (cumulative funnel).
 * Status ngoài phễu (DA_MAT) = -1 → không tính vào phễu nhưng vẫn đếm theo status.
 *
 * ⚠️ Khai bằng `Record<LeadStatus, number>` rồi mới nới ra `Record<string, number>` khi
 * export: bảng này index bằng `string` (record phẳng từ page không narrow), nên nếu khai
 * thẳng kiểu nới thì THIẾU một giá trị enum sẽ không ai báo — lead rơi vào `?? -1`, biến
 * mất khỏi phễu, và biểu đồ vẫn vẽ ra số 0 trông rất bình thường. Đây đúng là cách bảng
 * cũ chết câm khi enum đổi tên ở GĐ5.
 */
const STATUS_RANK_STRICT: Record<LeadStatus, number> = {
  MOI: 0,
  DA_LIEN_HE: 1,
  DANG_TU_VAN: 2,
  DANG_NUOI_DUONG: 2, // đang nuôi dưỡng = đã tư vấn (giữ nguyên quy ước cũ của NURTURING)
  DA_HEN_HOC_THU: 3,
  DANG_HOC_THU: 3, // đang học thử chưa qua bậc "đã hẹn" (quy ước cũ của TRIAL_IN_PROGRESS)
  DA_HOC_THU: 4,
  CHO_QUYET_DINH: 5,
  DA_DANG_KY: 6,
  DA_MAT: -1,
};

export const STATUS_RANK: Record<string, number> = STATUS_RANK_STRICT;

function rankOf(status: string): number {
  return STATUS_RANK[status] ?? -1;
}

function isConverted(r: LeadReportRecord): boolean {
  return CONVERTED_STATUSES.has(r.status);
}

/** "YYYY-MM" theo giờ Việt Nam (UTC+7, không DST). THUẦN. */
export function monthKeyVN(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 3_600_000);
  return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}`;
}

/** "YYYY-MM-DD" theo giờ Việt Nam (UTC+7, không DST). THUẦN. */
export function dateKeyVN(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 3_600_000);
  return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}`;
}

/** Nhãn ngắn "dd/MM" theo giờ Việt Nam. THUẦN. */
function dayLabelVN(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 3_600_000);
  return `${pad(vn.getUTCDate())}/${pad(vn.getUTCMonth() + 1)}`;
}

export type StatusCount = { status: string; label: string; count: number };

/** Đếm lead theo từng status hiện tại (mọi enum, kể cả off-pipeline). */
export function countByStatus(records: LeadReportRecord[]): StatusCount[] {
  const m = new Map<string, number>();
  for (const r of records) m.set(r.status, (m.get(r.status) ?? 0) + 1);
  return [...m.entries()]
    .map(([status, count]) => ({ status, label: statusLabel(status), count }))
    .sort((a, b) => b.count - a.count);
}

export type FunnelStep = { status: string; label: string; count: number };

/**
 * Phễu cumulative: số lead ĐÃ CHẠM tới ÍT NHẤT mỗi bước (rank >= bước). THUẦN.
 * Lead DA_DANG_KY tính ở mọi bước; lead DA_MAT không tính (rank -1).
 */
export function buildFunnel(records: LeadReportRecord[]): FunnelStep[] {
  return FUNNEL_ORDER.map((status, i) => ({
    status,
    label: statusLabel(status),
    count: records.filter((r) => rankOf(r.status) >= i).length,
  }));
}

/** Một dòng sổ `LeadStatusHistory` rút gọn còn đúng phần phễu cần. */
export type LeadLedgerRow = { leadId: string; toStatus: string };

/**
 * Phễu "ĐÃ TỪNG TỚI": đếm lead theo bậc CAO NHẤT nó từng chạm, đọc từ sổ GĐ1.
 *
 * ⚠️ Vì sao cần hàm thứ hai thay vì sửa `buildFunnel`: hai hàm trả lời hai câu khác
 * nhau và cả hai đều có người cần. `buildFunnel` = "ĐANG ở bậc nào" (ảnh chụp hiện
 * tại, dùng để biết tồn đọng ở đâu). Hàm này = "ĐÃ TỪNG tới bậc nào" (dùng để tính tỷ
 * lệ chuyển đổi). Gộp làm một là mất một trong hai.
 *
 * Bệnh nó chữa: `buildFunnel` đếm bằng trạng thái hiện tại, nên lead từng lên tới
 * "Đã học thử" rồi rớt (`DA_MAT`, rank -1) biến mất khỏi MỌI bậc — kể cả bậc nó đã đi
 * qua thật. Hệ quả nặng hơn con số phễu là MẪU SỐ: `funnelConversionRates` mất luôn
 * phần rụng ⇒ tỷ lệ chuyển đổi bị thổi lên và trông rất đẹp.
 *
 * CÔNG THỨC: bậc của lead = max(rank trạng thái hiện tại, rank mọi `toStatus` trong sổ).
 * Một công thức phủ cả hai trường hợp, không cần nhánh `if`:
 *   · lead CÓ sổ    → sổ kéo bậc lên đúng chỗ cao nhất nó từng tới;
 *   · lead KHÔNG sổ → max chỉ còn trạng thái hiện tại = ĐÚNG BẰNG cách tính cũ.
 *
 * Trường hợp thứ hai không phải chuyện hiếm: sổ **cố ý không backfill** (migration
 * 20260825120000 — suy ngược lịch sử là bịa), nên toàn bộ lead trước 25/08/2026 đi
 * đường đó. Đọc thuần từ sổ là phễu tụt về gần 0 cho mọi dữ liệu cũ; `ledgerCoverage`
 * cho con số để ghi chú thích cái mốc đó lên giao diện.
 *
 * `toStatus` lạ (enum đổi tên như GĐ5) rơi vào `?? -1` nên bị `Math.max` bỏ qua —
 * KHÔNG kéo lead tụt bậc.
 */
export function buildFunnelReached(
  records: LeadReportRecord[],
  ledger: LeadLedgerRow[],
): FunnelStep[] {
  const capNhat = new Map<string, number>();
  for (const row of ledger) {
    const r = rankOf(row.toStatus);
    const cu = capNhat.get(row.leadId);
    if (cu === undefined || r > cu) capNhat.set(row.leadId, r);
  }
  const bac = records.map((rec) => {
    const tuSo = rec.id !== undefined ? capNhat.get(rec.id) : undefined;
    return Math.max(rankOf(rec.status), tuSo ?? -1);
  });
  return FUNNEL_ORDER.map((status, i) => ({
    status,
    label: statusLabel(status),
    count: bac.filter((b) => b >= i).length,
  }));
}

/**
 * Bao nhiêu lead trong kỳ có sổ, bao nhiêu chưa — để giao diện nói thẳng phần nào của
 * phễu suy từ sổ, phần nào vẫn là ảnh chụp trạng thái hiện tại. Không có con số này
 * thì hai nguồn trộn vào nhau mà người đọc không biết.
 */
export function ledgerCoverage(
  records: LeadReportRecord[],
  ledger: LeadLedgerRow[],
): { coSo: number; khongCoSo: number } {
  const coDong = new Set(ledger.map((r) => r.leadId));
  let coSo = 0;
  for (const rec of records) if (rec.id !== undefined && coDong.has(rec.id)) coSo++;
  return { coSo, khongCoSo: records.length - coSo };
}

export type FunnelConversion = { fromLabel: string; toLabel: string; rate: number };

/** Tỷ lệ chuyển giữa các bước phễu liền kề (count[i+1]/count[i]). THUẦN, chia-0 an toàn. */
export function funnelConversionRates(funnel: FunnelStep[]): FunnelConversion[] {
  const out: FunnelConversion[] = [];
  for (let i = 0; i < funnel.length - 1; i++) {
    out.push({
      fromLabel: funnel[i].label,
      toLabel: funnel[i + 1].label,
      rate: ratio(funnel[i + 1].count, funnel[i].count),
    });
  }
  return out;
}

export type GroupStat = {
  key: string;
  label: string;
  total: number;
  converted: number;
  conversionRate: number;
};

const UNKNOWN_LABEL = "Không rõ";

/** Nhóm theo nguồn (source). null → "Không rõ". Kèm số chốt + tỷ lệ. THUẦN. */
export function groupBySource(records: LeadReportRecord[]): GroupStat[] {
  return groupBy(records, (r) => r.source ?? UNKNOWN_LABEL, (k) => k);
}

/** Nhóm theo nguồn hoa hồng (commissionSource). THUẦN. */
export function groupByCommissionSource(records: LeadReportRecord[]): GroupStat[] {
  return groupBy(
    records,
    (r) => r.commissionSource ?? UNKNOWN_LABEL,
    (k) => COMMISSION_SOURCE_LABEL[k] ?? k,
  );
}

/** Nhóm theo cơ sở (centerId). null → "Không rõ". `centerNames` map id→tên (optional). THUẦN. */
export function groupByCenter(
  records: LeadReportRecord[],
  centerNames?: Record<string, string>,
): GroupStat[] {
  return groupBy(
    records,
    (r) => r.centerId ?? UNKNOWN_LABEL,
    (k) => (centerNames?.[k] ?? (k === UNKNOWN_LABEL ? UNKNOWN_LABEL : k)),
  );
}

export type SaleStat = {
  key: string;
  saleLabel: string;
  centerLabel: string;
  total: number;
  converted: number;
  conversionRate: number;
};

const CHUA_CHIA = "Chưa chia cho ai";

/**
 * Tỷ lệ chốt của TỪNG SALE, tách theo cơ sở.
 *
 * Vì sao khoá là `centerId::assignedToId` chứ không chỉ `assignedToId`: một người có thể
 * ôm lead ở hai cơ sở (Sale Hội sở, hoặc người vừa chuyển cơ sở). Gộp lại thành một dòng
 * thì Quản lý cơ sở A thấy tỷ lệ đã pha lẫn lead của cơ sở B — con số đó không dùng để
 * đánh giá ai được.
 *
 * Lead CHƯA chia cho ai vẫn được đếm thành một dòng riêng, KHÔNG bỏ đi: đó thường là
 * phần hở lớn nhất của phễu, bỏ khỏi bảng là giấu đúng chỗ cần nhìn. THUẦN.
 */
export function groupBySale(
  records: LeadReportRecord[],
  centerNames?: Record<string, string>,
  saleNames?: Record<string, string>,
): SaleStat[] {
  const m = new Map<string, { total: number; converted: number; sale: string; center: string }>();
  for (const r of records) {
    const saleId = r.assignedToId ?? "";
    const centerId = r.centerId ?? "";
    const key = `${centerId}::${saleId}`;
    const cur =
      m.get(key) ??
      {
        total: 0,
        converted: 0,
        sale: saleId ? (saleNames?.[saleId] ?? saleId) : CHUA_CHIA,
        center: centerId ? (centerNames?.[centerId] ?? centerId) : UNKNOWN_LABEL,
      };
    cur.total += 1;
    if (isConverted(r)) cur.converted += 1;
    m.set(key, cur);
  }
  return [...m.entries()]
    .map(([key, v]) => ({
      key,
      saleLabel: v.sale,
      centerLabel: v.center,
      total: v.total,
      converted: v.converted,
      conversionRate: ratio(v.converted, v.total),
    }))
    // Sắp theo SỐ CHỐT giảm dần rồi mới tới tổng: bảng này để nhìn ai đang chốt được,
    // và tỷ lệ 100% trên 1 lead không đáng đứng trên 40% trên 50 lead.
    .sort((a, b) => b.converted - a.converted || b.total - a.total);
}

export type MonthStat = { month: string; total: number; converted: number };

/** Nhóm theo tháng tạo lead (giờ VN), sắp xếp tăng dần. THUẦN. */
export function groupByMonth(records: LeadReportRecord[]): MonthStat[] {
  const m = new Map<string, { total: number; converted: number }>();
  for (const r of records) {
    const key = monthKeyVN(r.createdAt);
    const cur = m.get(key) ?? { total: 0, converted: 0 };
    cur.total += 1;
    if (isConverted(r)) cur.converted += 1;
    m.set(key, cur);
  }
  return [...m.entries()]
    .map(([month, v]) => ({ month, total: v.total, converted: v.converted }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

const WEEK_MS = 7 * 86_400_000;

export type WeekStat = { weekStart: string; label: string; total: number; converted: number };

/**
 * Phễu lead theo TUẦN (câu 16): `weeks` tuần gần nhất (mỗi tuần = bucket 7 ngày) tính
 * đến `now`. Mỗi bucket: tổng lead tạo trong tuần + số đã chuyển đổi (DA_DANG_KY
 * ∈ CONVERTED_STATUSES). Sắp cũ→mới. THUẦN — nhận `now` để test tất định. Đầu vào rỗng →
 * vẫn trả đủ `weeks` bucket số 0.
 */
export function groupByWeek(
  records: LeadReportRecord[],
  weeks = 8,
  now: Date = new Date(),
): WeekStat[] {
  const end = now.getTime();
  const startAll = end - weeks * WEEK_MS;
  const counts = Array.from({ length: weeks }, () => ({ total: 0, converted: 0 }));
  for (const r of records) {
    const t = r.createdAt.getTime();
    // Bao gồm record tạo ĐÚNG thời điểm `now` (t === end) vào tuần hiện tại; chỉ loại
    // record ngoài cửa sổ (cũ hơn startAll) hoặc ở TƯƠNG LAI (t > end). idx clamp weeks-1.
    if (t < startAll || t > end) continue;
    const idx = Math.min(weeks - 1, Math.floor((t - startAll) / WEEK_MS));
    counts[idx].total += 1;
    if (isConverted(r)) counts[idx].converted += 1;
  }
  return counts.map((c, i) => {
    const winStart = new Date(startAll + i * WEEK_MS);
    return { weekStart: dateKeyVN(winStart), label: dayLabelVN(winStart), total: c.total, converted: c.converted };
  });
}

/** Helper nhóm generic (THUẦN). */
function groupBy(
  records: LeadReportRecord[],
  keyOf: (r: LeadReportRecord) => string,
  labelOf: (k: string) => string,
): GroupStat[] {
  const m = new Map<string, { total: number; converted: number }>();
  for (const r of records) {
    const key = keyOf(r);
    const cur = m.get(key) ?? { total: 0, converted: 0 };
    cur.total += 1;
    if (isConverted(r)) cur.converted += 1;
    m.set(key, cur);
  }
  return [...m.entries()]
    .map(([key, v]) => ({
      key,
      label: labelOf(key),
      total: v.total,
      converted: v.converted,
      conversionRate: ratio(v.converted, v.total),
    }))
    .sort((a, b) => b.total - a.total);
}

export type LeadReportSummary = {
  total: number;
  converted: number;
  conversionRate: number;
  /** Lead đang ở pipeline hoạt động (rank >= 0, chưa chốt và chưa DA_MAT). */
  active: number;
  lost: number;
};

/** Tổng quan: tổng lead, số chốt, tỷ lệ chốt, đang hoạt động, thất bại. THUẦN. */
export function leadSummary(records: LeadReportRecord[]): LeadReportSummary {
  const total = records.length;
  const converted = records.filter(isConverted).length;
  const lost = records.filter((r) => rankOf(r.status) < 0).length;
  const active = total - converted - lost;
  return { total, converted, conversionRate: ratio(converted, total), active, lost };
}

/** Một bậc rụng: bao nhiêu lead rời phễu ở đó và vì sao. */
export type DropStageStat = {
  stage: string;
  label: string;
  count: number;
  /** Lý do hay gặp nhất ở bậc này (đã gộp trùng, tối đa 5). */
  topReasons: { reason: string; count: number }[];
  /** Số lead rụng ở bậc này mà KHÔNG có lý do — toàn bộ đều là lead rụng TRƯỚC
   * ngày bật ép nhập lý do. Hiện riêng để không ai đọc nhầm là "không có lý do". */
  missingReason: number;
};

/**
 * "Lead rụng ở BẬC NÀO, và vì sao" — người đọc duy nhất của `Lead.droppedAtStage`,
 * đọc lý do ở `Lead.lostNote`.
 *
 * ⚠️ `droppedAtStage` ra đời ở GĐ1 (migration 20260825120000) và tới 26/08 KHÔNG màn
 * nào, báo cáo nào đọc — ghi vào rồi bỏ đó. Hàm này là chỗ dùng nó.
 *
 * 27/08 — lý do rụng đọc ở `lostNote` (cột dùng chung với đường đánh dấu rớt theo
 * TỪNG CON), không còn `dropReason`. Hệ quả cố ý: một phiếu có hai con rớt vì hai lý
 * do thì ở đây chỉ thấy lý do ghi SAU CÙNG — lý do từng con tra ở dòng thời gian và
 * AuditLog, đúng như đánh đổi đã chấp nhận ở C-06.
 *
 * Chỉ đếm lead THẬT SỰ có bậc rụng: `droppedAtStage` chỉ được ghi khi lead vào
 * `LEAD_DROP_STATUSES`, nên lead còn trong phễu không lọt vào đây.
 */
export function groupByDropStage(records: LeadReportRecord[]): DropStageStat[] {
  const theoBac = new Map<string, { count: number; lyDo: Map<string, number>; thieu: number }>();
  for (const r of records) {
    const bac = r.droppedAtStage;
    if (!bac) continue;
    const o =
      theoBac.get(bac) ?? { count: 0, lyDo: new Map<string, number>(), thieu: 0 };
    o.count++;
    const ly = r.lostNote?.trim();
    if (ly) o.lyDo.set(ly, (o.lyDo.get(ly) ?? 0) + 1);
    else o.thieu++;
    theoBac.set(bac, o);
  }
  return [...theoBac.entries()]
    .map(([stage, o]) => ({
      stage,
      label: LEAD_STATUS_LABEL_SHORT[stage as LeadStatus] ?? stage,
      count: o.count,
      topReasons: [...o.lyDo.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
        .slice(0, 5),
      missingReason: o.thieu,
    }))
    // Bậc rụng nhiều nhất lên đầu — đó là chỗ đáng sửa quy trình trước.
    .sort((a, b) => b.count - a.count || a.stage.localeCompare(b.stage));
}

export type LeadReport = {
  summary: LeadReportSummary;
  statusCounts: StatusCount[];
  /** "ĐANG ở bậc nào" — ảnh chụp trạng thái hiện tại. */
  funnel: FunnelStep[];
  /** "ĐÃ TỪNG tới bậc nào" — suy từ sổ GĐ1; bằng `funnel` khi chưa có dòng sổ nào. */
  funnelReached: FunnelStep[];
  /** Tính trên `funnelReached`: mẫu số phải gồm cả lead đã rụng, nếu không tỷ lệ bị thổi. */
  funnelConversion: FunnelConversion[];
  /** Bao nhiêu lead trong kỳ có sổ / chưa có — để ghi chú thích mốc 25/08 lên giao diện. */
  ledgerCoverage: { coSo: number; khongCoSo: number };
  bySource: GroupStat[];
  byCommissionSource: GroupStat[];
  byCenter: GroupStat[];
  /** Tỷ lệ chốt của từng sale, tách theo cơ sở. */
  bySale: SaleStat[];
  byMonth: MonthStat[];
  byDropStage: DropStageStat[];
};

/** Tổng hợp toàn bộ báo cáo Lead từ mảng record phẳng. THUẦN — đầu vào rỗng → số 0. */
export function buildLeadReport(
  records: LeadReportRecord[],
  centerNames?: Record<string, string>,
  saleNames?: Record<string, string>,
  /** Dòng sổ `LeadStatusHistory` của đúng tập lead này. Bỏ trống = hành vi cũ y nguyên. */
  ledger: LeadLedgerRow[] = [],
): LeadReport {
  const funnel = buildFunnel(records);
  const funnelReached = buildFunnelReached(records, ledger);
  return {
    summary: leadSummary(records),
    statusCounts: countByStatus(records),
    funnel,
    funnelReached,
    // Tỷ lệ chuyển đổi đọc phễu "đã từng tới", KHÔNG phải phễu "đang ở": lead rụng
    // giữa chừng phải nằm trong MẪU SỐ của bậc nó đã đi qua. Bỏ nó ra khỏi cả tử lẫn
    // mẫu là tỷ lệ tự đẹp lên đúng bằng phần rụng — sai theo hướng không ai muốn kiểm.
    funnelConversion: funnelConversionRates(funnelReached),
    ledgerCoverage: ledgerCoverage(records, ledger),
    bySource: groupBySource(records),
    byCommissionSource: groupByCommissionSource(records),
    byCenter: groupByCenter(records, centerNames),
    bySale: groupBySale(records, centerNames, saleNames),
    byMonth: groupByMonth(records),
    byDropStage: groupByDropStage(records),
  };
}
