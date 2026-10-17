// lib/audit/audit-log.ts — A0-06: AuditLog HỢP NHẤT (Doc 15 §8.1).
// writeAudit (immutable — KHÔNG có update/delete), mask PII theo quyền, scope viewer
// theo orgUnit. KHÔNG gọi headers() → dùng được ngoài request (test/cron); ip/UA truyền vào.
import type { Prisma, PrismaClient, AuditLog } from "@prisma/client";
import { db } from "@/lib/db";
import { detectChangedFields } from "@/lib/audit/diff";
import type { Actor } from "@/lib/auth/actor";
import { DUAL_WRITE_MODELS } from "@/lib/org/center-bridge";

type TxClient = Prisma.TransactionClient;

/** Actor tối thiểu cho audit (id+name); System → actorId null. */
export type AuditActor = { id: string | null; name: string };

/**
 * Chuẩn hoá `orgUnitId` của audit — nhận CẢ `OrgUnit.id` LẪN `Center.id`.
 *
 * VÌ SAO CẦN. Đường ĐỌC lọc `orgUnitId IN visibleOrgUnitIds`, mà danh sách đó
 * toàn `OrgUnit.id` thật. Dòng nào lỡ mang `Center.id` sẽ KHÔNG BAO GIỜ khớp ⇒
 * vô hình với actor cấp cơ sở, im lặng, không lỗi. Đo trên DB dev ngày 12/08:
 * 246/369 dòng (67%) đang như vậy — tập trung ở enrollment (145) và finance (93),
 * đúng hai module mà nhật ký là thứ đáng tin cậy nhất phải có.
 *
 * VÌ SAO VÁ Ở ĐÂY, KHÔNG PHẢI Ở 47 CHỖ GỌI. Sửa từng chỗ thì chỗ thứ 48 lại sai và
 * không có gì chặn — hai ID đều là chuỗi cuid, nhìn không phân biệt được. Chặn ở
 * biên thì mọi đường ghi audit đều đúng, kể cả đường viết sau này.
 *
 * MỘT truy vấn cho cả hai khả năng: `OrgUnit.centerId` là @unique nên `id = x OR
 * centerId = x` không thể khớp nhầm nhau.
 *
 * Không tìm thấy thì trả `null` chứ KHÔNG ném: audit là việc phụ, không được phép
 * làm hỏng nghiệp vụ đang chạy.
 */
