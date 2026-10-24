// A0-03 — buildActor: visibleCenterIds (AC8) + lọc hiệu lực role (T7). Pure.
import { describe, it, expect } from "vitest";
import { buildActor, type UserOrgRoleRow } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";

const ORG: OrgUnitNode[] = [
  { id: "root", code: "SATAROBO", type: "ROOT", parentId: null, centerId: null },
  { id: "ho", code: "HO", type: "HO", parentId: "root", centerId: null },
  { id: "cs1", code: "CS1", type: "CENTER", parentId: "root", centerId: "c1" },
  { id: "cs2", code: "CS2", type: "CENTER", parentId: "root", centerId: "c2" },
];
const NOW = new Date("2026-06-08");

function row(
  orgUnitId: string,
  code: string,
  opts: Partial<Pick<UserOrgRoleRow, "status" | "effectiveFrom" | "effectiveTo">> & {
    roleActive?: boolean;
  } = {},
): UserOrgRoleRow {
  return {
    orgUnitId,
    status: opts.status ?? "ACTIVE",
    effectiveFrom: opts.effectiveFrom ?? new Date("2000-01-01"),
    effectiveTo: opts.effectiveTo ?? null,
    role: { code, isActive: opts.roleActive ?? true, permissions: [] },
  };
}

const build = (rows: UserOrgRoleRow[]) =>
  buildActor({ userId: "u1", rows, orgNodes: ORG, now: NOW });

describe("[A0-03] buildActor.visibleCenterIds (AC8)", () => {
  it("[A0-03-T5-01] CENTER_MANAGER@CS1 → [c1]", () => {
    expect(build([row("cs1", "CENTER_MANAGER")]).visibleCenterIds).toEqual(["c1"]);
  });

  it("[A0-03-T5-02] HO_ACCOUNTANT@HO → tất cả center [c1,c2]", () => {
    expect(build([row("ho", "HO_ACCOUNTANT")]).visibleCenterIds.sort()).toEqual(["c1", "c2"]);
  });

  it("[A0-03-T5-03] multi-role HO+CS1 → tất cả center (HO trùm)", () => {
    const a = build([row("ho", "HO_HR"), row("cs1", "CENTER_MANAGER")]);
    expect(a.visibleCenterIds.sort()).toEqual(["c1", "c2"]);
  });
});

describe("[Phase0] buildActor.visibleOrgUnitIds (song song visibleCenterIds)", () => {
  it("CENTER_MANAGER@CS1 → [cs1] (chỉ orgUnit của mình)", () => {
    expect(build([row("cs1", "CENTER_MANAGER")]).visibleOrgUnitIds).toEqual(["cs1"]);
  });

  it("HO role → mọi đơn vị sống (gồm cả HO + ROOT)", () => {
    expect(build([row("ho", "HO_ACCOUNTANT")]).visibleOrgUnitIds.sort()).toEqual([
      "cs1", "cs2", "ho", "root",
    ]);
  });

  it("multi-role HO+CS1 → mọi đơn vị (HO trùm)", () => {
    const a = build([row("ho", "HO_HR"), row("cs1", "CENTER_MANAGER")]);
    expect(a.visibleOrgUnitIds.sort()).toEqual(["cs1", "cs2", "ho", "root"]);
  });

  it("CS1 KHÔNG thấy cs2/ho (cách ly — nền Phase D)", () => {
    const v = build([row("cs1", "CENTER_MANAGER")]).visibleOrgUnitIds;
    expect(v).not.toContain("cs2");
    expect(v).not.toContain("ho");
  });
});

