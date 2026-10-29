/**
 * A0-06 — AuditLog hợp nhất: writeAudit + scope viewer + EXPORT. Postgres LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { resolveActorUncached } from "../../../lib/auth/actor";
import {
  writeAudit,
  getAuditLogsScoped,
  queryUnifiedAuditLogs,
  recordPiiUnmask,
} from "../../../lib/audit/audit-log";
import { can } from "../../../lib/auth/can";
import { breakGlassSchema } from "../../../lib/validators/audit";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const orgId = async (code: string) =>
  (await db.orgUnit.findUnique({ where: { code }, select: { id: true } }))!.id;

async function userActor(email: string, orgCode: string, roleCode: string) {
  const u = await seedUser({ email: testEmail(email), role: "ACCOUNTANT" });
  const r = (await db.roleDef.findUnique({ where: { code: roleCode }, select: { id: true } }))!.id;
  await assignUserOrgRole(SA, { userId: u.id, orgUnitId: await orgId(orgCode), roleId: r, reason: "seed" });
  return resolveActorUncached(u.id);
}

test.describe("[A0-06] AuditLog hợp nhất", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  test("[A0-06-T9-01] writeAudit ghi đúng actor/old/new/changedFields/reason (AC1)", async () => {
    const cs1 = await orgId("CS1");
    const log = await writeAudit({
      actor: { id: "u1", name: "Nguyen" }, module: "test", entityType: "Thing", entityId: "x1",
      action: "UPDATE", oldValues: { a: 1, b: 2 }, newValues: { a: 1, b: 9 },
      reason: "sửa b", orgUnitId: cs1,
    });
    expect(log.actorName).toBe("Nguyen");
    expect(log.changedFields).toEqual(["b"]);
    expect(log.reason).toBe("sửa b");
  });

  test("[A0-06-T9-03] system action → actorName=System, actorId null (AC7)", async () => {
    const log = await writeAudit({
      actor: { id: null, name: "System" }, module: "cron", entityType: "Job", entityId: "j1", action: "CREATE",
    });
    expect(log.actorId).toBeNull();
    expect(log.actorName).toBe("System");
  });

  test("[A0-06-T5-01/02/03] viewer scope theo orgUnit (AC3)", async () => {
    const cs1 = await orgId("CS1");
    const cs2 = await orgId("CS2");
    await writeAudit({ actor: { id: "s", name: "S" }, module: "m", entityType: "T", entityId: "a", action: "CREATE", orgUnitId: cs1 });
    await writeAudit({ actor: { id: "s", name: "S" }, module: "m", entityType: "T", entityId: "b", action: "CREATE", orgUnitId: cs2 });

    const cm1 = await userActor("cm1", "CS1", "CENTER_MANAGER");
    const cm2 = await userActor("cm2", "CS2", "CENTER_MANAGER");
    const sa = await userActor("sa", "HO", "SUPER_ADMIN");

    expect((await getAuditLogsScoped(cm1)).map((l) => l.orgUnitId)).toEqual([cs1]);
    expect((await getAuditLogsScoped(cm2)).map((l) => l.orgUnitId)).toEqual([cs2]);
    expect((await getAuditLogsScoped(sa)).length).toBe(2); // SUPER_ADMIN thấy tất cả
  });

  test("[A0-06-T10-03] export → sinh AuditLog action=EXPORT (AC5)", async () => {
    await writeAudit({
      actor: { id: "u1", name: "U" }, module: "orders", entityType: "Order", entityId: "*",
      action: "EXPORT", reason: "xuất Excel (filter month=6)",
    });
    const log = await db.auditLog.findFirst({ where: { action: "EXPORT" } });
    expect(log?.module).toBe("orders");
    expect(log?.reason).toContain("xuất Excel");
  });
});

// #05 — Viewer hợp nhất + break-glass PII (câu 13 BGĐ).
test.describe("[#05] Audit viewer hợp nhất + break-glass PII", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
  });

  // Ghi 1 log PII ở CS1 + 1 ở CS2 để kiểm tra scope + mask.
  async function seedPiiLogs() {
    const cs1 = await orgId("CS1");
    const cs2 = await orgId("CS2");
    await writeAudit({
      actor: { id: "s", name: "S" }, module: "leads", entityType: "Lead", entityId: "L1",
      action: "UPDATE", newValues: { phone: "0901234567", email: "a@x.com", note: "ok" },
      orgUnitId: cs1,
    });
    await writeAudit({
      actor: { id: "s", name: "S" }, module: "leads", entityType: "Lead", entityId: "L2",
      action: "UPDATE", newValues: { phone: "0912345678", email: "b@y.com" },
      orgUnitId: cs2,
    });
    return { cs1, cs2 };
  }

  test("[#05-T5] CENTER_MANAGER CS1 chỉ thấy log cơ sở mình; SUPER_ADMIN thấy tất cả", async () => {
    const { cs1 } = await seedPiiLogs();
    const cm1 = await userActor("cm1", "CS1", "CENTER_MANAGER");
    const sa = await userActor("sa", "HO", "SUPER_ADMIN");

    const cmRes = await queryUnifiedAuditLogs(cm1, {}, null);
    expect(cmRes.items.map((r) => r.orgUnitId)).toEqual([cs1]);

    const saRes = await queryUnifiedAuditLogs(sa, {}, null);
    expect(saRes.items.length).toBe(2);
  });

  test("[#05-T6] mask mặc định cho MỌI người (kể cả đủ quyền)", async () => {
    await seedPiiLogs();
    const cm1 = await userActor("cm1", "CS1", "CENTER_MANAGER");
    const sa = await userActor("sa", "HO", "SUPER_ADMIN");

    const cmRes = await queryUnifiedAuditLogs(cm1, {}, null); // KHÔNG unmask
    const cmRow = cmRes.items[0]!;
    expect(cmRow.piiMasked).toBe(true);
    expect((cmRow.newValues as { phone: string }).phone).toBe("09***67");
    expect((cmRow.newValues as { email: string }).email).toBe("a***@x.com");

    // SUPER_ADMIN cũng bị mask mặc định (không tự động unmask).
    const saRow = (await queryUnifiedAuditLogs(sa, {}, null)).items[0]!;
    expect(saRow.piiMasked).toBe(true);
    expect((saRow.newValues as { phone: string }).phone).not.toContain("012345");
  });

  test("[#05-T2] break-glass unmask → hiện SĐT/email đầy đủ", async () => {
    await seedPiiLogs();
    // 03/08 — người dùng break-glass nay là SUPER_ADMIN (CM đã rút khỏi audit-logs:*).
    const sa = await userActor("sa", "HO", "SUPER_ADMIN");

    const res = await queryUnifiedAuditLogs(sa, {}, null, { unmask: true });
    // SUPER_ADMIN thấy log CẢ HAI cơ sở nên KHÔNG bám items[0] — tìm đúng bản ghi L1.
    const row = res.items.find((r) => r.entityId === "L1")!;
    expect(row).toBeTruthy();
    expect(row.piiMasked).toBe(false);
    expect((row.newValues as { phone: string }).phone).toBe("0901234567");
    expect((row.newValues as { email: string }).email).toBe("a@x.com");
  });

  test("[#05-T2] quyền view-pii: chỉ SUPER_ADMIN (03/08 rút khỏi Quản lý cơ sở)", async () => {
    const cm1 = await userActor("cm1", "CS1", "CENTER_MANAGER");
    const tea = await userActor("tea", "CS1", "TEACHER");
    const sa = await userActor("sa", "HO", "SUPER_ADMIN");

    // 03/08 — chủ dự án chặn Audit Log ở vai Quản lý cơ sở: nhật ký hệ thống +
    // break-glass xem PII nay chỉ còn SUPER_ADMIN.
    expect(can(sa, "audit-logs:view-pii")).toBe(true); // SUPER_ADMIN bypass
    expect(can(cm1, "audit-logs:view-pii")).toBe(false);
    expect(can(tea, "audit-logs:view-pii")).toBe(false);
  });

  test("[#05-T2] reason < 10 ký tự bị từ chối; >= 10 ký tự chấp nhận", () => {
    expect(breakGlassSchema.safeParse({ reason: "ngắn" }).success).toBe(false);
    expect(breakGlassSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(
      breakGlassSchema.safeParse({ reason: "đối soát khiếu nại phụ huynh" }).success,
    ).toBe(true);
  });

  test("[#05-T2] recordPiiUnmask ghi log RIÊNG audit.pii-unmasked kèm reason", async () => {
    const cm1 = await userActor("cm1", "CS1", "CENTER_MANAGER");
    await recordPiiUnmask(
      { id: cm1.userId, name: "CM1" },
      "đối soát khiếu nại phụ huynh về đổi SĐT",
      { ip: "1.2.3.4", userAgent: "test" },
    );

    const log = await db.auditLog.findFirst({
      where: { action: "audit.pii-unmasked" },
    });
    expect(log?.module).toBe("audit");
    expect(log?.actorId).toBe(cm1.userId);
    expect(log?.reason).toContain("đối soát");
    expect(log?.ip).toBe("1.2.3.4");
  });
});