export async function resolveAuditOrgUnitId(
  client: PrismaClient | TxClient,
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;
  try {
    const ou = await client.orgUnit.findFirst({
      where: { OR: [{ id }, { centerId: id }], deletedAt: null },
      select: { id: true },
    });
    return ou?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Suy `orgUnitId` từ CHÍNH thực thể đang được ghi nhật ký.
 *
 * VÌ SAO CẦN. Vá ở `resolveAuditOrgUnitId` mới lo được các chỗ TRUYỀN NHẦM loại ID.
 * Còn một nửa nữa: nhiều chỗ ghi KHÔNG truyền gì cả. Đo trên prod sau khi vá phần
 * một: 290/538 dòng vẫn `orgUnitId = null` ⇒ vẫn vô hình với quản lý cơ sở.
 *
 * Bóc ra thì KHÔNG phải tất cả đều sai — 81 dòng đúng là null vì `curriculum` /
 * `course-package` / `scorm` / `settings` là dữ liệu TOÀN HỆ THỐNG (thực thể của
 * chúng không có cột `centerId` nào). 209 dòng còn lại thì sai: classes (138),
 * attendance (49), employees (15)… đều suy được mà bỏ trống.
 *
 * `writeAudit` vốn đã nhận `entityType` + `entityId`, nên biên tự tra được — không
 * cần sửa 20 chỗ gọi, và chỗ gọi mới sau này cũng tự đúng.
 *
 * `DUAL_WRITE_MODELS` là cổng chặn: chỉ tra những model THẬT SỰ có cặp cột
 * centerId/orgUnitId. Nhờ vậy dữ liệu toàn hệ thống không bị tra bừa, và `null` ở
 * đó giữ đúng nghĩa "không thuộc cơ sở nào" thay vì "quên điền".
 *
 * Nuốt mọi lỗi → `null`: audit là việc phụ, không được phép làm hỏng nghiệp vụ.
 */
export async function resolveAuditOrgUnitIdFromEntity(
  client: PrismaClient | TxClient,
  entityType: string,
  entityId: string,
): Promise<string | null> {
  if (!entityType || !entityId) return null;
  if (!DUAL_WRITE_MODELS.has(entityType)) return null;
  // Tên model → accessor của Prisma Client: chỉ khác chữ cái đầu.
  const key = entityType.charAt(0).toLowerCase() + entityType.slice(1);
  try {
    const model = (client as unknown as Record<string, unknown>)[key] as
      | { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> }
      | undefined;
    if (!model?.findUnique) return null;
    const row = await model.findUnique({
      where: { id: entityId },
      select: { orgUnitId: true, centerId: true },
    });
    if (!row) return null;
    const direct = row.orgUnitId;
    if (typeof direct === "string" && direct) return direct;
    // Chưa kịp ghi kép (đường SQL thô) → bắc cầu từ centerId.
    const center = row.centerId;
    return typeof center === "string" && center
      ? await resolveAuditOrgUnitId(client, center)
      : null;
  } catch {
    return null;
  }
}

export async function writeAudit(params: {
  actor: AuditActor;
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  changedFields?: string[];
  reason?: string;
  orgUnitId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  tx?: TxClient;
}): Promise<AuditLog> {
  const client: PrismaClient | TxClient = params.tx ?? db;
  const changedFields =
    params.changedFields ??
    (params.oldValues || params.newValues
      ? detectChangedFields(
          (params.oldValues ?? {}) as Record<string, unknown>,
          (params.newValues ?? {}) as Record<string, unknown>,
        )
      : []);
  return client.auditLog.create({
    data: {
      actorId: params.actor.id,
      actorName: params.actor.name,
      module: params.module,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      oldValues: (params.oldValues ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      newValues: (params.newValues ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      changedFields,
      reason: params.reason ?? null,
      // Hai tầng: (1) chuẩn hoá thứ chỗ gọi đưa vào — có thể là Center.id;
      // (2) chỗ gọi không đưa gì thì tự suy từ chính thực thể.
      orgUnitId:
        (await resolveAuditOrgUnitId(client, params.orgUnitId)) ??
        (await resolveAuditOrgUnitIdFromEntity(
          client,
          params.entityType,
          params.entityId,
        )),
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
}

// ─── Mask PII ───────────────────────────────────────────────────────────────
// AUTH-SĐT P0 §3.7 — thêm identifier|target|username|otp: khi SĐT thành khoá
// đăng nhập, PII bắt đầu đi qua những tên field này (`identifier` ở loginSchema,
// `target` ở OtpRequest/OtpDeliveryLog) mà regex cũ không khớp — tức lọt nguyên
// văn vào oldValues/newValues của audit.
const PII_KEY_RE =
  /(phone|sdt|mobile|email|tel|identifier|target|username|otp)/i;

function maskValue(v: unknown): unknown {
  if (typeof v !== "string" || v.length === 0) return v;
  if (v.includes("@")) {
    const [u, d] = v.split("@");
    return `${(u ?? "").slice(0, 2)}***@${d ?? ""}`;
  }
  return v.length <= 4 ? "***" : `${v.slice(0, 2)}***${v.slice(-2)}`;
}

/** Mask field PII (SĐT/email) trong object nếu actor KHÔNG có quyền xem PII. */
export function maskAuditValues(
  values: Record<string, unknown> | null | undefined,
  canViewPii: boolean,
): Record<string, unknown> | null {
  if (!values) return null;
  if (canViewPii) return values;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = PII_KEY_RE.test(k) ? maskValue(v) : v;
  }
  return out;
}

// ─── Scoped viewer query ──────────────────────────────────────────────────────
/**
 * orgUnitId actor được xem log — scope theo QUYỀN audit thật (vá 24/07: trước đây
 * `isHoLevel → ALL` làm người kiêm role HO KHÁC chức năng — vd TRAINING@HO + CM@CS1 —
 * thấy audit MỌI cơ sở dù quyền `audit-logs:*` chỉ gắn ở CS1):
 * - SUPER_ADMIN → "ALL".
 * - Có entry `audit-logs:*` centerScope "ALL" (role HO/ROOT có chức năng audit) → "ALL".
 * - Có entry `audit-logs:*` gắn ở cơ sở → union orgUnitId của các entry đó.
 * - Không có entry nào (vd vào viewer qua per-user grant) → org của role mình (như cũ).
 */
export function visibleOrgUnitIds(actor: Actor): string[] | "ALL" {
  if (actor.isSuperAdmin) return "ALL";
  const auditPerms = actor.permissions.filter((p) =>
    p.action.startsWith("audit-logs:"),
  );
  if (auditPerms.some((p) => p.centerScope === "ALL")) return "ALL";
  if (auditPerms.length > 0) {
    return [...new Set(auditPerms.map((p) => p.orgUnitId))];
  }
  return [...new Set(actor.orgRoles.map((r) => r.orgUnitId))];
}

export async function getAuditLogsScoped(
  actor: Actor,
  opts: { entityType?: string; module?: string; take?: number } = {},
): Promise<AuditLog[]> {
  const scope = visibleOrgUnitIds(actor);
  const where: Prisma.AuditLogWhereInput = {
    ...(opts.entityType ? { entityType: opts.entityType } : {}),
    ...(opts.module ? { module: opts.module } : {}),
    ...(scope === "ALL" ? {} : { orgUnitId: { in: scope } }),
  };
  return db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 100,
  });
}

// ─── #05 — Viewer hợp nhất (filter + cursor + mask mặc định + break-glass) ─────
// Query chính của trang /admin/audit-log: đọc bảng AuditLog HỢP NHẤT (KHÔNG 5 bảng
// legacy), lọc orgUnitId theo actor (câu 13 BGĐ: mỗi người chỉ xem cơ sở mình),
// mask PII (SĐT/email) mặc định cho MỌI người. Bản UNMASK chỉ trả khi caller đã
// verify quyền `audit-logs:view-pii` (break-glass) ở tầng server action.

export type UnifiedAuditFilters = {
  dateFrom?: string;
  dateTo?: string;
  actorId?: string;
  action?: string;
  module?: string;
  /** Tìm trong entityType + entityId. */
  entitySearch?: string;
  /** Tìm trong reason. */
  freeText?: string;
};

export type UnifiedAuditRow = {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string;
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  changedFields: string[];
  reason: string | null;
  orgUnitId: string | null;
  ip: string | null;
  userAgent: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  /** true = PII đã che (mặc định); false = đã break-glass mở đầy đủ cho phiên xem. */
  piiMasked: boolean;
};

export const UNIFIED_AUDIT_PAGE_SIZE = 20;

function encodeAuditCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ c: createdAt.toISOString(), i: id }),
  ).toString("base64");
}

function decodeAuditCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  try {
    const d = JSON.parse(Buffer.from(cursor, "base64").toString()) as {
      c: string;
      i: string;
    };
    return { createdAt: new Date(d.c), id: d.i };
  } catch {
    return null;
  }
}

function buildUnifiedAuditWhere(
  scope: string[] | "ALL",
  filters: UnifiedAuditFilters,
): Prisma.AuditLogWhereInput {
  const AND: Prisma.AuditLogWhereInput[] = [];
  if (scope !== "ALL") AND.push({ orgUnitId: { in: scope } });
  if (filters.dateFrom)
    AND.push({ createdAt: { gte: new Date(filters.dateFrom) } });
  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    to.setHours(23, 59, 59, 999);
    AND.push({ createdAt: { lte: to } });
  }
  if (filters.actorId) AND.push({ actorId: filters.actorId });
  if (filters.action) AND.push({ action: filters.action });
  if (filters.module) AND.push({ module: filters.module });
  if (filters.entitySearch) {
    const s = filters.entitySearch.trim();
    AND.push({
      OR: [
        { entityId: { contains: s, mode: "insensitive" } },
        { entityType: { contains: s, mode: "insensitive" } },
      ],
    });
  }
  if (filters.freeText) {
    AND.push({ reason: { contains: filters.freeText, mode: "insensitive" } });
  }
  return AND.length ? { AND } : {};
}

