// lib/lead/status-trail.ts — C-07: HÌNH DẠNG của vết đổi trạng thái lead.
//
// Spec C-07 đòi "log ai đổi, đổi lúc nào, TỪ trạng thái nào — hiển thị ở trang
// chi tiết lead". Trước ticket này mỗi đường đổi trạng thái tự ghi một kiểu:
//
//   · đổi tay (`updateLeadStatus`)            → AuditLog + LeadActivity  ✅
//   · ghi nhận tiền (`maybeAdvanceLead…`)     → chỉ LeadActivity          ⇒ mất ở mục "Lịch sử thay đổi"
//   · chốt ghi danh (`convertLeadToEnrollment`) → chỉ AuditLog            ⇒ mất ở dòng thời gian
//   · điểm danh học thử (`syncTrialProgress`) → KHÔNG ghi gì              ⇒ mất hẳn
//   · tự chia / gán lead (`assign*.ts`)       → KHÔNG ghi gì về trạng thái ⇒ mất mốc NEW→ASSIGNED
//
// Nay tất cả đi qua `recordLeadStatusChange` (xem `status-trail-write.ts`), còn
// file này giữ phần THUẦN: dựng nội dung vết, và gạn mốc trạng thái ra khỏi
// nhật ký chung khi ĐỌC.
//
// ⚠️ Module THUẦN — KHÔNG import `@/lib/db`, `@/lib/audit/log` hay next-auth.
// Nó được dùng cả ở component hiển thị lẫn ở unit test; kéo Prisma vào đây là
// biến mọi test dùng nó thành test cần DATABASE_URL. Cùng lý do đã tách
// `lost-status-labels.ts` khỏi `lost-status.ts` ở C-06.
import { LEAD_STATUS_LABEL } from "@/lib/leads/status";
import { LEAD_CHILD_STATUS_LABEL } from "./lost-status-labels";

/** Nguồn của lượt đổi trạng thái — để đọc nhật ký không phải đoán tay hay máy. */
export const LEAD_STATUS_TRAIL_SOURCES = [
  "MANUAL",
  "ASSIGN",
  "TRIAL",
  "PAYMENT",
  "CONVERT",
  "IMPORT",
] as const;

export type LeadStatusTrailSource = (typeof LEAD_STATUS_TRAIL_SOURCES)[number];

export const LEAD_STATUS_TRAIL_SOURCE_LABEL: Record<LeadStatusTrailSource, string> = {
  MANUAL: "đổi tay",
  ASSIGN: "khi chia/gán lead",
  TRIAL: "từ buổi học thử",
  PAYMENT: "đã ghi nhận thanh toán",
  CONVERT: "chốt ghi danh",
  IMPORT: "nhập từ Excel",
};

/**
 * Hai chuỗi `action` mà một lượt đổi trạng thái có thể mang trong `AuditLog`.
 *
 * `logLeadAudit` sinh `"lead.status_change"`; `lib/crm/convert-lead*.ts` ghi
 * thẳng bằng `writeAudit` nên ra `"STATUS_CHANGE"` TRẦN. Dùng để THU HẸP truy
 * vấn — không đủ để kết luận (xem `isLeadStatusTrailRow`).
 */
export const LEAD_STATUS_TRAIL_ACTIONS = ["lead.status_change", "STATUS_CHANGE"] as const;

/** Ô mang trạng thái trong vết: phiếu dùng `status`, con dùng `childStatus`. */
export const LEAD_STATUS_FIELD = "status";
export const LEAD_CHILD_STATUS_FIELD = "childStatus";
/** Khoá phụ mang nguồn — CỐ Ý không nằm trong `changedFields` (không phải ô bị đổi). */
export const LEAD_STATUS_SOURCE_KEY = "statusSource";

export type LeadStatusChange = {
  /** Trạng thái trước lượt đổi. `null` khi chưa từng có (bản ghi mới). */
  from: string | null;
  to: string;
  source: LeadStatusTrailSource;
  /** Có mặt = đổi trạng thái CON (C-06), không phải trạng thái phiếu. */
  child?: { id: string; fullName: string } | null;
  reason?: string | null;
  /** Ô phụ ghi kèm cùng lượt (vd `lostNote`). */
  extra?: Record<string, unknown> | null;
  /** Ô phụ nào được tính là "đã đổi" (hiện cũ → mới trên màn hình). */
  extraChangedFields?: readonly string[];
};

/** Nhãn tiếng Việt của một giá trị trạng thái (phiếu hoặc con). */
export function leadStatusTrailLabel(value: string | null, isChild: boolean): string | null {
  if (!value) return null;
  const bang = isChild ? LEAD_CHILD_STATUS_LABEL : LEAD_STATUS_LABEL;
  return (bang as Record<string, string>)[value] ?? value;
}

/** Gói `oldValues`/`newValues`/`changedFields` của một lượt đổi trạng thái. */
export function leadStatusTrailAudit(c: LeadStatusChange): {
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedFields: string[];
} {
  const field = c.child ? LEAD_CHILD_STATUS_FIELD : LEAD_STATUS_FIELD;
  // Tên + mã con đi kèm CẢ hai phía: C-06 ghi lý do ở cấp phụ huynh (bị đứa sau
  // đè), nên chỉ còn vết này lần ra được lý do thuộc về đứa nào.
  const dinhDanhCon = c.child ? { leadChildId: c.child.id, childName: c.child.fullName } : {};

  return {
    oldValues: { [field]: c.from, ...dinhDanhCon },
    newValues: {
      [field]: c.to,
      ...dinhDanhCon,
      [LEAD_STATUS_SOURCE_KEY]: c.source,
      ...(c.extra ?? {}),
    },
    changedFields: [field, ...(c.extraChangedFields ?? [])],
  };
}

