// lib/crm/handover.ts — R1-05: bàn giao HO→CS + tiếp nhận + phân Sale + liên hệ (SR.QD.217).
// Set mốc phễu trên Lead + ghi AuditLog. Cách ly cơ sở do scopedDb (lead.centerId) đảm bảo.
import type { Lead } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";

export class HandoverError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HandoverError";
    this.code = code;
  }
}

async function getLead(leadId: string): Promise<Lead> {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.deletedAt) throw new HandoverError("LEAD_NOT_FOUND", "Không tìm thấy lead.");
  return lead;
}

/** C5.1 — HO bàn giao lead về 1 cơ sở: set handedAt + centerId (để scopedDb gán về CS). */
export async function handoverLead(input: {
  actor: AuditActor;
  leadId: string;
  toCenterId: string;
  reason?: string;
}): Promise<Lead> {
  const lead = await getLead(input.leadId);
  const updated = await db.lead.update({
    where: { id: lead.id },
    data: { handedAt: new Date(), centerId: input.toCenterId },
  });
  await writeAudit({
    actor: input.actor, module: "leads", entityType: "Lead", entityId: lead.id, action: "STATUS_CHANGE",
    oldValues: { centerId: lead.centerId, handedAt: lead.handedAt },
    newValues: { centerId: updated.centerId, handedAt: updated.handedAt },
    reason: input.reason, orgUnitId: input.toCenterId,
  });
  return updated;
}

/** C5.2 — CS xác nhận tiếp nhận. */
export async function confirmReceived(input: { actor: AuditActor; leadId: string }): Promise<Lead> {
  const lead = await getLead(input.leadId);
  const updated = await db.lead.update({ where: { id: lead.id }, data: { receivedConfirmedAt: new Date() } });
  await writeAudit({
    actor: input.actor, module: "leads", entityType: "Lead", entityId: lead.id, action: "STATUS_CHANGE",
    newValues: { receivedConfirmedAt: updated.receivedConfirmedAt }, orgUnitId: lead.centerId,
  });
  return updated;
}

/** C5.3 — phân Sale (set assignedToId + assignedAt). */
export async function assignSale(input: { actor: AuditActor; leadId: string; saleUserId: string }): Promise<Lead> {
  const lead = await getLead(input.leadId);
  const updated = await db.lead.update({
    where: { id: lead.id },
    data: { assignedToId: input.saleUserId, assignedAt: new Date() },
  });
  await writeAudit({
    actor: input.actor, module: "leads", entityType: "Lead", entityId: lead.id, action: "ASSIGN",
    newValues: { assignedToId: input.saleUserId, assignedAt: updated.assignedAt }, orgUnitId: lead.centerId,
  });
  return updated;
}

/**
 * C5.3 — Sale liên hệ lần đầu (chỉ set 1 lần).
 *
 * ⚠️ S-3 — ĐỪNG GỌI HÀM NÀY TỪ MÃ CHẠY THẬT. Từ 27/08/2026 `firstContactAt` do
 * `recordLeadActivity` (`lib/lead/activity-write.ts`) đóng, trong cùng
 * transaction với dòng `LeadActivity` sinh ra nó. Hàm này đóng mốc mà KHÔNG để
 * lại dòng hoạt động nào ⇒ lead hiện "đã liên hệ" nhưng dòng thời gian trống
 * trơn, không ai tra được ai gọi, gọi khi nào. Nó còn sống chỉ vì
 * `tests/e2e/r1/handover.spec.ts` (R1-05) đang gọi; người gọi duy nhất trong
 * `app/`/`lib/` là KHÔNG AI — và chính chỗ trống đó là bệnh S-3 phải chữa.
 */
export async function recordFirstContact(input: { actor: AuditActor; leadId: string }): Promise<Lead> {
  const lead = await getLead(input.leadId);
  if (lead.firstContactAt) return lead;
  return db.lead.update({ where: { id: lead.id }, data: { firstContactAt: new Date() } });
}
