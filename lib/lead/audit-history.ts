// lib/lead/audit-history.ts — V-6 · G-02: đọc VẾT SỬA của đúng MỘT lead.
//
// Spec G-02 đòi 3 ô định danh (Tên PH · SĐT PH · Tên HS) sửa được nhưng phải ghi
// vết "ai sửa, lúc nào, cũ → mới", và vết đó "hiển thị ở trang chi tiết lead".
// Vết đã có (bảng `AuditLog` hợp nhất), nhưng trình xem duy nhất là
// `/admin/audit-log` — gác sau `audit-logs:view`, quyền mà CHỈ SUPER_ADMIN giữ
// (v1 `lib/auth/permissions.ts`; v2 `prisma/seed-roles.ts` chỉ còn đoạn chú thích
// "#05 QL cơ sở xem audit log", dòng RolePermission thì không còn). Tức QLCS —
// đúng người phải soi xem sale có sửa trộm tên/SĐT khách hay không — không xem
// được gì.
//
// ⚠️ VÌ SAO KHÔNG VÁ BẰNG CÁCH CẤP `audit-logs:view` CHO QLCS.
// `AuditLog` KHÔNG nằm trong `SCOPED_MODELS` ⇒ `scopedDb` không lọc hộ dòng nào;
// và `audit-logs:*` được chấm KHÔNG kèm target (xem chú thích trong seed-roles),
// nên nó phải mang scope GLOBAL để có tác dụng. Cấp quyền đó = mở nhật ký TOÀN
// HỆ (nhân sự, tiền, lương, RBAC…) cho một vai chỉ cần xem vết của một lead.
// Đường vá đúng: một màn HẸP, lọc CỨNG `entityType: "Lead"` + `entityId` của
// chính bản ghi người dùng đang mở, không nhận bộ lọc nào từ người gọi.
//
// Module THUẦN (không import `@/lib/db`, không next-auth): client Prisma truyền
// vào từ chỗ gọi — giống `getLeadPaymentSummary`. Nhờ vậy trang admin vẫn đi qua
// `scopedDb` và file này unit-test được.
import type { scopedDb } from "@/lib/db-scope";
import { maskPersonName, maskPhone, maskEmail, maskFreeText } from "@/lib/lead/pii";
import { LEAD_STATUS_LABEL } from "@/lib/leads/status";
import { LEAD_CHILD_STATUS_LABEL } from "@/lib/lead/lost-status-labels";
import {
  LEAD_CHILD_STATUS_FIELD,
  LEAD_STATUS_FIELD,
  LEAD_STATUS_TRAIL_ACTIONS,
  isLeadStatusTrailRow,
} from "@/lib/lead/status-trail";

/** 3 ô định danh của spec G-02 — chạm vào là phải nổi bật trong vết. */
export const LEAD_IDENTITY_FIELDS = ["parentName", "phone", "childName"] as const;

const IDENTITY_SET = new Set<string>(LEAD_IDENTITY_FIELDS);

/** Mặc định đủ dùng cho một lead; trần chặn ai đó truyền `take` vô hạn. */
export const LEAD_AUDIT_DEFAULT_TAKE = 50;
export const LEAD_AUDIT_MAX_TAKE = 200;

export type LeadAuditRow = {
  id: string;
  /** ISO — đã tuần tự hoá để truyền thẳng xuống client component. */
  createdAt: string;
  actorName: string;
  action: string;
  changedFields: string[];
  reason: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  /** Lượt này có chạm 1 trong 3 ô định danh không. */
  touchesIdentity: boolean;
};

/**
 * Cổng quyền của mục "Lịch sử thay đổi" trên trang chi tiết lead.
 *
 * `leads:view-all` = quản lý cơ sở (QLCS) + SUPER_ADMIN + Marketing Hội sở —
 * đúng tập "người có thẩm quyền" của spec, và CỐ Ý không gồm sale cơ sở: người
 * sửa không được là người duy nhất đọc vết của chính mình.
 *
 * Cố ý KHÔNG đẻ permission key mới: key mới phải seed lại cả hai môi trường
 * (`seed-prod-roles.yml`) trước khi màn này có tác dụng, tức bàn giao xong mà
 * màn vẫn trắng. Cùng lý do đã ghi ở trang chi tiết lead khi tách phần "ghi chú
 * máy ghi" (24/08).
 */
export function canViewLeadAuditHistory(input: {
  canViewAllLeads: boolean;
  canViewAuditLogs: boolean;
}): boolean {
  return input.canViewAllLeads || input.canViewAuditLogs;
}

