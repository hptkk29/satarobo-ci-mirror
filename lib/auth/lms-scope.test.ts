import { describe, it, expect } from "vitest";
import { canStaffAccessStudent, isManagerActor } from "@/lib/auth/lms-scope";
import type { Actor } from "@/lib/auth/actor";

function actor(over: Partial<Actor>): Actor {
  return {
    userId: "u1",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set(),
    assignedClassIds: new Set(),
    ...over,
  } as Actor;
}

describe("isManagerActor", () => {
  it("true cho SUPER_ADMIN / HO / CENTER_MANAGER", () => {
    expect(isManagerActor(actor({ isSuperAdmin: true }))).toBe(true);
    expect(isManagerActor(actor({ isHoLevel: true }))).toBe(true);
    expect(isManagerActor(actor({ orgRoles: [{ orgUnitId: "o1", roleCode: "CENTER_MANAGER" }] }))).toBe(true);
  });
  it("false cho GV thuần", () => {
    expect(isManagerActor(actor({ orgRoles: [{ orgUnitId: "o1", roleCode: "TEACHER" }] }))).toBe(false);
  });
});

describe("canStaffAccessStudent (LMS-15)", () => {
  it("SUPER_ADMIN / HO → mọi HV", () => {
    expect(canStaffAccessStudent(actor({ isSuperAdmin: true }), { studentCenterId: "c9", studentClassIds: [] })).toBe(true);
  });
  it("quản lý → HV trong cơ sở nhìn thấy", () => {
    const a = actor({ orgRoles: [{ orgUnitId: "o1", roleCode: "CENTER_MANAGER" }], visibleCenterIds: ["c1"] });
    expect(canStaffAccessStudent(a, { studentCenterId: "c1", studentClassIds: [] })).toBe(true);
    expect(canStaffAccessStudent(a, { studentCenterId: "c2", studentClassIds: [] })).toBe(false);
  });
  it("GV → HV trong lớp mình dạy", () => {
    const a = actor({ orgRoles: [{ orgUnitId: "o1", roleCode: "TEACHER" }], assignedClassIds: new Set(["cls1"]) });
    expect(canStaffAccessStudent(a, { studentCenterId: "c1", studentClassIds: ["cls1"] })).toBe(true);
    expect(canStaffAccessStudent(a, { studentCenterId: "c1", studentClassIds: ["clsX"] })).toBe(false);
  });
});
