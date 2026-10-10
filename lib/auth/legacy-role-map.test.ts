// lib/auth/legacy-role-map.test.ts — chốt bảng ánh xạ Role (v1) → RoleDef (v2).
//
// Hồi quy được canh: sự cố 07/08/2026 — tài khoản GV có TEACHER trong roles[] nhưng
// không có UserOrgRole ⇒ can() v2 false ⇒ "Không có quyền điểm danh lớp này".
// Test này khoá 2 điều: (a) TEACHER phải sinh ra đích gán, (b) thiếu đơn vị thì báo
// missingAnchor chứ KHÔNG im lặng bỏ qua (đúng cái bẫy của patch-rbac-staff.ts).
import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import {
  MANAGED_ROLE_CODES,
  mappingFor,
  planOrgRoleTargets,
  roleDefCodeFor,
} from "./legacy-role-map";

const HO = "org-ho";
const CS1 = "org-cs1";

const atCenter = (roles: Role[]) =>
  planOrgRoleTargets({
    roles,
    anchorOrgUnitId: CS1,
    anchorIsCenter: true,
    hoOrgUnitId: HO,
  });

describe("planOrgRoleTargets", () => {
  it("GV ở cơ sở → TEACHER @ đơn vị đó (ca sự cố 07/08)", () => {
    const r = atCenter(["TEACHER"]);
    expect(r.missingAnchor).toEqual([]);
    expect(r.targets).toEqual([
      { legacy: "TEACHER", roleCode: "TEACHER", orgUnitId: CS1 },
    ]);
  });

  it("GV neo ở Hội sở vẫn ra TEACHER (quyết định 06/08 — GV về HO)", () => {
    const r = planOrgRoleTargets({
      roles: ["TEACHER"],
      anchorOrgUnitId: HO,
      anchorIsCenter: false,
      hoOrgUnitId: HO,
    });
    expect(r.targets).toEqual([
      { legacy: "TEACHER", roleCode: "TEACHER", orgUnitId: HO },
    ]);
  });

  it("KHÔNG chọn đơn vị → báo missingAnchor, không bỏ qua im lặng", () => {
    const r = planOrgRoleTargets({
      roles: ["TEACHER", "SALES_CSM"],
      anchorOrgUnitId: null,
      anchorIsCenter: false,
      hoOrgUnitId: HO,
    });
    expect(r.targets).toEqual([]);
    expect(r.missingAnchor.sort()).toEqual(["SALES_CSM", "TEACHER"]);
  });

  it("vai HO-anchored vẫn gán được dù không chọn đơn vị", () => {
    const r = planOrgRoleTargets({
      roles: ["SUPER_ADMIN", "MARKETING", "TRAINING"],
      anchorOrgUnitId: null,
      anchorIsCenter: false,
      hoOrgUnitId: HO,
    });
    expect(r.missingAnchor).toEqual([]);
    expect(r.targets.map((t) => `${t.roleCode}@${t.orgUnitId}`).sort()).toEqual(
      [`HO_MARKETING@${HO}`, `SUPER_ADMIN@${HO}`, `TRAINING@${HO}`],
    );
  });

  it("SUPER_ADMIN luôn neo Hội sở dù form chọn cơ sở (nếu không thì mất quyền super)", () => {
    const r = atCenter(["SUPER_ADMIN"]);
    expect(r.targets).toEqual([
      { legacy: "SUPER_ADMIN", roleCode: "SUPER_ADMIN", orgUnitId: HO },
    ]);
  });

  it("HR/Kế toán: gắn cơ sở → CENTER_*, không gắn → HO_*", () => {
    expect(
      atCenter(["HR", "ACCOUNTANT"])
        .targets.map((t) => t.roleCode)
        .sort(),
    ).toEqual(["CENTER_ACCOUNTANT", "CENTER_HR"]);
    const hoAnchored = planOrgRoleTargets({
      roles: ["HR", "ACCOUNTANT"],
      anchorOrgUnitId: HO,
      anchorIsCenter: false,
      hoOrgUnitId: HO,
    });
    expect(hoAnchored.targets.map((t) => t.roleCode).sort()).toEqual([
      "HO_ACCOUNTANT",
      "HO_HR",
    ]);
  });

  it("PARENT không sinh vai v2 (portal gác bằng ownership)", () => {
    const r = atCenter(["PARENT"]);
    expect(r.targets).toEqual([]);
    expect(r.missingAnchor).toEqual([]);
    expect(mappingFor("PARENT")).toBeNull();
  });

  it("đa vai trò → nhiều đích, không trùng lặp", () => {
    const r = atCenter(["TEACHER", "CENTER_MANAGER", "TEACHER"]);
    expect(r.targets.map((t) => t.roleCode).sort()).toEqual([
      "CENTER_MANAGER",
      "TEACHER",
    ]);
  });
});

describe("MANAGED_ROLE_CODES", () => {
  it("chỉ quản lý code suy được từ Role — vai gán tay nằm ngoài", () => {
    expect(MANAGED_ROLE_CODES.has("TEACHER")).toBe(true);
    expect(MANAGED_ROLE_CODES.has("CENTER_HR")).toBe(true);
    // Gán tay ở /admin/users/[id]/org-roles → đồng bộ tự động KHÔNG được thu hồi.
    expect(MANAGED_ROLE_CODES.has("ASSISTANT_TEACHER")).toBe(false);
    expect(MANAGED_ROLE_CODES.has("CENTER_CLASS_MANAGER")).toBe(false);
    expect(MANAGED_ROLE_CODES.has("HO_SALE")).toBe(false);
  });

  it("roleDefCodeFor khớp MANAGED_ROLE_CODES cho mọi role có ánh xạ", () => {
    const roles: Role[] = [
      "SUPER_ADMIN",
      "CENTER_MANAGER",
      "SALES_CSM",
      "TEACHER",
      "TRAINING",
      "MARKETING",
      "ACCOUNTANT",
      "HR",
    ];
    for (const r of roles) {
      for (const atCenterFlag of [true, false]) {
        const code = roleDefCodeFor(r, atCenterFlag);
        expect(code).not.toBeNull();
        expect(MANAGED_ROLE_CODES.has(code as string)).toBe(true);
      }
    }
  });
});
