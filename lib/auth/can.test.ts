// A0-03 — can() v2 ma trận (lõi bảo mật). Pure, không DB.
import { describe, it, expect, vi } from "vitest";
import { buildActor, type UserOrgRoleRow } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";
import {
  can,
  assertCan,
  PermissionError,
  getVisibleCenterIds,
} from "@/lib/auth/can";
import { decidePermission } from "@/lib/auth/shadow-compare";

const ORG: OrgUnitNode[] = [
  { id: "root", code: "SATAROBO", type: "ROOT", parentId: null, centerId: null },
  { id: "ho", code: "HO", type: "HO", parentId: "root", centerId: null },
  { id: "cs1", code: "CS1", type: "CENTER", parentId: "root", centerId: "c1" },
  { id: "cs2", code: "CS2", type: "CENTER", parentId: "root", centerId: "c2" },
];

const PAST = new Date("2000-01-01");

function row(
  orgUnitId: string,
  code: string,
  perms: UserOrgRoleRow["role"]["permissions"],
  opts: Partial<Pick<UserOrgRoleRow, "status" | "effectiveFrom" | "effectiveTo">> & {
    roleActive?: boolean;
  } = {},
): UserOrgRoleRow {
  return {
    orgUnitId,
    status: opts.status ?? "ACTIVE",
    effectiveFrom: opts.effectiveFrom ?? PAST,
    effectiveTo: opts.effectiveTo ?? null,
    role: { code, isActive: opts.roleActive ?? true, permissions: perms },
  };
}

function actor(
  rows: UserOrgRoleRow[],
  extra: { grants?: { action: string; grant: "ALLOW" | "DENY" }[]; classes?: string[] } = {},
) {
  return buildActor({
    userId: "u1",
    rows,
    orgNodes: ORG,
    grants: extra.grants,
    assignedClassIds: extra.classes,
    now: new Date("2026-06-08"),
  });
}

