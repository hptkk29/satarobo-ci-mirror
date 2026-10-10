// lib/reports/lost-leads.ts — C-05: bảng LEAD RỚT + hai cột "lần tiếp cận gần nhất"
// và "số ngày chưa tiếp cận lại".
//
// Nối ba thứ đã có, KHÔNG dựng lại cái nào:
//   • `lib/lead/activity-clock.ts` — `lastLeadOutreachAt` + hằng `LEAD_OUTREACH_TYPES`
//     (đâu là "đã chạm khách", tách khỏi "có hoạt động"). Trước đợt 3 đồng hồ này hỏng,
//     nên C-05 không làm được; nay nó là ĐƯỜNG DUY NHẤT trả mốc tiếp cận.
//   • `lib/lead/stale-lead.ts` — số ngày + hai ngưỡng cảnh báo (12(a): vàng 2 / đỏ 7).
//   • `lib/lead/pii.ts` — `maskLeadPiiFields`. Bảng nội bộ KHÔNG phải lý do đọc cột thô.
//
// ┌─ "Rớt" là trạng thái của TỪNG CON, không phải của phiếu ──────────────────────────┐
// │ C-06 (quyết định B5, 24/08/2026) đặt `LeadChild.status = LOST` ở cấp CON, còn LÝ   │
// │ DO (`Lead.lostNote`) ở cấp PHỤ HUYNH. Nên MỘT DÒNG của bảng này = MỘT ĐỨA CON rớt, │
// │ và mỗi dòng mang theo trạng thái các anh chị em còn lại. Gộp lại thành "phiếu rớt" │
// │ là khai tử nhầm đứa đang đi học — đúng cái sai C-06 vừa chữa.                      │
// └───────────────────────────────────────────────────────────────────────────────────┘
//
// ⚠️ Khoảng ngày của bộ lọc A-02 áp lên `Lead.createdAt` (THỜI GIAN VÀO HỆ THỐNG), KHÔNG
// phải `lostAt`. Hai lý do: (a) `lostAt` ở cấp phụ huynh và bị lượt đánh dấu sau ĐÈ lượt
// trước (hệ quả đã biết của B5) nên không định được ngày rớt của TỪNG con; (b) cùng mẫu
// số với C-02 "tổng lead trong kỳ" ⇒ đọc được là "trong số lead vào hệ thống kỳ này, đây
// là những em đã rớt". Màn hình phải nói câu đó ra, đừng để người xem tự đoán.
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import type { LeadActivityType, LeadChildStatus } from "@prisma/client";
import {
  LEAD_OUTREACH_TYPES,
  lastLeadOutreachAt,
  type LeadActivityLike,
} from "@/lib/lead/activity-clock";
import { LOST_CHILD_STATUS } from "@/lib/lead/lost-status";
import { maskLeadPiiFields } from "@/lib/lead/pii";
import {
  buildOutreachClock,
  DEFAULT_STALE_LEAD_THRESHOLDS,
  type OutreachClock,
  type StaleLeadThresholds,
} from "@/lib/lead/stale-lead";
import type { ScopeFilters } from "@/lib/reports/scope-filters";

/**
 * Trần số PHIẾU đọc về. Vượt trần thì bảng bị cắt và `truncated` bật để màn hình nói ra
 * — im lặng cắt một bảng "lead rớt" là để người ta tưởng đã soi hết.
 */
export const LOST_LEAD_SCAN_MAX = 500;

/**
 * Trần số dòng hoạt động quét để dựng đồng hồ tiếp cận.
 *
 * ⚠️ Đọc theo `createdAt DESC` nên khi cắt, thứ mất là hoạt động CŨ nhất. Hệ quả: phiếu
 * bị cắt sẽ hiện "chưa tiếp cận lần nào" và số ngày đếm từ ngày vào hệ thống — tức
 * TREO HƠN thực tế, không phải sạch hơn. Sai về phía kêu to là sai chấp nhận được ở
 * bảng cảnh báo; sai về phía im lặng thì không.
 */
