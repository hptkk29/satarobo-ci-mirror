// lib/org/assignment-service.ts — A0-08: nhân sự/kiêm nhiệm (Doc 15 §2.2, OI-6).
// ⚠️ KHÔNG sinh quyền — quyền CHỈ từ UserOrgRole (A0-02/03). Đây chỉ là dữ liệu nhân sự.
import type { AssignmentType, EmployeeOrgAssignment } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";

export class AssignmentError extends Error {
  readonly code: string;
  readonly field?: string;
  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = "AssignmentError";
    this.code = code;
    this.field = field;
  }
}

/** Assignment còn hiệu lực (THUẦN). */
export function isActiveAssignment(
  a: { status: string; effectiveFrom: Date; effectiveTo: Date | null },
  now = new Date(),
): boolean {
  return (
    a.status === "ACTIVE" &&
    a.effectiveFrom <= now &&
    (a.effectiveTo == null || a.effectiveTo >= now)
  );
}

/** Validate allocationPercent ∈ [0,100] (THUẦN). null = chưa khai (bỏ qua). */
export function validateAllocation(p: number | null | undefined): void {
  if (p == null) return;
  if (!Number.isInteger(p) || p < 0 || p > 100) {
    throw new AssignmentError("ALLOCATION_RANGE", "allocationPercent phải trong [0,100].", "allocationPercent");
  }
}

export type CreateAssignmentInput = {
  employeeId: string;
  orgUnitId: string;
  assignmentType: AssignmentType;
  roleInOrg?: string | null;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  allocationPercent?: number | null;
  reason?: string;
};

export async function createAssignment(
  actor: AuditActor,
  input: CreateAssignmentInput,
): Promise<{ assignment: EmployeeOrgAssignment; warning?: string }> {
  validateAllocation(input.allocationPercent);
  const effectiveFrom = input.effectiveFrom ?? new Date();
  if (input.effectiveTo && input.effectiveTo < effectiveFrom) {
    throw new AssignmentError("EFFECTIVE_RANGE", "effectiveTo phải sau effectiveFrom.", "effectiveTo");
  }

  const org = await db.orgUnit.findUnique({ where: { id: input.orgUnitId } });
  if (!org || org.deletedAt || !org.isActive) {
    throw new AssignmentError("ORG_INVALID", "Đơn vị không tồn tại hoặc đã ngừng hoạt động.", "orgUnitId");
  }

  if (input.assignmentType === "PRIMARY") {
    const now = new Date();
    const primaries = await db.employeeOrgAssignment.findMany({
      where: { employeeId: input.employeeId, assignmentType: "PRIMARY", status: "ACTIVE" },
    });
    if (primaries.some((p) => isActiveAssignment(p, now))) {
      throw new AssignmentError("PRIMARY_EXISTS", "Mỗi nhân viên chỉ có 1 phân công PRIMARY đang hiệu lực.", "assignmentType");
    }
  }

  const assignment = await db.employeeOrgAssignment.create({
    data: {
      employeeId: input.employeeId,
      orgUnitId: input.orgUnitId,
      assignmentType: input.assignmentType,
      roleInOrg: input.roleInOrg ?? null,
      effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      allocationPercent: input.allocationPercent ?? null,
      createdById: actor.id ?? "system",
    },
  });

  await writeAudit({
    actor, module: "employees", entityType: "EmployeeOrgAssignment", entityId: assignment.id,
    action: "CREATE", newValues: { orgUnitId: input.orgUnitId, assignmentType: input.assignmentType },
    reason: input.reason, orgUnitId: input.orgUnitId,
  });

  // Cảnh báo nếu tổng allocation active > 100 (không chặn — OI-10).
  const actives = (
    await db.employeeOrgAssignment.findMany({ where: { employeeId: input.employeeId, status: "ACTIVE" } })
  ).filter((a) => isActiveAssignment(a));
  const total = actives.reduce((s, a) => s + (a.allocationPercent ?? 0), 0);
  const warning = total > 100 ? `Tổng allocationPercent active = ${total} > 100` : undefined;

  return { assignment, warning };
}

export async function updateAssignment(
  actor: AuditActor,
  id: string,
  patch: { status?: "ACTIVE" | "SUSPENDED" | "EXPIRED"; effectiveTo?: Date | null; allocationPercent?: number | null; reason?: string },
): Promise<EmployeeOrgAssignment> {
  const existing = await db.employeeOrgAssignment.findUnique({ where: { id } });
  if (!existing) throw new AssignmentError("NOT_FOUND", "Không tìm thấy phân công.", "id");
  if (patch.allocationPercent !== undefined) validateAllocation(patch.allocationPercent);

  const updated = await db.employeeOrgAssignment.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.effectiveTo !== undefined ? { effectiveTo: patch.effectiveTo } : {}),
      ...(patch.allocationPercent !== undefined ? { allocationPercent: patch.allocationPercent } : {}),
    },
  });
  await writeAudit({
    actor, module: "employees", entityType: "EmployeeOrgAssignment", entityId: id, action: "UPDATE",
    oldValues: { status: existing.status, allocationPercent: existing.allocationPercent },
    newValues: { status: updated.status, allocationPercent: updated.allocationPercent },
    reason: patch.reason, orgUnitId: existing.orgUnitId,
  });
  return updated;
}

/** Phân công còn hiệu lực của 1 nhân viên. */
export async function getActiveAssignments(
  employeeId: string,
  now = new Date(),
): Promise<EmployeeOrgAssignment[]> {
  const rows = await db.employeeOrgAssignment.findMany({ where: { employeeId, status: "ACTIVE" } });
  return rows.filter((a) => isActiveAssignment(a, now));
}

/** NV có assignment active tại orgUnit (OI-6 — nền cho Center Manager quản nhân sự). */
export async function getStaffOfCenter(orgUnitId: string, now = new Date()): Promise<string[]> {
  const rows = await db.employeeOrgAssignment.findMany({ where: { orgUnitId, status: "ACTIVE" } });
  return [...new Set(rows.filter((a) => isActiveAssignment(a, now)).map((a) => a.employeeId))];
}