describe("[A0-03] can() v2 — ma trận", () => {
  it("[A0-03-T1-01] SUPER_ADMIN@HO → mọi action true (AC7)", () => {
    const a = actor([row("ho", "SUPER_ADMIN", [])]);
    expect(a.isSuperAdmin).toBe(true);
    expect(can(a, "students:edit", { centerId: "c2" })).toBe(true);
    expect(can(a, "bất:kỳ")).toBe(true);
  });

  it("[A0-03-T1-03] user không role → false", () => {
    expect(can(actor([]), "leads:view-all")).toBe(false);
  });

  it("[A0-03-T1-02][A0-03-T6-01] ≥1 role ALLOW đúng scope → true (AC1)", () => {
    const a = actor([
      row("ho", "HO_MARKETING", [{ action: "leads:view-all", scopeType: "GLOBAL" }]),
      row("cs1", "ASSISTANT_TEACHER", [{ action: "attendance:view", scopeType: "ASSIGNED" }]),
    ]);
    expect(can(a, "leads:view-all")).toBe(true);
  });

  it("[A0-03-T4-01/02] HO_ACCOUNTANT@HO → CENTER scope khớp CS1 & CS2 (AC2 cross-center)", () => {
    const a = actor([row("ho", "HO_ACCOUNTANT", [{ action: "payments:manage", scopeType: "CENTER" }])]);
    expect(can(a, "payments:manage", { centerId: "c1" })).toBe(true);
    expect(can(a, "payments:manage", { centerId: "c2" })).toBe(true);
  });

  it("[A0-03-T4-03] HO_ACCOUNTANT KHÔNG có action ngoài quyền → false (AC3, HO ≠ siêu quyền)", () => {
    const a = actor([row("ho", "HO_ACCOUNTANT", [{ action: "payments:manage", scopeType: "CENTER" }])]);
    expect(can(a, "students:edit", { centerId: "c1" })).toBe(false);
  });

  it("[A0-03-T4-04/05] CENTER_ACCOUNTANT@CS1 → CS1 true, CS2 false (AC4 cách ly)", () => {
    const a = actor([row("cs1", "CENTER_ACCOUNTANT", [{ action: "payments:manage", scopeType: "CENTER" }])]);
    expect(can(a, "payments:manage", { centerId: "c1" })).toBe(true);
    expect(can(a, "payments:manage", { centerId: "c2" })).toBe(false);
  });

  it("[A0-03-T4-13/14] TEACHER scope CLASS: lớp được phân công true, lớp khác false (AC9)", () => {
    const a = actor(
      [row("cs1", "TEACHER", [{ action: "attendance:mark", scopeType: "CLASS" }])],
      { classes: ["cl1"] },
    );
    expect(can(a, "attendance:mark", { classId: "cl1" })).toBe(true);
    expect(can(a, "attendance:mark", { classId: "cl2" })).toBe(false);
  });

  it("[NHÓM02-T2c] ASSISTANT_TEACHER scope ASSIGNED: lớp được phân công true, lớp khác + thiếu target false", () => {
    const a = actor(
      [row("cs1", "ASSISTANT_TEACHER", [{ action: "attendance:view", scopeType: "ASSIGNED" }])],
      { classes: ["cl1"] },
    );
    expect(can(a, "attendance:view", { classId: "cl1" })).toBe(true);
    expect(can(a, "attendance:view", { classId: "cl2" })).toBe(false);
    // Target thiếu classId → an toàn = false (giống CLASS, không suy diễn ngầm).
    expect(can(a, "attendance:view")).toBe(false);
  });

  it("[A0-03-T4-15/16] PARENT scope CHILDREN: con mình true, con người khác false (AC10)", () => {
    const a = actor([row("cs1", "PARENT", [{ action: "students:view-all", scopeType: "CHILDREN" }])]);
    expect(can(a, "students:view-all", { parentUserId: "u1" })).toBe(true);
    expect(can(a, "students:view-all", { parentUserId: "other" })).toBe(false);
  });

  it("OWN scope: chỉ true cho bản ghi do actor tạo", () => {
    const a = actor([row("cs1", "CENTER_SALES_CSM", [{ action: "leads:view-own", scopeType: "OWN" }])]);
    expect(can(a, "leads:view-own", { createdById: "u1" })).toBe(true);
    expect(can(a, "leads:view-own", { createdById: "u2" })).toBe(false);
  });

  it("[A0-03-T8-01/02] target null: GLOBAL xét được, CENTER → false (an toàn)", () => {
    const g = actor([row("ho", "HO_MARKETING", [{ action: "leads:view-all", scopeType: "GLOBAL" }])]);
    expect(can(g, "leads:view-all")).toBe(true);
    const c = actor([row("cs1", "CENTER_ACCOUNTANT", [{ action: "payments:manage", scopeType: "CENTER" }])]);
    expect(can(c, "payments:manage")).toBe(false);
  });

  it("[A0-03-T6-02] grant DENY KHÔNG làm mất quyền role (AC6, OI-7)", () => {
    const a = actor(
      [row("ho", "HO_MARKETING", [{ action: "leads:view-all", scopeType: "GLOBAL" }])],
      { grants: [{ action: "leads:view-all", grant: "DENY" }] },
    );
    expect(can(a, "leads:view-all")).toBe(true);
  });

  it("[A0-03-T1-04] grant ALLOW thêm action ngoài role → true (AC6)", () => {
    const a = actor([row("cs1", "TEACHER", [])], { grants: [{ action: "honors:view", grant: "ALLOW" }] });
    expect(can(a, "honors:view")).toBe(true);
  });

  it("assertCan throw PermissionError khi thiếu quyền", () => {
    const a = actor([]);
    expect(() => assertCan(a, "leads:view-all")).toThrow(PermissionError);
  });

  it("getVisibleCenterIds phản ánh scope", () => {
    expect(getVisibleCenterIds(actor([row("cs1", "CENTER_MANAGER", [])]))).toEqual(["c1"]);
  });
});

describe("[A0-03] shadow-compare (AC12)", () => {
  it("[A0-03-T12-02] v1≠v2 → log.warn", () => {
    const logger = { warn: vi.fn() };
    decidePermission({ action: "x", userId: "u1", v1: true, v2: false, flagOn: false, logger });
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("[A0-03-T12-01/03] flag OFF→v1, ON→v2", () => {
    const logger = { warn: vi.fn() };
    expect(decidePermission({ action: "x", userId: "u", v1: true, v2: false, flagOn: false, logger })).toBe(true);
    expect(decidePermission({ action: "x", userId: "u", v1: true, v2: false, flagOn: true, logger })).toBe(false);
  });

  it("v1==v2 → không log", () => {
    const logger = { warn: vi.fn() };
    decidePermission({ action: "x", userId: "u", v1: true, v2: true, flagOn: false, logger });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
