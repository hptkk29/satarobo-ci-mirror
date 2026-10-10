// #05 freeze-legacy — ĐỌC 5 bảng audit cũ (chỉ đọc, không bao giờ ghi).
//
// Từ 09/07/2026 các helper trong lib/audit/log.ts ghi thẳng vào `AuditLog` hợp nhất.
// 5 bảng dưới đây đóng băng, giữ lại dữ liệu lịch sử và chỉ phục vụ tab "Lịch sử cũ".
//
// ⚠️ Chúng KHÔNG có cột `orgUnitId`/`centerId` ⇒ không thể lọc theo cơ sở như viewer hợp
// nhất (`queryUnifiedAuditLogs` lọc `orgUnitId IN visibleOrgUnitIds`). Muốn scope phải
// join ngược về Lead/Class/Student — đắt và vẫn sai với bản ghi đã xoá cứng. Vì vậy tab
// này giới hạn cho SUPER_ADMIN / HO-level; QL cơ sở KHÔNG được xem (câu 13 BGĐ: mỗi
// người chỉ xem cơ sở mình — thà không cho xem còn hơn cho xem nhầm cơ sở khác).
//
// Plan #05 bước 4: "KHÔNG merge 2 nguồn trong 1 query" → đọc từng bảng rồi trộn ở bộ nhớ.
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { maskAuditValues } from "@/lib/audit/audit-log";

export type LegacyAuditSource = "user" | "grant" | "lead" | "class" | "student";

export type LegacyAuditRow = {
  id: string;
  source: LegacyAuditSource;
  entityId: string;
  action: string;
  actorName: string;
  reason: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: Date;
};

/**
 * Bảng cũ KHÔNG có orgUnitId → all-or-nothing. Vá 24/07: gate theo QUYỀN audit thật —
 * SUPER_ADMIN hoặc có `audit-logs:view` centerScope "ALL" (role HO có chức năng audit).
 * `isHoLevel` trần KHÔNG đủ: người kiêm role HO khác chức năng (vd TRAINING@HO + CM@CS1)
 * sẽ thấy log mọi cơ sở dù quyền audit chỉ gắn CS1 → nhóm này MẤT legacy viewer
 * (chấp nhận — dữ liệu đóng băng từ 09/07, cần thì SUPER_ADMIN tra).
 */
export function canReadLegacyAudit(actor: Actor): boolean {
  if (actor.isSuperAdmin) return true;
  return actor.permissions.some(
    (p) => p.action === "audit-logs:view" && p.centerScope === "ALL",
  );
}

/**
 * Đồng bộ vá 24/07: unmask PII legacy (all-or-nothing) cần `audit-logs:view-pii`
 * tầm "ALL" — cờ checkPermission phẳng có thể true nhờ perm chỉ gắn ở 1 cơ sở.
 */
export function canViewLegacyPii(actor: Actor): boolean {
  if (actor.isSuperAdmin) return true;
  return actor.permissions.some(
    (p) => p.action === "audit-logs:view-pii" && p.centerScope === "ALL",
  );
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Trộn 5 nguồn, sắp giảm dần theo thời gian, cắt `take` dòng. PII mask mặc định —
 * cùng quy tắc với viewer hợp nhất (câu 13: ai cũng thấy mask).
 */
export async function queryLegacyAuditLogs(
  actor: Actor,
  opts: { take?: number; canViewPii?: boolean } = {},
): Promise<LegacyAuditRow[]> {
  if (!canReadLegacyAudit(actor)) return [];
  const take = opts.take ?? 50;
  const canViewPii = opts.canViewPii ?? false;
  const order = { createdAt: "desc" } as const;

  const [users, grants, leads, classes, students] = await Promise.all([
    db.userAuditLog.findMany({ orderBy: order, take }),
    db.permissionGrantAuditLog.findMany({ orderBy: order, take }),
    db.leadAuditLog.findMany({ orderBy: order, take }),
    db.classAuditLog.findMany({ orderBy: order, take }),
    db.studentAuditLog.findMany({ orderBy: order, take }),
  ]);

  const rows: LegacyAuditRow[] = [
    ...users.map((r) => ({
      id: r.id, source: "user" as const, entityId: r.userId, action: r.action,
      actorName: r.changedByName, reason: r.reason,
      oldValues: asRecord(r.oldValues), newValues: asRecord(r.newValues), createdAt: r.createdAt,
    })),
    ...grants.map((r) => ({
      id: r.id, source: "grant" as const, entityId: r.userId, action: r.action,
      actorName: r.changedByName, reason: r.reason,
      oldValues: { grant: r.oldGrant }, newValues: { actionKey: r.actionKey, grant: r.newGrant },
      createdAt: r.createdAt,
    })),
    ...leads.map((r) => ({
      id: r.id, source: "lead" as const, entityId: r.leadId, action: r.action,
      actorName: r.changedByName, reason: r.reason,
      oldValues: asRecord(r.oldValues), newValues: asRecord(r.newValues), createdAt: r.createdAt,
    })),
    ...classes.map((r) => ({
      id: r.id, source: "class" as const, entityId: r.classId, action: r.action,
      actorName: r.changedByName, reason: r.reason,
      oldValues: asRecord(r.oldValues), newValues: asRecord(r.newValues), createdAt: r.createdAt,
    })),
    ...students.map((r) => ({
      id: r.id, source: "student" as const, entityId: r.studentId, action: r.action,
      actorName: r.changedByName, reason: r.reason,
      oldValues: asRecord(r.oldValues), newValues: asRecord(r.newValues), createdAt: r.createdAt,
    })),
  ];

  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, take)
    .map((r) => ({
      ...r,
      oldValues: maskAuditValues(r.oldValues, canViewPii),
      newValues: maskAuditValues(r.newValues, canViewPii),
    }));
}
