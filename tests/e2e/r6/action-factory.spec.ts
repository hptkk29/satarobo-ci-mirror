/**
 * R6-D1 — Action factory: auth→zod→can(target)→scopedDb→mutation→audit→revalidate.
 * Test lõi runAction() trực tiếp với Actor seed (Postgres LOCAL .env.test).
 */
import { test, expect } from "@playwright/test";
import { z } from "zod";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached, type Actor } from "../../../lib/auth/actor";
import { runAction, ActionError, type ActionConfig } from "../../../lib/actions/factory";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

async function orgId(code: string) {
  return (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;
}
async function centerId(code: string) {
  return (await db.center.findUnique({ where: { code }, select: { id: true } }))!.id;
}

async function makeActor(emailKey: string, orgCode: string, roleCode: string): Promise<Actor> {
  const u = await seedUser({ email: testEmail(emailKey), role: "ACCOUNTANT" });
  const r = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return resolveActorUncached(u.id);
}

// Config mẫu: sửa parentName của 1 Lead (model scoped theo centerId).
const editLeadCfg: ActionConfig<{ id: string; parentName: string; centerId: string }, { id: string }> = {
  name: "test:editLead",
  permission: "leads:edit",
  schema: z.object({
    id: z.string().min(1),
    parentName: z.string().min(2, "Tên tối thiểu 2 ký tự"),
    centerId: z.string().min(1),
  }),
  target: (input) => ({ centerId: input.centerId }),
  module: "leads",
  entityType: "Lead",
  auditAction: "UPDATE",
  handler: async ({ db: sdb, input }) => {
    const old = await sdb.lead.findUnique({ where: { id: input.id } });
    if (!old) throw new ActionError("NOT_FOUND", "Không tìm thấy lead trong phạm vi");
    const updated = await sdb.lead.update({
      where: { id: input.id },
      data: { parentName: input.parentName },
    });
    return {
      entityId: updated.id,
      data: { id: updated.id },
      oldValues: { parentName: old.parentName },
      newValues: { parentName: updated.parentName },
    };
  },
};

test.describe("[R6-D1] Action factory chuẩn", () => {
  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({ data: { code: "CS1", name: "CS1", slug: "cs1-af", address: "a", city: "" } });
    await db.center.create({ data: { code: "CS2", name: "CS2", slug: "cs2-af", address: "b", city: "" } });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    // Đảm bảo leads:edit CENTER cho CENTER_MANAGER. Upsert, KHÔNG create: seed-roles
    // nay ĐÃ có sẵn mapping này (vá gate #09 ngày 09-10/07) → create đụng unique
    // (roleId, action) và gãy toàn suite.
    const cm = (await db.roleDef.findUnique({ where: { code: "CENTER_MANAGER" }, select: { id: true } }))!;
    await db.rolePermission.upsert({
      where: { roleId_action: { roleId: cm.id, action: "leads:edit" } },
      create: { roleId: cm.id, action: "leads:edit", scopeType: "CENTER" },
      update: { scopeType: "CENTER" },
    });
  });

  test("[R6-D1-T1-01] happy: SUPER_ADMIN sửa lead qua factory → ok + DB cập nhật", async () => {
    const cs1 = await centerId("CS1");
    const lead = await db.lead.create({ data: { parentName: "Cũ", phone: "0900000001", centerId: cs1 } });
    const sa = await makeActor("af-sa", "HO", "SUPER_ADMIN");

    const { res } = await runAction(editLeadCfg, sa, { id: lead.id, parentName: "Mới", centerId: cs1 }, {
      actorName: "SA",
    });
    expect(res.ok).toBe(true);
    const after = await db.lead.findUnique({ where: { id: lead.id } });
    expect(after!.parentName).toBe("Mới");
  });

  test("[R6-D1-T2-01] input sai schema → VALIDATION (không chạm DB)", async () => {
    const cs1 = await centerId("CS1");
    const lead = await db.lead.create({ data: { parentName: "Cũ", phone: "0900000002", centerId: cs1 } });
    const sa = await makeActor("af-sa2", "HO", "SUPER_ADMIN");

    const { res } = await runAction(editLeadCfg, sa, { id: lead.id, parentName: "X", centerId: cs1 }, {
      actorName: "SA",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION");
    const after = await db.lead.findUnique({ where: { id: lead.id } });
    expect(after!.parentName).toBe("Cũ");
  });

  test("[R6-D1-T2-02] thiếu permission → PERMISSION_DENIED", async () => {
    const cs1 = await centerId("CS1");
    const lead = await db.lead.create({ data: { parentName: "Cũ", phone: "0900000003", centerId: cs1 } });
    const teacher = await makeActor("af-tea", "CS1", "TEACHER"); // không có leads:edit

    const { res } = await runAction(editLeadCfg, teacher, { id: lead.id, parentName: "Mới", centerId: cs1 }, {
      actorName: "Teacher",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("PERMISSION_DENIED");
  });

  test("[R6-D1-T5-01] CM@CS1 sửa lead CS1 → ok; claim CS2 → can() chặn", async () => {
    const cs1 = await centerId("CS1");
    const cs2 = await centerId("CS2");
    const leadCs1 = await db.lead.create({ data: { parentName: "A", phone: "0900000004", centerId: cs1 } });
    const cm = await makeActor("af-cm", "CS1", "CENTER_MANAGER");

    const ok = await runAction(editLeadCfg, cm, { id: leadCs1.id, parentName: "A2", centerId: cs1 }, { actorName: "CM" });
    expect(ok.res.ok).toBe(true);

    // claim centerId CS2 → can() CENTER scope không khớp → từ chối.
    const denied = await runAction(editLeadCfg, cm, { id: leadCs1.id, parentName: "A3", centerId: cs2 }, { actorName: "CM" });
    expect(denied.res.ok).toBe(false);
    if (!denied.res.ok) expect(denied.res.error.code).toBe("PERMISSION_DENIED");
  });

  test("[R6-D1-T5-02] scopedDb chặn IDOR: CM@CS1 claim CS1 nhưng id thuộc CS2 → NOT_FOUND", async () => {
    const cs1 = await centerId("CS1");
    const cs2 = await centerId("CS2");
    const leadCs2 = await db.lead.create({ data: { parentName: "B", phone: "0900000005", centerId: cs2 } });
    const cm = await makeActor("af-cm2", "CS1", "CENTER_MANAGER");

    // can() qua (claim CS1) nhưng scopedDb.findUnique lead CS2 → null → NOT_FOUND.
    const { res } = await runAction(editLeadCfg, cm, { id: leadCs2.id, parentName: "B2", centerId: cs1 }, { actorName: "CM" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("NOT_FOUND");
    const after = await db.lead.findUnique({ where: { id: leadCs2.id } });
    expect(after!.parentName).toBe("B"); // không bị sửa
  });

  test("[R6-D1-T9-01] factory tự ghi AuditLog (actor/entity/old→new/reason)", async () => {
    const cs1 = await centerId("CS1");
    const lead = await db.lead.create({ data: { parentName: "Cũ", phone: "0900000006", centerId: cs1 } });
    const sa = await makeActor("af-sa3", "HO", "SUPER_ADMIN");

    const { res } = await runAction(editLeadCfg, sa, { id: lead.id, parentName: "Mới", centerId: cs1 }, {
      actorName: "SA",
      reason: "khách đổi tên",
    });
    expect(res.ok).toBe(true);

    const log = await db.auditLog.findFirst({
      where: { module: "leads", entityType: "Lead", entityId: lead.id },
    });
    expect(log).not.toBeNull();
    expect(log!.action).toBe("UPDATE");
    expect(log!.reason).toBe("khách đổi tên");
    expect((log!.newValues as { parentName?: string }).parentName).toBe("Mới");
  });
});