/** Lượt sửa có chạm ô định danh không (spec G-02). */
export function touchesLeadIdentity(changedFields: readonly string[]): boolean {
  return changedFields.some((f) => IDENTITY_SET.has(f));
}

// ─── Che PII trong chính nội dung vết ────────────────────────────────────────
// `oldValues`/`newValues` chứa nguyên văn tên PH, tên HS, SĐT, email, ghi chú —
// tức đúng bộ PII mà trang chi tiết lead đã che ở mọi chỗ khác theo
// `leads:view-pii` (Q7, Kiệt ký 10/07). Bày vết ra mà quên che là mở lại đúng
// cái cửa vừa đóng, chỉ khác đường đi.
//
// KHÔNG dùng `maskAuditValues` của `lib/audit/audit-log.ts`: regex ở đó chỉ bắt
// phone/email/otp… — `parentName`/`childName` lọt nguyên văn.
const NAME_KEYS = new Set([
  "parentName",
  "childName",
  "fullName",
  // Vết thêm/xoá/sửa con ghi tên con dưới 3 khoá này (xem addLeadChild/
  // updateLeadChild/deleteLeadChild) — che `childName` mà quên chúng là hở.
  "childAdded",
  "childRemoved",
  "childUpdated",
]);
const PHONE_KEYS = new Set(["phone", "parentPhone", "zaloPhone"]);
const EMAIL_KEYS = new Set(["email"]);
const FREE_TEXT_KEYS = new Set(["note", "handoverNote", "content"]);

/** Che PII trong 1 gói giá trị của vết. `canViewPii` = kết quả `canViewLeadPii()`. */
export function maskLeadAuditValues(
  values: Record<string, unknown> | null | undefined,
  canViewPii: boolean,
): Record<string, unknown> | null {
  if (!values) return null;
  if (canViewPii) return values;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== "string" || v === "") {
      out[k] = v;
      continue;
    }
    if (NAME_KEYS.has(k)) out[k] = maskPersonName(v);
    else if (PHONE_KEYS.has(k)) out[k] = maskPhone(v);
    else if (EMAIL_KEYS.has(k)) out[k] = maskEmail(v);
    else if (FREE_TEXT_KEYS.has(k)) out[k] = maskFreeText(v);
    else out[k] = v;
  }
  return out;
}

// ─── Nhãn tiếng Việt ─────────────────────────────────────────────────────────
export const LEAD_AUDIT_FIELD_LABEL: Record<string, string> = {
  parentName: "Tên phụ huynh",
  phone: "SĐT phụ huynh",
  childName: "Tên học sinh",
  email: "Email",
  childAge: "Tuổi học sinh",
  centerId: "Cơ sở",
  orgUnitId: "Đơn vị",
  courseId: "Khoá quan tâm",
  source: "Nguồn lead",
  note: "Ghi chú",
  facebookUrl: "Link Facebook",
  status: "Trạng thái",
  // C-07 — ô trạng thái CON (C-06) + ô phụ đi kèm lượt đánh dấu rớt. Thiếu nhãn
  // thì màn hình in ra `childStatus` / `lostNote` trần.
  childStatus: "Trạng thái học sinh",
  lostNote: "Lý do rớt",
  leadLostCleared: "Đã xoá lý do rớt của phiếu",
  assignedToId: "Sale phụ trách",
  isSharedWithTeam: "Dùng chung với đội",
  children: "Danh sách con",
  childAdded: "Thêm con",
  childRemoved: "Xoá con",
  childUpdated: "Sửa con",
  fullName: "Tên học sinh",
  leadChildId: "Mã con",
};

export const LEAD_AUDIT_ACTION_LABEL: Record<string, string> = {
  "lead.create": "Tạo lead",
  "lead.update": "Sửa thông tin",
  "lead.delete": "Xoá lead",
  "lead.assign": "Chuyển/gán sale",
  "lead.status_change": "Đổi trạng thái",
  // C-07 — `lib/crm/convert-lead*.ts` ghi qua `writeAudit` nên action là chuỗi
  // TRẦN "STATUS_CHANGE" (không có tiền tố `lead.`). Thiếu dòng này thì mốc chốt
  // ghi danh hiện ra dưới dạng mã trần trên màn hình.
  STATUS_CHANGE: "Đổi trạng thái",
};

/** Giá trị trong vết ra chuỗi hiển thị được ("—" cho rỗng). */
export function formatLeadAuditValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Có" : "Không";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

/**
 * Như `formatLeadAuditValue`, nhưng ô trạng thái ra NHÃN TIẾNG VIỆT.
 *
 * C-07: vết đổi trạng thái là thứ QLCS đọc thường xuyên nhất; in `AWAITING_DECISION`
 * ra màn hình thì đúng dữ liệu mà sai người dùng.
 */
