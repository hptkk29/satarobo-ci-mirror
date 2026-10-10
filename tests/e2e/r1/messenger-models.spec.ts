/**
 * R1-01 — Messenger models + service. Postgres LOCAL.
 * C1.1 page scope · C1.2 conversation/message thứ tự · C1.3 firstMessageAt/respondedAt · C1.4 scopedDb.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../../e2e/_helpers/seed";
import { testEmail } from "../../e2e/_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import { scopedDb } from "../../../lib/db-scope";
import {
  upsertPageMapping,
  recordIncomingMessage,
  recordOutgoingMessage,
} from "../../../lib/crm/messenger-service";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const centerId = async (code: string) =>
  (await db.orgUnit.findUnique({ where: { code }, select: { centerId: true } }))!.centerId!;
const orgId = async (code: string) =>
  (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;

test.describe("[R1-01] Messenger models", () => {
  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-msg", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-msg", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[R1-01-C1.1] Page HO → scopeType HO; Page CS1 → CENTER + centerId", async () => {
    const c1 = await centerId("CS1");
    const ho = await upsertPageMapping({ pageId: "PAGE_HO", scopeType: "HO" });
    const cs1 = await upsertPageMapping({ pageId: "PAGE_CS1", scopeType: "CENTER", centerId: c1 });
    expect(ho.scopeType).toBe("HO");
    expect(ho.centerId).toBeNull();
    expect(cs1.scopeType).toBe("CENTER");
    expect(cs1.centerId).toBe(c1);
  });

  test("[R1-01-C1.2] conversation + message đọc lại đúng thứ tự thời gian", async () => {
    await upsertPageMapping({ pageId: "P1", scopeType: "HO" });
    await recordIncomingMessage({ pageId: "P1", psid: "u1", text: "xin chào", sentAt: new Date("2026-06-08T10:00:00Z") });
    const conv = await db.messengerConversation.findFirst({ where: { pageId: "P1", psid: "u1" } });
    await recordOutgoingMessage({ conversationId: conv!.id, text: "chào bạn", sentAt: new Date("2026-06-08T10:01:00Z") });
    await recordIncomingMessage({ pageId: "P1", psid: "u1", text: "cho hỏi học phí", sentAt: new Date("2026-06-08T10:02:00Z") });

    const msgs = await db.messengerMessage.findMany({ where: { conversationId: conv!.id }, orderBy: { sentAt: "asc" } });
    expect(msgs.map((m) => m.direction)).toEqual(["IN", "OUT", "IN"]);
    expect(msgs.map((m) => m.text)).toEqual(["xin chào", "chào bạn", "cho hỏi học phí"]);
  });

  test("[R1-01-C1.3] firstMessageAt set ở IN đầu; respondedAt set ở OUT đầu", async () => {
    await upsertPageMapping({ pageId: "P2", scopeType: "HO" });
    const t1 = new Date("2026-06-08T08:00:00Z");
    await recordIncomingMessage({ pageId: "P2", psid: "u2", text: "hi", sentAt: t1 });
    let conv = await db.messengerConversation.findFirst({ where: { pageId: "P2", psid: "u2" } });
    expect(conv!.firstMessageAt?.getTime()).toBe(t1.getTime());
    expect(conv!.respondedAt).toBeNull();

    const t2 = new Date("2026-06-08T08:05:00Z");
    await recordOutgoingMessage({ conversationId: conv!.id, text: "reply", sentAt: t2 });
    const t3 = new Date("2026-06-08T08:10:00Z");
    await recordOutgoingMessage({ conversationId: conv!.id, text: "reply2", sentAt: t3 });
    conv = await db.messengerConversation.findFirst({ where: { pageId: "P2", psid: "u2" } });
    expect(conv!.respondedAt?.getTime()).toBe(t2.getTime()); // OUT đầu, không bị OUT sau đè
    expect(conv!.firstMessageAt?.getTime()).toBe(t1.getTime());
  });

  test("[R1-01] idempotent theo externalEventId → không tạo message trùng", async () => {
    await upsertPageMapping({ pageId: "P3", scopeType: "HO" });
    const args = { pageId: "P3", psid: "u3", text: "dup", sentAt: new Date(), externalEventId: "evt-1" };
    const r1 = await recordIncomingMessage(args);
    const r2 = await recordIncomingMessage(args);
    expect(r2.deduped).toBe(true);
    const conv = await db.messengerConversation.findFirst({ where: { pageId: "P3", psid: "u3" } });
    expect(await db.messengerMessage.count({ where: { conversationId: conv!.id } })).toBe(1);
    expect(r1.deduped).toBe(false);
  });

  test("[R1-01-C1.4] scopedDb: conversation Page CS1 không lọt sang user CS2", async () => {
    const c1 = await centerId("CS1");
    const c2 = await centerId("CS2");
    await upsertPageMapping({ pageId: "PG_CS1", scopeType: "CENTER", centerId: c1 });
    await upsertPageMapping({ pageId: "PG_CS2", scopeType: "CENTER", centerId: c2 });
    await recordIncomingMessage({ pageId: "PG_CS1", psid: "a", text: "cs1", sentAt: new Date() });
    await recordIncomingMessage({ pageId: "PG_CS2", psid: "b", text: "cs2", sentAt: new Date() });

    const u = await seedUser({ email: testEmail("cm-cs2"), role: "TEACHER" });
    const roleId = (await db.roleDef.findUnique({ where: { code: "CENTER_MANAGER" }, select: { id: true } }))!.id;
    await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId("CS2"), roleId, reason: "seed" });
    const actor = await resolveActorUncached(u.id);

    const visible = await scopedDb(actor).messengerConversation.findMany();
    expect(visible.map((c) => c.centerId)).toEqual([c2]); // chỉ CS2, không lọt CS1
  });
});