describe("[A0-03] buildActor — lọc hiệu lực (T7)", () => {
  it("[A0-03-T7-01] effectiveTo < now → không tính", () => {
    const a = build([row("cs1", "CENTER_MANAGER", { effectiveTo: new Date("2020-01-01") })]);
    expect(a.orgRoles).toHaveLength(0);
    expect(a.visibleCenterIds).toEqual([]);
  });

  it("[A0-03-T7-02] effectiveFrom > now (chưa tới) → không tính", () => {
    const a = build([row("cs1", "CENTER_MANAGER", { effectiveFrom: new Date("2099-01-01") })]);
    expect(a.orgRoles).toHaveLength(0);
  });

  it("[A0-03-T7-03] effectiveTo == now (biên) → còn tính", () => {
    const a = build([row("cs1", "CENTER_MANAGER", { effectiveTo: NOW })]);
    expect(a.orgRoles).toHaveLength(1);
  });

  it("[A0-03-T7-04] status SUSPENDED → không tính", () => {
    expect(build([row("cs1", "CENTER_MANAGER", { status: "SUSPENDED" })]).orgRoles).toHaveLength(0);
  });

  it("[A0-03-T7-05] RoleDef.isActive=false → không tính", () => {
    expect(build([row("cs1", "CENTER_MANAGER", { roleActive: false })]).orgRoles).toHaveLength(0);
  });

  it("isSuperAdmin chỉ khi SUPER_ADMIN tại HO/ROOT", () => {
    expect(build([row("ho", "SUPER_ADMIN")]).isSuperAdmin).toBe(true);
    expect(build([row("cs1", "SUPER_ADMIN")]).isSuperAdmin).toBe(false);
  });

  it("[A0-03-T8-03] grant ALLOW action ngoài registry → bỏ qua", () => {
    const a = buildActor({
      userId: "u1", rows: [], orgNodes: ORG, now: NOW,
      grants: [{ action: "evil:hack", grant: "ALLOW" }],
      validActions: new Set(["leads:view-all"]),
    });
    expect(a.grantsAllow.has("evil:hack")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Vai QUAN HỆ (PARENT) — sinh ra từ sự cố đo được 10/08/2026 trên test VÀ prod:
// phụ huynh không gửi được tin nào (chữ lẫn ảnh), `sendChatMessageAction` trả
// PERMISSION_DENIED trong khi permissions.md ghi "PH ✅ Gửi CHAT". Nguyên nhân: 114
// tài khoản PARENT / 0 dòng UserOrgRole ⇒ `actor.permissions` rỗng ⇒ không có gì để
// khớp scope. Bộ test này khoá cả hai chiều: PHẢI có quyền, và KHÔNG được nới thêm.
// ─────────────────────────────────────────────────────────────────────────────
describe("vai quan hệ (PARENT) — có quyền mà KHÔNG cần UserOrgRole", () => {
  const parentRole = {
    code: "PARENT",
    isActive: true,
    permissions: [
      { action: "chat:read", scopeType: "OWN" as const },
      { action: "chat:send", scopeType: "OWN" as const },
    ],
  };
  const parentActor = (over: Partial<Parameters<typeof buildActor>[0]> = {}) =>
    buildActor({
      userId: "ph1",
      rows: [],
      orgNodes: ORG,
      now: NOW,
      relationshipRoles: [parentRole],
      ...over,
    });

  it("KHÔNG có dòng UserOrgRole nào mà vẫn có chat:read + chat:send", () => {
    const a = parentActor();
    expect(a.permissions.map((p) => p.action).sort()).toEqual(["chat:read", "chat:send"]);
  });

  it("KHÔNG biến phụ huynh thành HO-level và KHÔNG cho thấy cơ sở nào", () => {
    const a = parentActor();
    expect(a.isHoLevel, "gắn vai vào ROOT là biến PH thành cross-center").toBe(false);
    expect(a.isSuperAdmin).toBe(false);
    expect(a.visibleCenterIds).toEqual([]);
    expect(a.visibleOrgUnitIds).toEqual([]);
    expect(a.orgRoles).toEqual([]);
  });

  it("centerScope = null ⇒ permission scope CENTER của vai này KHÔNG BAO GIỜ khớp", () => {
    const a = buildActor({
      userId: "ph1",
      rows: [],
      orgNodes: ORG,
      now: NOW,
      relationshipRoles: [
        {
          ...parentRole,
          permissions: [{ action: "leads:view-all", scopeType: "CENTER" as const }],
        },
      ],
    });
    expect(a.permissions[0]?.centerScope).toBeNull();
  });

  it("RoleDef bị tắt ⇒ không cấp quyền (tắt vai là tắt thật)", () => {
    const a = parentActor({ relationshipRoles: [{ ...parentRole, isActive: false }] });
    expect(a.permissions).toEqual([]);
  });

  it("cộng dồn được với vai theo đơn vị — nhân viên kiêm phụ huynh không mất quyền nào", () => {
    const a = buildActor({
      userId: "u9",
      rows: [row("cs1", "CENTER_MANAGER")],
      orgNodes: ORG,
      now: NOW,
      relationshipRoles: [parentRole],
    });
    expect(a.visibleCenterIds).toEqual(["c1"]);
    expect(a.permissions.some((p) => p.action === "chat:send")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2 · US-10 — WorkScope: NƠI TÁC NGHIỆP cộng vào NƠI TRỰC THUỘC.
//
// ⚠️ "GV-HO" TRONG TS-11 LÀ NGƯỜI BIÊN CHẾ **PHÒNG BAN** CỦA HỘI SỞ, KHÔNG PHẢI NGƯỜI
// NEO VAI TẠI CHÍNH NODE HO. Vai neo tại node HO/ROOT là cross-center theo thiết kế
// (`isHoLevel` → thấy mọi cơ sở), nên với người đó WorkScope không có gì để nới — và
// đổi điều đó chính là lỗ rò quyền đã phải gỡ ở US-05 (xem CLAUDE.md, mục V7). Ca dùng
// thật của US-10 là phòng Đào tạo: DEPARTMENT dưới HO, dưới nó KHÔNG có cơ sở nào ⇒ tự
// nhiên không thấy dữ liệu cơ sở nào cho tới khi có điều động.
// ─────────────────────────────────────────────────────────────────────────────
const ORG_US10: OrgUnitNode[] = [
  { id: "ho", code: "HO", type: "HO", parentId: null, centerId: null },
  { id: "dt", code: "DAOTAO", type: "DEPARTMENT", parentId: "ho", centerId: null },
  { id: "dn", code: "DANANG", type: "REGION", parentId: "ho", centerId: null },
  { id: "cs1", code: "CS1", type: "CENTER", parentId: "dn", centerId: "c1" },
  { id: "cs2", code: "CS2", type: "CENTER", parentId: "dn", centerId: "c2" },
];

function gvPhongDaoTao(workScopeOrgUnitIds?: string[]): UserOrgRoleRow {
  return {
    orgUnitId: "dt",
    roleId: "role-teacher",
    status: "ACTIVE",
    effectiveFrom: new Date("2000-01-01"),
    effectiveTo: null,
    workScopeOrgUnitIds,
    role: {
      code: "TEACHER",
      isActive: true,
      permissions: [{ action: "classes:view-own", scopeType: "CENTER" }],
    },
  };
}

const buildUs10 = (rows: UserOrgRoleRow[]) =>
  buildActor({ userId: "gv", rows, orgNodes: ORG_US10, now: NOW });

/** `roleCenterScope` là optional trên Actor — lấy ra kèm khẳng định có mặt. */
const scopeCua = (a: ReturnType<typeof buildUs10>, roleId: string) => {
  const s = a.roleCenterScope?.[roleId];
  expect(s, `thiếu roleCenterScope cho ${roleId}`).toBeDefined();
  return s;
};

describe("[US-10] WorkScope — nơi tác nghiệp", () => {
  it("[AC2 · đối chứng âm] chưa điều động → KHÔNG thấy cơ sở nào", () => {
    const a = buildUs10([gvPhongDaoTao()]);
    expect(a.visibleCenterIds).toEqual([]);
    expect(scopeCua(a, "role-teacher")).toEqual({ unitOnly: [], unitAndBelow: [] });
  });

  it("[AC2] điều động CS1 → thấy ĐÚNG CS1, không kèm CS2", () => {
    const a = buildUs10([gvPhongDaoTao(["cs1"])]);
    expect(a.visibleCenterIds).toEqual(["c1"]);
    expect(a.visibleOrgUnitIds.sort()).toEqual(["cs1", "dt"]);
    // Cả HAI mức đều phải có: vai mang dataScope UNIT_ONLY (mặc định của học viên/lớp)
    // mà chỉ nới `unitAndBelow` thì điều động vô tác dụng đúng nghiệp vụ sinh ra nó.
    expect(scopeCua(a, "role-teacher")).toEqual({
      unitOnly: ["c1"],
      unitAndBelow: ["c1"],
    });
  });

  it("[AC3] quyền HO/biên chế KHÔNG đổi vì điều động — không thành HO-level, vai giữ nguyên", () => {
    const a = buildUs10([gvPhongDaoTao(["cs1"])]);
    expect(a.isHoLevel).toBe(false);
    expect(a.isSuperAdmin).toBe(false);
    expect(a.orgRoles).toEqual([{ orgUnitId: "dt", roleCode: "TEACHER" }]);
    // Đúng 1 permission, đúng vai cũ — điều động KHÔNG phát thêm quyền.
    expect(a.permissions.map((p) => `${p.roleCode}:${p.action}`)).toEqual([
      "TEACHER:classes:view-own",
    ]);
  });

  it("[AC3] hết hiệu lực (caller không trả đơn vị nữa) → mất truy cập cơ sở đó NGAY", () => {
    const truoc = buildUs10([gvPhongDaoTao(["cs1"])]);
    const sau = buildUs10([gvPhongDaoTao([])]);
    expect(truoc.visibleCenterIds).toEqual(["c1"]);
    expect(sau.visibleCenterIds).toEqual([]);
    // và biên chế vẫn còn nguyên — mất cơ sở chứ không mất việc.
    expect(sau.orgRoles).toEqual([{ orgUnitId: "dt", roleCode: "TEACHER" }]);
  });

  it("điều động vào REGION → nhận CẢ nhánh (unitAndBelow), unitOnly rỗng vì vùng không phải cơ sở", () => {
    const a = buildUs10([gvPhongDaoTao(["dn"])]);
    expect(a.visibleCenterIds.sort()).toEqual(["c1", "c2"]);
    expect(scopeCua(a, "role-teacher")).toEqual({
      unitOnly: [],
      unitAndBelow: ["c1", "c2"],
    });
  });

  it("điều động NHIỀU cơ sở → hợp cả hai, không nhân bản", () => {
    const a = buildUs10([gvPhongDaoTao(["cs1", "cs2", "cs1"])]);
    expect(a.visibleCenterIds.sort()).toEqual(["c1", "c2"]);
    expect((scopeCua(a, "role-teacher") as { unitOnly: string[] }).unitOnly.sort()).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("người neo vai TẠI node HO: điều động là KHÔNG-OP, không nới thêm gì (đường cũ không đổi)", () => {
    const hoRow: UserOrgRoleRow = { ...gvPhongDaoTao(["cs1"]), orgUnitId: "ho" };
    const a = buildUs10([hoRow]);
    const khongDieuDong = buildUs10([{ ...hoRow, workScopeOrgUnitIds: [] }]);
    expect(a.visibleCenterIds.sort()).toEqual(khongDieuDong.visibleCenterIds.sort());
    expect(scopeCua(a, "role-teacher")).toBe("ALL");
  });
});