export const LOST_LEAD_ACTIVITY_SCAN_MAX = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// Phần THUẦN — dựng dòng từ dữ liệu đã đọc sẵn (Vitest không cần DB)
// ─────────────────────────────────────────────────────────────────────────────

export type LostLeadChildInput = {
  id: string;
  fullName: string;
  /** `null` = phiếu cũ CHƯA ai phân loại — KHÔNG phải rớt. */
  status: LeadChildStatus | null;
};

export type LostLeadLeadInput = {
  id: string;
  parentName: string;
  createdAt: Date;
  centerId: string | null;
  lostNote: string | null;
  courseName: string | null;
  assignedToName: string | null;
  children: LostLeadChildInput[];
};

/** Một dòng `LeadActivity` đã phẳng hoá, kèm phiếu nó thuộc về. */
export type LostLeadActivityInput = LeadActivityLike & { leadId: string };

export type LostLeadSibling = {
  leadChildId: string;
  /** ĐÃ che theo quyền PII. */
  childName: string;
  status: LeadChildStatus | null;
};

export type LostLeadRow = {
  leadId: string;
  leadChildId: string;
  /** ĐÃ che theo quyền PII. */
  childName: string;
  /** ĐÃ che theo quyền PII. */
  parentName: string;
  courseName: string | null;
  centerId: string | null;
  assignedToName: string | null;
  /** Thời gian phiếu vào hệ thống. */
  createdAt: Date;
  /** Lý do rớt (`Lead.lostNote`) — ĐÃ che theo quyền PII. */
  lostNote: string | null;
  clock: OutreachClock;
  /** Các con CÒN LẠI của cùng phiếu, kèm trạng thái (không che trạng thái). */
  siblings: LostLeadSibling[];
};

/**
 * THUẦN — gom hoạt động thành mốc tiếp cận gần nhất của TỪNG phiếu.
 *
 * Nhóm theo `leadId` trước rồi mới xét: một lượt đọc gom hoạt động của N phiếu, nhóm sai
 * là reset đồng hồ của phiếu bị bỏ quên bằng cuộc gọi cho nhà khác.
 */
export function outreachByLead(
  activities: readonly LostLeadActivityInput[],
  outreachTypes: readonly LeadActivityType[] = LEAD_OUTREACH_TYPES,
): Map<string, Date> {
  const theoPhieu = new Map<string, LeadActivityLike[]>();
  for (const a of activities) {
    const list = theoPhieu.get(a.leadId);
    if (list) list.push(a);
    else theoPhieu.set(a.leadId, [a]);
  }

  const out = new Map<string, Date>();
  for (const [leadId, list] of theoPhieu) {
    const moc = lastLeadOutreachAt(list, outreachTypes);
    if (moc) out.set(leadId, moc);
  }
  return out;
}

/**
 * THUẦN — dựng danh sách dòng "lead rớt", đã che PII và đã sắp xếp.
 *
 * @param thresholdsFor ngưỡng theo cơ sở của phiếu (hai key `centerOverridable` —
 *   quyết định 12(a)). Bỏ trống ⇒ ngưỡng mặc định 2/7 cho mọi dòng.
 */
