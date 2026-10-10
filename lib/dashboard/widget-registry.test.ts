// R6-D3 — widget dashboard lọc theo can() (không theo tên role).
import { describe, it, expect } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { visibleWidgets, DASHBOARD_WIDGETS, type Widget } from "./widget-registry";

function actorWith(actions: { action: string; scopeType: "GLOBAL" }[]): Actor {
  return {
    userId: "u",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: actions.map((a) => ({
      action: a.action,
      scopeType: a.scopeType,
      orgUnitId: "o",
      roleCode: "X",
      centerScope: null,
    })),
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  };
}

const REG: Widget[] = [
  { id: "w-open", title: "Mở" },
  { id: "w-leads", title: "Lead", requires: "leads:view-all" },
  { id: "w-pay", title: "Tiền", requires: "payments:manage" },
];

describe("[R6-D3] Dashboard widget registry", () => {
  it("[R6-D3-T1-01] render theo perm: chỉ widget có quyền + widget mở", () => {
    const actor = actorWith([{ action: "leads:view-all", scopeType: "GLOBAL" }]);
    const ids = visibleWidgets(actor, REG).map((w) => w.id);
    expect(ids).toContain("w-open"); // không requires → luôn thấy
    expect(ids).toContain("w-leads");
    expect(ids).not.toContain("w-pay"); // thiếu payments:manage
  });

  it("[R6-D3-T1-02] SUPER_ADMIN thấy mọi widget", () => {
    const sa: Actor = { ...actorWith([]), isSuperAdmin: true };
    expect(visibleWidgets(sa, REG)).toHaveLength(REG.length);
  });

  it("[R6-D3-T4-01] role MỚI có quyền tương ứng → tự thấy widget (không sửa code)", () => {
    // 'role mới' chỉ thể hiện qua permissions; registry lọc theo action, không theo role code.
    const newRole = actorWith([{ action: "payments:manage", scopeType: "GLOBAL" }]);
    const ids = visibleWidgets(newRole, REG).map((w) => w.id);
    expect(ids).toContain("w-pay");
    expect(ids).not.toContain("w-leads");
  });

  it("[R6-D3-T1-03] registry mặc định: actor không quyền chỉ thấy widget mở", () => {
    const ids = visibleWidgets(actorWith([]), [...DASHBOARD_WIDGETS]).map((w) => w.id);
    expect(ids).toContain("commission-mine");
    expect(ids).not.toContain("leads-funnel");
  });
});
