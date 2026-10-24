/**
 * R6-F2 — Shadow-diff can() v1↔v2: persist lệch + report = 0 → an toàn bật flag.
 * Postgres LOCAL (.env.test).
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import {
  recordPermissionShadow,
  getShadowDiffStats,
  isSafeToEnableRbacV2,
} from "../../../lib/auth/shadow-report";
import { evaluatePermission } from "../../../lib/auth/permission-eval";

test.describe("[R6-F2] RBAC v2 shadow-diff", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R6-F2-T1-01] persist lệch + report đếm theo action; sạch → safe=true", async () => {
    // khớp (v1==v2) → không ghi.
    expect(await recordPermissionShadow({ action: "leads:edit", userId: "u1", v1: true, v2: true })).toBe(false);
    // lệch → ghi.
    expect(await recordPermissionShadow({ action: "leads:edit", userId: "u1", v1: true, v2: false })).toBe(true);
    expect(await recordPermissionShadow({ action: "leads:edit", userId: "u2", v1: false, v2: true })).toBe(true);

    const stats = await getShadowDiffStats({ sinceDays: 7 });
    expect(stats.total).toBe(2);
    expect(stats.byAction["leads:edit"]).toBe(2);

    const gate = await isSafeToEnableRbacV2({ minCleanDays: 7 });
    expect(gate.safe).toBe(false); // còn lệch → chưa bật
  });

  test("[R6-F2-T1-02] DB không lệch → isSafeToEnableRbacV2.safe = true", async () => {
    const gate = await isSafeToEnableRbacV2({ minCleanDays: 7 });
    expect(gate.safe).toBe(true);
    expect(gate.stats.total).toBe(0);
  });

  test("[R6-F2-T1-03] lệch CŨ ngoài cửa sổ không tính (report theo N ngày)", async () => {
    await recordPermissionShadow({ action: "students:view-all", userId: "u1", v1: true, v2: false });
    // đẩy bản ghi về 10 ngày trước.
    await db.rbacShadowDiff.updateMany({
      data: { createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
    });
    // cửa sổ 7 ngày → không thấy → safe.
    const gate = await isSafeToEnableRbacV2({ minCleanDays: 7 });
    expect(gate.safe).toBe(true);
  });

  test("[R6-F2-T12-01] evaluatePermission: v1==v2 (cùng cho phép) → onEvaluated khớp, không persist", async () => {
    let captured: { v1: boolean; v2: boolean } | null = null;
    // SUPER_ADMIN actor: can() v2 = true mọi action; matrix v1 = true cho leads:view-all.
    const actor = {
      userId: "sa",
      isSuperAdmin: true,
      isHoLevel: true,
      orgRoles: [],
      permissions: [],
      visibleCenterIds: [],
      visibleOrgUnitIds: [],
      grantsAllow: new Set<string>(),
      assignedClassIds: new Set<string>(),
    };
    const decision = evaluatePermission({
      sessionUser: { role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] } as never,
      actor,
      action: "leads:view-all",
      flagOn: false,
      onEvaluated: (r) => { captured = r; },
    });
    expect(decision).toBe(true);
    expect(captured).toEqual({ v1: true, v2: true });
    // khớp → recordPermissionShadow không ghi.
    expect(await recordPermissionShadow({ action: "leads:view-all", userId: "sa", v1: captured!.v1, v2: captured!.v2 })).toBe(false);
    expect((await getShadowDiffStats()).total).toBe(0);
  });
});