export function buildLostLeadRows(args: {
  leads: readonly LostLeadLeadInput[];
  activities: readonly LostLeadActivityInput[];
  now: Date;
  canViewPii: boolean;
  thresholdsFor?: (centerId: string | null) => StaleLeadThresholds;
  outreachTypes?: readonly LeadActivityType[];
}): LostLeadRow[] {
  const mocTheoPhieu = outreachByLead(
    args.activities,
    args.outreachTypes ?? LEAD_OUTREACH_TYPES,
  );
  const nguong = args.thresholdsFor ?? (() => DEFAULT_STALE_LEAD_THRESHOLDS);
  const rows: LostLeadRow[] = [];

  for (const lead of args.leads) {
    const roi = lead.children.filter((c) => c.status === LOST_CHILD_STATUS);
    if (roi.length === 0) continue;

    // MỘT đồng hồ cho cả phiếu: "tiếp cận" là chuyện với PHỤ HUYNH, không phải với
    // từng đứa trẻ — `LeadActivity` cũng chỉ gắn `leadId`.
    const clock = buildOutreachClock({
      lastOutreachAt: mocTheoPhieu.get(lead.id) ?? null,
      createdAt: lead.createdAt,
      now: args.now,
      thresholds: nguong(lead.centerId),
    });

    for (const con of roi) {
      // Che MỘT LƯỢT qua tầng chung: tên PH + tên con + lý do rớt. Ba khoá này đều nằm
      // trong `sensitiveFields` của `leads:view-pii` (lib/permissions/registry/crm.ts).
      const che = maskLeadPiiFields(
        {
          parentName: lead.parentName,
          childName: con.fullName,
          lostNote: lead.lostNote,
        },
        args.canViewPii,
      );

      rows.push({
        leadId: lead.id,
        leadChildId: con.id,
        childName: che.childName ?? "",
        parentName: che.parentName ?? "",
        courseName: lead.courseName,
        centerId: lead.centerId,
        assignedToName: lead.assignedToName,
        createdAt: lead.createdAt,
        lostNote: che.lostNote ?? null,
        clock,
        siblings: lead.children
          .filter((s) => s.id !== con.id)
          .map((s) => ({
            leadChildId: s.id,
            childName:
              maskLeadPiiFields({ childName: s.fullName }, args.canViewPii).childName ?? "",
            // Trạng thái KHÔNG che: đó là dữ liệu nghiệp vụ, không phải danh tính — và
            // che nó là làm hỏng đúng thứ dòng này sinh ra để nói.
            status: s.status,
          })),
      });
    }
  }

  // Bỏ quên lâu nhất lên đầu — bảng này tồn tại để QLCS soi lead treo, nên thứ tự phải
  // phục vụ đúng việc đó. Hoà thì xếp theo tên để bảng không nhảy giữa hai lần tải.
  return rows.sort(
    (a, b) => b.clock.days - a.clock.days || a.childName.localeCompare(b.childName, "vi"),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Đường đọc DB
// ─────────────────────────────────────────────────────────────────────────────

export type LostLeadReport = {
  rows: LostLeadRow[];
  /** true = vượt `LOST_LEAD_SCAN_MAX`; bảng đang thiếu phiếu, màn hình phải nói ra. */
  truncated: boolean;
  /** true = vượt trần quét hoạt động ⇒ vài dòng hiện TREO HƠN thực tế. */
  clockTruncated: boolean;
};

const RONG: LostLeadReport = { rows: [], truncated: false, clockTruncated: false };

/**
 * C-05 — danh sách CON đã bị đánh dấu rớt, trong phạm vi + khoảng ngày của bộ lọc A-02.
 *
 * ⚠️ Hàm này KHÔNG tự kiểm quyền — nó nhận `Actor` đã dựng sau `auth()`. Chỗ gọi (trang /
 * Server Action) vẫn phải gác cửa: tab C mở bằng `leads:view-all` (chốt 24/08, ghi ở
 * `lib/auth/permissions.ts`), và `canViewPii` phải là kết quả của `canViewLeadPii()`.
 *
 * Cách ly cơ sở HAI LỚP, cùng lý do với `getRevenueByLeadChild`: đọc qua `scopedDb(actor)`
 * (`Lead` ∈ `SCOPED_MODELS`) VÀ tự lọc `centerId IN filters.centerIds`. Lớp thứ hai lo
 * phần lớp thứ nhất không lo — HO/SUPER_ADMIN bypass scope, nên chỉ dựa `scopedDb` thì họ
 * chọn một cơ sở mà vẫn ra danh sách toàn hệ thống.
 */
export async function getLostLeadRows(
  actor: Actor,
  filters: ScopeFilters,
  opts: {
    canViewPii: boolean;
    now?: Date;
    thresholdsFor?: (centerId: string | null) => StaleLeadThresholds;
  },
): Promise<LostLeadReport> {
  if (filters.centerIds.length === 0) return RONG;

  const sdb = scopedDb(actor);
  const centerWhere = filters.isAllCenters
    ? // "Tất cả cơ sở" ⇒ gộp cả phiếu CHƯA gán cơ sở (`Lead.centerId = null` nghĩa là
      // lead mới về, chưa chia) — bỏ chúng đi là giấu đúng nhóm dễ bị bỏ quên nhất.
      // Người cấp cơ sở vẫn không thấy nhóm này: `scopedDb` chặn ở lớp ngoài.
      { OR: [{ centerId: { in: [...filters.centerIds] } }, { centerId: null }] }
    : { centerId: { in: [...filters.centerIds] } };

  const scanned = await sdb.lead.findMany({
    where: {
      deletedAt: null,
      createdAt: { gte: filters.dateFrom, lte: filters.dateTo },
      ...centerWhere,
      // Lọc ở DB: phiếu không có con nào rớt thì không kéo về. `children` là quan hệ tới
      // `LeadChild` — model này KHÔNG thuộc `SCOPED_MODELS` nên không có chuyện nested
      // filter bị scope làm rỗng.
      children: { some: { status: LOST_CHILD_STATUS } },
    },
    select: {
      id: true,
      parentName: true,
      createdAt: true,
      centerId: true,
      lostNote: true,
      course: { select: { name: true } },
      assignedTo: { select: { name: true } },
      children: { select: { id: true, fullName: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: LOST_LEAD_SCAN_MAX + 1,
  });

  const truncated = scanned.length > LOST_LEAD_SCAN_MAX;
  const leads: LostLeadLeadInput[] = (
    truncated ? scanned.slice(0, LOST_LEAD_SCAN_MAX) : scanned
  ).map((l) => ({
    id: l.id,
    parentName: l.parentName,
    createdAt: l.createdAt,
    centerId: l.centerId,
    lostNote: l.lostNote,
    courseName: l.course?.name ?? null,
    assignedToName: l.assignedTo?.name ?? null,
    children: l.children.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      status: c.status,
    })),
  }));

  if (leads.length === 0) return { rows: [], truncated, clockTruncated: false };

  // Đồng hồ tiếp cận: lọc SẴN theo loại ở DB (`LEAD_OUTREACH_TYPES`) rồi để hàm thuần
  // loại nốt dòng do MÁY ghi. Không lọc `metadata.system` ở DB: đó là cột Json tự do,
  // và một `NOT (metadata->'system' = true)` sẽ nuốt luôn mọi dòng `metadata IS NULL`
  // (SQL ba trị) — tức bỏ đúng những cuộc gọi thật.
  const activityRows = await sdb.leadActivity.findMany({
    where: {
      leadId: { in: leads.map((l) => l.id) },
      type: { in: [...LEAD_OUTREACH_TYPES] },
    },
    select: { leadId: true, type: true, createdAt: true, metadata: true },
    orderBy: { createdAt: "desc" },
    take: LOST_LEAD_ACTIVITY_SCAN_MAX + 1,
  });
  const clockTruncated = activityRows.length > LOST_LEAD_ACTIVITY_SCAN_MAX;

  return {
    rows: buildLostLeadRows({
      leads,
      activities: (clockTruncated
        ? activityRows.slice(0, LOST_LEAD_ACTIVITY_SCAN_MAX)
        : activityRows
      ).map((a) => ({
        leadId: a.leadId,
        type: a.type,
        createdAt: a.createdAt,
        metadata: a.metadata,
      })),
      now: opts.now ?? new Date(),
      canViewPii: opts.canViewPii,
      thresholdsFor: opts.thresholdsFor,
    }),
    truncated,
    clockTruncated,
  };
}
