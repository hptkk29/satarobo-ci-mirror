import type { Prisma, PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import { getRequestMetadata } from "@/lib/audit/headers";
import { writeAudit } from "@/lib/audit/audit-log";

type TxClient = Prisma.TransactionClient;
type DbClient = PrismaClient | TxClient;

// ─── #05 FREEZE-LEGACY (09/07/2026) ──────────────────────────────────────────
// 5 helper dưới đây (user / grant / lead / class / student) TRƯỚC ĐÂY ghi vào 5 bảng
// audit riêng. Không UI nào đọc chúng (chỉ `cleanupOldAuditLogs` prune), trong khi viewer
// hợp nhất `/admin/audit-log` chỉ đọc bảng `AuditLog` ⇒ mọi thao tác trên user/lead/lớp/
// học viên là VÔ HÌNH với người xem log. Nay chuyển sang `writeAudit` (bảng hợp nhất).
//
// Chữ ký helper GIỮ NGUYÊN → 58 call-site không phải sửa. Bảng cũ + dữ liệu cũ giữ lại,
// đọc qua tab "Lịch sử cũ" (read-only). Chưa freeze: paymentMethod/voucher/product
// (cấu hình toàn hệ thống, không có orgUnitId để scope) và rbacAuditLog (audit RBAC
// riêng theo Doc 15, có test a0 phụ thuộc).
//
// ⚠️ `queryUnifiedAuditLogs` lọc `orgUnitId IN visibleOrgUnitIds` ⇒ dòng có orgUnitId=null
// BỊ ẨN với actor cấp cơ sở. Vì vậy mỗi helper phải nạp `orgUnitId` của thực thể.

/** orgUnitId của thực thể, để QL cơ sở nhìn thấy log của cơ sở mình. Null nếu không suy được. */
async function resolveOrgUnitId(
  client: DbClient,
  entity: "user" | "lead" | "class" | "student",
  id: string,
): Promise<string | null> {
  const select = { orgUnitId: true } as const;
  switch (entity) {
    case "user":
      return (await client.user.findUnique({ where: { id }, select }))?.orgUnitId ?? null;
    case "lead":
      return (await client.lead.findUnique({ where: { id }, select }))?.orgUnitId ?? null;
    case "class":
      return (await client.class.findUnique({ where: { id }, select }))?.orgUnitId ?? null;
    case "student":
      return (await client.student.findUnique({ where: { id }, select }))?.orgUnitId ?? null;
  }
}

// ─── USER AUDIT ─────────────────────────────────────────────────────
export type UserAuditAction =
  | "CREATE"
  | "UPDATE"
  | "DISABLE"
  | "ENABLE"
  | "PASSWORD_RESET"
  | "PASSWORD_CHANGE"
  | "ROLE_CHANGE";

export async function logUserAudit(params: {
  userId: string;
  action: UserAuditAction;
  actorId: string | null;
  actorName: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  tx?: TxClient;
}) {
  const metadata = await getRequestMetadata();
  const client: DbClient = params.tx ?? db;
  await writeAudit({
    actor: { id: params.actorId, name: params.actorName },
    module: "users",
    entityType: "User",
    entityId: params.userId,
    action: `user.${params.action.toLowerCase()}`,
    oldValues: params.oldValues,
    newValues: params.newValues,
    changedFields: params.changedFields,
    reason: params.reason,
    orgUnitId: await resolveOrgUnitId(client, "user", params.userId),
    ip: metadata.ip ?? null,
    userAgent: metadata.userAgent ?? null,
    tx: params.tx,
  });
}

// ─── PERMISSION GRANT AUDIT ─────────────────────────────────────────
export type PermissionGrantAuditAction = "ADD" | "UPDATE" | "REMOVE";

export async function logGrantAudit(params: {
  userId: string;
  grantId?: string | null;
  actionKey: string;
  action: PermissionGrantAuditAction;
  actorId: string | null;
  actorName: string;
  oldGrant?: "ALLOW" | "DENY" | null;
  newGrant?: "ALLOW" | "DENY" | null;
  reason?: string;
  tx?: TxClient;
}) {
  const metadata = await getRequestMetadata();
  const client: DbClient = params.tx ?? db;
  // Bảng cũ có cột riêng (grantId/actionKey/oldGrant/newGrant); bảng hợp nhất chỉ có
  // oldValues/newValues → gói vào JSON, KHÔNG mất thông tin. `changedFields` khai tường
  // minh vì grant chỉ đổi đúng 1 trường.
  await writeAudit({
    actor: { id: params.actorId, name: params.actorName },
    module: "permissions",
    entityType: "UserPermissionGrant",
    entityId: params.grantId ?? params.userId,
    action: `grant.${params.action.toLowerCase()}`,
    oldValues: { grant: params.oldGrant ?? null },
    newValues: { userId: params.userId, actionKey: params.actionKey, grant: params.newGrant ?? null },
    changedFields: ["grant"],
    reason: params.reason,
    orgUnitId: await resolveOrgUnitId(client, "user", params.userId),
    ip: metadata.ip ?? null,
    userAgent: metadata.userAgent ?? null,
    tx: params.tx,
  });
}

// ─── LEAD AUDIT ─────────────────────────────────────────────────────
export type LeadAuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "ASSIGN"
  | "STATUS_CHANGE";

export async function logLeadAudit(params: {
  leadId: string;
  action: LeadAuditAction;
  actorId: string | null;
  actorName: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  tx?: TxClient;
}) {
  const metadata = await getRequestMetadata();
  const client: DbClient = params.tx ?? db;
  await writeAudit({
    actor: { id: params.actorId, name: params.actorName },
    module: "leads",
    entityType: "Lead",
    entityId: params.leadId,
    action: `lead.${params.action.toLowerCase()}`,
    oldValues: params.oldValues,
    newValues: params.newValues,
    changedFields: params.changedFields,
    reason: params.reason,
    orgUnitId: await resolveOrgUnitId(client, "lead", params.leadId),
    ip: metadata.ip ?? null,
    userAgent: metadata.userAgent ?? null,
    tx: params.tx,
  });
}

// ─── CLASS AUDIT ────────────────────────────────────────────────────
export type ClassAuditAction = "CREATE" | "UPDATE" | "DELETE";

export async function logClassAudit(params: {
  classId: string;
  action: ClassAuditAction;
  actorId: string | null;
  actorName: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  tx?: TxClient;
}) {
  const metadata = await getRequestMetadata();
  const client: DbClient = params.tx ?? db;
  await writeAudit({
    actor: { id: params.actorId, name: params.actorName },
    module: "classes",
    entityType: "Class",
    entityId: params.classId,
    action: `class.${params.action.toLowerCase()}`,
    oldValues: params.oldValues,
    newValues: params.newValues,
    changedFields: params.changedFields,
    reason: params.reason,
    orgUnitId: await resolveOrgUnitId(client, "class", params.classId),
    ip: metadata.ip ?? null,
    userAgent: metadata.userAgent ?? null,
    tx: params.tx,
  });
}

// ─── STUDENT AUDIT ──────────────────────────────────────────────────
export type StudentAuditAction = "CREATE" | "UPDATE" | "DELETE";

export async function logStudentAudit(params: {
  studentId: string;
  action: StudentAuditAction;
  actorId: string | null;
  actorName: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  tx?: TxClient;
}) {
  const metadata = await getRequestMetadata();
  const client: DbClient = params.tx ?? db;
  await writeAudit({
    actor: { id: params.actorId, name: params.actorName },
    module: "students",
    entityType: "Student",
    entityId: params.studentId,
    action: `student.${params.action.toLowerCase()}`,
    oldValues: params.oldValues,
    newValues: params.newValues,
    changedFields: params.changedFields,
    reason: params.reason,
    orgUnitId: await resolveOrgUnitId(client, "student", params.studentId),
    ip: metadata.ip ?? null,
    userAgent: metadata.userAgent ?? null,
    tx: params.tx,
  });
}

// ─── PAYMENT METHOD AUDIT ───────────────────────────────────────────
export type PaymentMethodAuditAction =
  | "CREATE"
  | "UPDATE"
  | "ENABLE"
  | "DISABLE";

export async function logPaymentMethodAudit(params: {
  paymentMethodId: string;
  action: PaymentMethodAuditAction;
  actorId: string | null;
  actorName: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  tx?: TxClient;
}) {
  const metadata = await getRequestMetadata();
  const client: DbClient = params.tx ?? db;
  await client.paymentMethodAuditLog.create({
    data: {
      paymentMethodId: params.paymentMethodId,
      action: params.action,
      changedByUserId: params.actorId ?? null,
      changedByName: params.actorName,
      oldValues: params.oldValues as Prisma.InputJsonValue | undefined,
      newValues: params.newValues as Prisma.InputJsonValue | undefined,
      changedFields: params.changedFields ?? [],
      reason: params.reason ?? null,
      metadata: metadata as unknown as Prisma.InputJsonValue,
    },
  });
}

// ─── VOUCHER AUDIT ──────────────────────────────────────────────────
export type VoucherAuditAction = "CREATE" | "UPDATE" | "ENABLE" | "DISABLE";

export async function logVoucherAudit(params: {
  voucherId: string;
  action: VoucherAuditAction;
  actorId: string | null;
  actorName: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  tx?: TxClient;
}) {
  const metadata = await getRequestMetadata();
  const client: DbClient = params.tx ?? db;
  await client.voucherAuditLog.create({
    data: {
      voucherId: params.voucherId,
      action: params.action,
      changedByUserId: params.actorId ?? null,
      changedByName: params.actorName,
      oldValues: params.oldValues as Prisma.InputJsonValue | undefined,
      newValues: params.newValues as Prisma.InputJsonValue | undefined,
      changedFields: params.changedFields ?? [],
      reason: params.reason ?? null,
      metadata: metadata as unknown as Prisma.InputJsonValue,
    },
  });
}

// ─── PRODUCT AUDIT ──────────────────────────────────────────────────
export type ProductAuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "STATUS_CHANGE";

export async function logProductAudit(params: {
  productId: string;
  action: ProductAuditAction;
  actorId: string | null;
  actorName: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  reason?: string;
  tx?: TxClient;
}) {
  const client: DbClient = params.tx ?? db;
  await client.productAuditLog.create({
    data: {
      productId: params.productId,
      action: params.action,
      changedByUserId: params.actorId ?? null,
      changedByName: params.actorName,
      oldValues: params.oldValues as Prisma.InputJsonValue | undefined,
      newValues: params.newValues as Prisma.InputJsonValue | undefined,
      changedFields: params.changedFields ?? [],
      reason: params.reason ?? null,
    },
  });
}

// ─── RBAC AUDIT (A0-02) ─────────────────────────────────────────────
// KHÔNG gọi getRequestMetadata() → dùng được cả ngoài request context
// (service test). Metadata truyền tường minh nếu cần.
export type RbacAuditEntity = "ROLE" | "PERMISSION" | "ASSIGNMENT";
export type RbacAuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "ASSIGN"
  | "REVOKE";

export async function logRbacAudit(params: {
  entity: RbacAuditEntity;
  entityId: string;
  action: RbacAuditAction;
  actorId: string | null;
  actorName: string;
  reason: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tx?: TxClient;
}) {
  const client: DbClient = params.tx ?? db;
  await client.rbacAuditLog.create({
    data: {
      entity: params.entity,
      entityId: params.entityId,
      action: params.action,
      changedByUserId: params.actorId ?? null,
      changedByName: params.actorName,
      oldValues: params.oldValues as Prisma.InputJsonValue | undefined,
      newValues: params.newValues as Prisma.InputJsonValue | undefined,
      reason: params.reason,
      metadata: params.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

// ─── UTILITY: detect changed fields ─────────────────────────────────
// Chuyển sang leaf lib/audit/diff.ts để cắt vòng import (audit-log.ts ↔ log.ts).
// Re-export giữ nguyên đường import cũ `@/lib/audit/log` cho các consumer.
export { detectChangedFields } from "@/lib/audit/diff";

// ─── UTILITY: extract actor info from session ───────────────────────
/**
 * Extract actor info from NextAuth session. Returns "System" when no
 * session (background jobs / system actions).
 */
export function getAuditActor(session: Session | null | undefined): {
  actorId: string | null;
  actorName: string;
} {
  if (!session?.user) {
    return { actorId: null, actorName: "System" };
  }
  return {
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? session.user.id,
  };
}
