/**
 * R1-04 — L1→L2: hội thoại có SĐT → tạo Lead (qualifiedAt) + dedup 90 ngày. PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../../e2e/_helpers/seed";
import { qualifyConversationToLead, LeadQualifyError } from "../../../lib/crm/lead-qualify";

async function makeConversation(psid: string, parentName?: string) {
  return db.messengerConversation.create({
    data: { pageId: "P1", psid, parentName: parentName ?? null, firstMessageAt: new Date() },
  });
}

test.describe("[R1-04] L1→L2 qualify", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R1-04-C4.1] có SĐT + note → tạo Lead, set qualifiedAt, nối conversation.leadId", async () => {
    const conv = await makeConversation("u1", "Chị Lan");
    const { lead, deduped } = await qualifyConversationToLead({
      conversationId: conv.id, phone: "090 123 4567", note: "quan tâm Sata 1",
      commissionSource: "MARKETING_ADMIN",
    });
    expect(deduped).toBe(false);
    expect(lead.qualifiedAt).not.toBeNull();
    expect(lead.phone).toBe("84901234567");
    expect(lead.commissionSource).toBe("MARKETING_ADMIN");
    const after = await db.messengerConversation.findUnique({ where: { id: conv.id } });
    expect(after?.leadId).toBe(lead.id);
    expect(after?.status).toBe("QUALIFIED");
  });

  test("[R1-04-C4.3] dedup phone 90 ngày → không tạo lead trùng", async () => {
    const c1 = await makeConversation("u1");
    const r1 = await qualifyConversationToLead({ conversationId: c1.id, phone: "0901234567", commissionSource: "MARKETING_ADMIN" });
    const c2 = await makeConversation("u2");
    const r2 = await qualifyConversationToLead({ conversationId: c2.id, phone: "090-123-4567", commissionSource: "SALE_SELF" });
    expect(r2.deduped).toBe(true);
    expect(r2.lead.id).toBe(r1.lead.id);
    expect(await db.lead.count({ where: { phone: "84901234567" } })).toBe(1);
  });

  test("[R1-04-C4.2] thiếu SĐT → không đạt L2 (throw)", async () => {
    const conv = await makeConversation("u3");
    await expect(
      qualifyConversationToLead({ conversationId: conv.id, phone: "", commissionSource: "MARKETING_ADMIN" }),
    ).rejects.toThrow(LeadQualifyError);
  });
});