export function formatLeadAuditFieldValue(field: string, v: unknown): string {
  if (typeof v === "string" && v !== "") {
    if (field === LEAD_STATUS_FIELD) return LEAD_STATUS_LABEL[v as keyof typeof LEAD_STATUS_LABEL] ?? v;
    if (field === LEAD_CHILD_STATUS_FIELD) {
      return LEAD_CHILD_STATUS_LABEL[v as keyof typeof LEAD_CHILD_STATUS_LABEL] ?? v;
    }
  }
  return formatLeadAuditValue(v);
}

/**
 * Vết của ĐÚNG một lead. `where` cố định trong hàm — không có tham số nào của
 * người gọi lọt vào đó ngoài `leadId`.
 *
 * CỐ Ý KHÔNG lọc thêm `orgUnitId ∈ visibleOrgUnitIds` như viewer hợp nhất: vết
 * cũ có `orgUnitId = null` khá nhiều (đo prod 12/08 — xem `writeAudit`), lọc
 * thêm sẽ làm chúng biến mất im lặng, tức đúng thứ màn này sinh ra để chống.
 * Cách ly cơ sở đã xong TRƯỚC khi gọi hàm này: bản thân lead đọc qua `scopedDb`
 * (Lead ∈ SCOPED_MODELS) + `canSeeLead()`; không xem được lead thì không tới
 * được đây.
 */
export async function getLeadAuditHistory(
  sdb: ReturnType<typeof scopedDb>,
  leadId: string,
  opts: { take?: number } = {},
): Promise<LeadAuditRow[]> {
  const take = Math.min(
    Math.max(1, Math.trunc(opts.take ?? LEAD_AUDIT_DEFAULT_TAKE)),
    LEAD_AUDIT_MAX_TAKE,
  );
  const rows = await sdb.auditLog.findMany({
    where: { entityType: "Lead", entityId: leadId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      createdAt: true,
      actorName: true,
      action: true,
      changedFields: true,
      reason: true,
      oldValues: true,
      newValues: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    actorName: r.actorName,
    action: r.action,
    changedFields: r.changedFields,
    reason: r.reason,
    oldValues: (r.oldValues ?? null) as Record<string, unknown> | null,
    newValues: (r.newValues ?? null) as Record<string, unknown> | null,
    touchesIdentity: touchesLeadIdentity(r.changedFields),
  }));
}

/**
 * C-07 — vết ĐỔI TRẠNG THÁI của đúng một lead, truy vấn RIÊNG.
 *
 * ⚠️ Vì sao không lọc lại từ `getLeadAuditHistory`: hàm đó cắt 50 dòng gần nhất.
 * Một lead bị sửa nhiều (đổi tên, đổi ghi chú, chia lại sale…) sẽ đẩy hết mốc
 * trạng thái ra ngoài 50 dòng đó — đúng lúc cần nhất thì bảng mốc trống trơn.
 *
 * `where` cố định trong hàm, KHÔNG nhận bộ lọc của người gọi (cùng ranh giới với
 * `getLeadAuditHistory`: đây là màn HẸP theo một bản ghi, không phải cửa vào nhật
 * ký chung). Lọc theo `action` chỉ để thu hẹp truy vấn — `lib/crm/handover.ts`
 * cũng ghi `"STATUS_CHANGE"` cho lượt bàn giao KHÔNG đổi trạng thái, nên phải
 * gạn tiếp bằng `isLeadStatusTrailRow` (soi giá trị, không soi action).
 */
export async function getLeadStatusHistory(
  sdb: ReturnType<typeof scopedDb>,
  leadId: string,
  opts: { take?: number } = {},
): Promise<LeadAuditRow[]> {
  const take = Math.min(
    Math.max(1, Math.trunc(opts.take ?? LEAD_AUDIT_DEFAULT_TAKE)),
    LEAD_AUDIT_MAX_TAKE,
  );
  const rows = await sdb.auditLog.findMany({
    where: {
      entityType: "Lead",
      entityId: leadId,
      action: { in: [...LEAD_STATUS_TRAIL_ACTIONS] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      createdAt: true,
      actorName: true,
      action: true,
      changedFields: true,
      reason: true,
      oldValues: true,
      newValues: true,
    },
  });

  return rows
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actorName: r.actorName,
      action: r.action,
      changedFields: r.changedFields,
      reason: r.reason,
      oldValues: (r.oldValues ?? null) as Record<string, unknown> | null,
      newValues: (r.newValues ?? null) as Record<string, unknown> | null,
      touchesIdentity: touchesLeadIdentity(r.changedFields),
    }))
    .filter(isLeadStatusTrailRow);
}