/**
 * Query viewer hợp nhất — scope theo orgUnit của actor + mask PII mặc định.
 * `opts.unmask=true` CHỈ được truyền sau khi server action đã verify quyền
 * `audit-logs:view-pii` (break-glass). Trả cursor keyset (createdAt,id) desc.
 */
export async function queryUnifiedAuditLogs(
  actor: Actor,
  filters: UnifiedAuditFilters,
  cursor: string | null,
  opts: { take?: number; unmask?: boolean } = {},
): Promise<{ items: UnifiedAuditRow[]; nextCursor: string | null }> {
  const scope = visibleOrgUnitIds(actor);
  // Actor center-level nhưng không có org nào nhìn thấy → rỗng (an toàn, không lộ).
  if (scope !== "ALL" && scope.length === 0)
    return { items: [], nextCursor: null };

  const take = opts.take ?? UNIFIED_AUDIT_PAGE_SIZE;
  const baseWhere = buildUnifiedAuditWhere(scope, filters);
  const decoded = cursor ? decodeAuditCursor(cursor) : null;
  const where: Prisma.AuditLogWhereInput = decoded
    ? {
        AND: [
          baseWhere,
          {
            OR: [
              { createdAt: { lt: decoded.createdAt } },
              {
                AND: [
                  { createdAt: decoded.createdAt },
                  { id: { lt: decoded.id } },
                ],
              },
            ],
          },
        ],
      }
    : baseWhere;

  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeAuditCursor(last.createdAt, last.id) : null;

  const unmask = opts.unmask ?? false;
  const items: UnifiedAuditRow[] = page.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    actorId: r.actorId,
    actorName: r.actorName,
    module: r.module,
    entityType: r.entityType,
    entityId: r.entityId,
    action: r.action,
    changedFields: r.changedFields,
    reason: r.reason,
    orgUnitId: r.orgUnitId,
    ip: r.ip,
    userAgent: r.userAgent,
    // maskAuditValues(values, canViewPii): unmask=true → giữ nguyên; false → che.
    oldValues: maskAuditValues(
      r.oldValues as Record<string, unknown> | null,
      unmask,
    ),
    newValues: maskAuditValues(
      r.newValues as Record<string, unknown> | null,
      unmask,
    ),
    piiMasked: !unmask,
  }));

  return { items, nextCursor };
}

/**
 * Ghi log RIÊNG mỗi lần break-glass mở PII (câu 13 BGĐ: ai – lúc nào – lý do gì).
 * Immutable như mọi AuditLog. Caller PHẢI verify quyền `audit-logs:view-pii` +
 * validate reason (>=10 ký tự) TRƯỚC khi gọi.
 */
export async function recordPiiUnmask(
  actor: AuditActor,
  reason: string,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<AuditLog> {
  return writeAudit({
    actor,
    module: "audit",
    entityType: "AuditLog",
    entityId: "*",
    action: "audit.pii-unmasked",
    reason,
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  });
}