/** Câu tiếng Việt cho dòng timeline (`LeadActivity.content`). */
export function leadStatusTrailContent(c: LeadStatusChange): string {
  const isChild = Boolean(c.child);
  const cu = leadStatusTrailLabel(c.from, isChild) ?? "chưa có";
  const moi = leadStatusTrailLabel(c.to, isChild) ?? c.to;
  const dau = c.child ? `Học sinh ${c.child.fullName}` : "Chuyển trạng thái";
  // Đổi tay thì người đọc đã biết là tay (có tên người ngay cạnh) — thêm chữ chỉ
  // làm dòng dài ra.
  const nguon = c.source === "MANUAL" ? "" : ` (${LEAD_STATUS_TRAIL_SOURCE_LABEL[c.source]})`;
  const lyDo = c.reason?.trim() ? ` — lý do: ${c.reason.trim()}` : "";
  return `${dau}: ${cu} → ${moi}${nguon}${lyDo}`;
}

/** `LeadActivity.metadata`. Giữ nguyên khoá `from`/`to` mà timeline cũ đã dùng. */
export function leadStatusTrailMetadata(c: LeadStatusChange): Record<string, unknown> {
  return {
    from: c.from,
    to: c.to,
    source: c.source,
    auto: c.source !== "MANUAL",
    ...(c.child ? { leadChildId: c.child.id } : {}),
  };
}

// ─── Đường ĐỌC: gạn mốc trạng thái ra khỏi nhật ký của lead ──────────────────

/** Đúng hình dạng dòng mà `getLeadAuditHistory` trả ra (khai cấu trúc, không import chéo). */
type AuditRowLike = {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  changedFields: string[];
  reason: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
};

export type LeadStatusTrailRow = {
  id: string;
  createdAt: string;
  actorName: string;
  from: string | null;
  to: string;
  fromLabel: string | null;
  toLabel: string;
  /** Mốc của TRẠNG THÁI CON (C-06) chứ không phải của phiếu. */
  isChild: boolean;
  childName: string | null;
  sourceLabel: string | null;
  reason: string | null;
};

function docTrangThai(
  v: Record<string, unknown> | null,
): { value: string; isChild: boolean } | null {
  if (!v) return null;
  const con = v[LEAD_CHILD_STATUS_FIELD];
  if (typeof con === "string" && con !== "") return { value: con, isChild: true };
  const phieu = v[LEAD_STATUS_FIELD];
  if (typeof phieu === "string" && phieu !== "") return { value: phieu, isChild: false };
  return null;
}

/**
 * Dòng nhật ký này có phải một lượt ĐỔI TRẠNG THÁI không.
 *
 * ⚠️ CỐ Ý KHÔNG lọc theo `action`. Hai lý do, cả hai đều đã cắn:
 *  - `lib/crm/handover.ts` ghi action `"STATUS_CHANGE"` cho lượt bàn giao HO→CS
 *    (đổi `centerId`/`handedAt`, KHÔNG đổi trạng thái) ⇒ lọc theo action là kéo
 *    nhầm nó vào bảng mốc.
 *  - `lib/crm/convert-lead*.ts` ghi qua `writeAudit` với action `"STATUS_CHANGE"`
 *    trần, còn `logLeadAudit` sinh `"lead.status_change"` ⇒ lọc theo một chuỗi
 *    thì mất một nửa.
 * Thứ luôn đúng là: có giá trị trạng thái MỚI trong vết.
 */
export function isLeadStatusTrailRow(row: AuditRowLike): boolean {
  return docTrangThai(row.newValues) !== null;
}

/** Bảng "mốc trạng thái" của trang chi tiết lead — giữ nguyên thứ tự đầu vào. */
export function selectLeadStatusTrail(rows: readonly AuditRowLike[]): LeadStatusTrailRow[] {
  const out: LeadStatusTrailRow[] = [];
  for (const r of rows) {
    const moi = docTrangThai(r.newValues);
    if (!moi) continue;
    const cu = docTrangThai(r.oldValues);
    const nguon = r.newValues?.[LEAD_STATUS_SOURCE_KEY];
    const ten = r.newValues?.childName ?? r.oldValues?.childName;
    out.push({
      id: r.id,
      createdAt: r.createdAt,
      actorName: r.actorName,
      from: cu?.value ?? null,
      to: moi.value,
      fromLabel: leadStatusTrailLabel(cu?.value ?? null, moi.isChild),
      toLabel: leadStatusTrailLabel(moi.value, moi.isChild) ?? moi.value,
      isChild: moi.isChild,
      // Giá trị đã đi qua `maskLeadAuditValues` ở tầng trên — dùng NGUYÊN cái
      // nhận được, đừng đọc lại nguồn khác kẻo bày lại đúng thứ vừa che.
      childName: typeof ten === "string" && ten !== "" ? ten : null,
      sourceLabel:
        typeof nguon === "string" && nguon in LEAD_STATUS_TRAIL_SOURCE_LABEL
          ? LEAD_STATUS_TRAIL_SOURCE_LABEL[nguon as LeadStatusTrailSource]
          : null,
      reason: r.reason,
    });
  }
  return out;
}
