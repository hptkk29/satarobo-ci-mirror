// lib/crm/cost-allocation.ts — R1-09: phân bổ chi phí marketing (SR.QD.217).
// CPL/CPA/CP_TT THUẦN (C9.1/C9.2 chia-0 an toàn) + kỳ DRAFT→CONFIRMED→REOPENED (C9.3/C9.4).
import type { MarketingCostPeriod } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";

export class CostError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CostError";
    this.code = code;
  }
}

/** CPL = spend / số L2. Chia 0 → 0 (C9.2). THUẦN. */
export function computeCpl(spend: number, l2Count: number): number {
  return l2Count > 0 ? spend / l2Count : 0;
}

/** CPA = spend / số L3. Chia 0 → 0. THUẦN. */
export function computeCpa(spend: number, l3Count: number): number {
  return l3Count > 0 ? spend / l3Count : 0;
}

/** CP_TT = CPL × L2 của tổ (C9.1). THUẦN. */
export function computeCpTt(cpl: number, l2OfTt: number): number {
  return cpl * l2OfTt;
}

/** C9.4 — chỉ SUPER_ADMIN / HO_ACCOUNTANT được REOPEN kỳ đã CONFIRMED. THUẦN. */
export function canReopenCost(actor: {
  isSuperAdmin: boolean;
  orgRoles: { roleCode: string }[];
}): boolean {
  return actor.isSuperAdmin || actor.orgRoles.some((r) => r.roleCode === "HO_ACCOUNTANT");
}

/** C9.3 — nhập/đè totalQcCost khi DRAFT/REOPENED; CONFIRMED → khóa. */
export async function upsertDraftCost(
  actor: AuditActor,
  input: { period: string; totalQcCost: number; reason?: string },
): Promise<MarketingCostPeriod> {
  const existing = await db.marketingCostPeriod.findUnique({ where: { period: input.period } });
  if (existing && existing.status === "CONFIRMED") {
    throw new CostError("PERIOD_LOCKED", "Kỳ đã CONFIRMED — không sửa được (cần REOPEN).");
  }
  // VND là số nguyên (H5/COL2) → cột totalQcCost nay là Int, làm tròn trước khi ghi.
  const totalQcCost = Math.round(input.totalQcCost);
  const row = await db.marketingCostPeriod.upsert({
    where: { period: input.period },
    update: { totalQcCost },
    create: { period: input.period, totalQcCost },
  });
  await writeAudit({
    actor, module: "marketing", entityType: "MarketingCostPeriod", entityId: row.id,
    action: "UPDATE", newValues: { totalQcCost }, reason: input.reason,
  });
  return row;
}

/** Chốt kỳ (DRAFT/REOPENED → CONFIRMED). */
export async function confirmCostPeriod(
  actor: AuditActor,
  period: string,
  reason?: string,
): Promise<MarketingCostPeriod> {
  const existing = await db.marketingCostPeriod.findUnique({ where: { period } });
  if (!existing) throw new CostError("PERIOD_NOT_FOUND", "Không tìm thấy kỳ.");
  const row = await db.marketingCostPeriod.update({
    where: { period },
    data: { status: "CONFIRMED", confirmedById: actor.id, confirmedAt: new Date() },
  });
  await writeAudit({
    actor, module: "marketing", entityType: "MarketingCostPeriod", entityId: row.id,
    action: "STATUS_CHANGE", oldValues: { status: existing.status }, newValues: { status: "CONFIRMED" }, reason,
  });
  return row;
}

/** REOPEN kỳ đã CONFIRMED — chỉ SUPER_ADMIN/HO_ACCOUNTANT (C9.4). */
export async function reopenCostPeriod(
  actor: AuditActor & { isSuperAdmin: boolean; orgRoles: { roleCode: string }[] },
  period: string,
  reason?: string,
): Promise<MarketingCostPeriod> {
  if (!canReopenCost(actor)) {
    throw new CostError("FORBIDDEN", "Chỉ SUPER_ADMIN / HO_ACCOUNTANT được mở lại kỳ.");
  }
  const existing = await db.marketingCostPeriod.findUnique({ where: { period } });
  if (!existing) throw new CostError("PERIOD_NOT_FOUND", "Không tìm thấy kỳ.");
  if (existing.status !== "CONFIRMED") {
    throw new CostError("NOT_CONFIRMED", "Chỉ mở lại kỳ đang CONFIRMED.");
  }
  const row = await db.marketingCostPeriod.update({ where: { period }, data: { status: "REOPENED" } });
  await writeAudit({
    actor, module: "marketing", entityType: "MarketingCostPeriod", entityId: row.id,
    action: "STATUS_CHANGE", oldValues: { status: "CONFIRMED" }, newValues: { status: "REOPENED" }, reason,
  });
  return row;
}
