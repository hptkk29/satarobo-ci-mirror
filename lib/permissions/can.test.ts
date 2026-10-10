// US-02 (TS-02 phần ROLE-grant) — engine can() hợp nhất · viết TRƯỚC hiện thực (luật #5).
//
// Hợp đồng đông cứng (thiết kế US-02 đã duyệt 09/08/2026):
// - resolveGrant(actor, key, target): PURE + SYNC, chỉ đọc bảng grant MỚI đã nạp sẵn
//   trên Actor (actor.permissionGrants) — TUYỆT ĐỐI không đọc UserPermissionGrant cũ
//   (test ghim [A0-03-T6-02] phải xanh nguyên trạng).
// - DENY (fieldMask rỗng) thắng ALLOW cùng key; DENY có fieldMask = DENY cấp trường
//   (không chặn action, chỉ góp mask). Grant ĐÃ nói về key thì nó là nguồn sự thật:
//   scope fail → false, KHÔNG rơi xuống đường cũ. Không grant nào khớp → fallback canV2.
// - SUPER_ADMIN bỏ qua grant (chống tự khoá admin bằng DENY nhầm).
import { describe, it, expect } from "vitest";
import type { Actor, Target } from "@/lib/auth/actor";
import { can as canV2 } from "@/lib/auth/can";
import {
  can,
  resolveGrant,
  getFieldMask,
  assertCan,
  type GrantRow,
} from "@/lib/permissions/can";

/** Actor tối giản — field mới của US-02 (roleIds/groupIds/permissionGrants/roleCenterScope) là optional additive. */
function makeActor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: "u1",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    ...overrides,
  };
}

const R1 = "roledef-1";

function grant(partial: Partial<GrantRow>): GrantRow {
  return {
    subjectType: "ROLE",
    subjectId: R1,
    permissionKey: "students:view-all",
    effect: "ALLOW",
    dataScope: "ALL",
    fieldMask: [],
    ...partial,
  };
}

describe("US-02 · DENY > ALLOW tường minh (ROLE grant)", () => {
  it("DENY fieldMask rỗng thắng ALLOW cùng key → chặn hẳn action", () => {
    const actor = makeActor({
      roleIds: [R1],
      permissionGrants: [
        grant({ effect: "ALLOW" }),
        grant({ effect: "DENY" }),
      ],
    });
    const d = resolveGrant(actor, "students:view-all");
    expect(d.hit).toBe(true);
    if (d.hit) expect(d.allowed).toBe(false);
    expect(can(actor, "students:view-all")).toBe(false);
    expect(() => assertCan(actor, "students:view-all")).toThrow();
  });

  it("DENY có fieldMask = DENY cấp trường: action vẫn ALLOW, trường bị che (TS-02)", () => {
    const actor = makeActor({
      roleIds: [R1],
      permissionGrants: [
        grant({ effect: "ALLOW" }),
        grant({ effect: "DENY", fieldMask: ["phone"] }),
      ],
    });
    expect(can(actor, "students:view-all")).toBe(true);
    expect(getFieldMask(actor, "students:view-all")).toEqual(["phone"]);
  });

  it("grant của role actor KHÔNG giữ (subjectId lạ) → không tính", () => {
    const actor = makeActor({
      roleIds: [R1],
      permissionGrants: [grant({ effect: "DENY", subjectId: "roledef-khac" })],
    });
    expect(resolveGrant(actor, "students:view-all").hit).toBe(false);
  });
});

describe("US-02 · grant là nguồn sự thật khi hit — scope fail KHÔNG fallback", () => {
  it("ALLOW UNIT_ONLY nhưng target lệch cơ sở → false, dù đường cũ (grantsAllow) cho phép", () => {
    const actor = makeActor({
      roleIds: [R1],
      roleCenterScope: { [R1]: { unitOnly: ["c1"], unitAndBelow: ["c1"] } },
      grantsAllow: new Set(["students:view-all"]), // đường cũ sẽ nói TRUE
      permissionGrants: [grant({ dataScope: "UNIT_ONLY" })],
    });
    const target: Target = { centerId: "c2" };
    expect(canV2(actor, "students:view-all", target)).toBe(true); // chứng minh lệch có chủ đích
    expect(can(actor, "students:view-all", target)).toBe(false);
  });
});

describe("US-02 · bảng chân trị 4 dataScope × {null, khớp, lệch} (AC3 — fallback centerId)", () => {
  const cases: Array<{
    scope: GrantRow["dataScope"];
    actor: () => Actor;
    nullExpect: boolean;
    match: { target: Target; expect: boolean };
    mismatch: { target: Target; expect: boolean };
  }> = [
    {
      scope: "ALL",
      actor: () => makeActor({ roleIds: [R1], permissionGrants: [grant({ dataScope: "ALL" })] }),
      nullExpect: true,
      match: { target: { centerId: "c1" }, expect: true },
      mismatch: { target: { centerId: "c9" }, expect: true },
    },
    {
      // PER-ROLE (điều chỉnh review 09/08): neo roleCenterScope[subjectId], KHÔNG dùng
      // union visibleCenterIds toàn actor — visibleCenterIds có c3 nhưng vẫn phải false.
      scope: "UNIT_AND_BELOW",
      actor: () =>
        makeActor({
          roleIds: [R1],
          // P1 · US-05 — shape 2 mức: role đặt tại CS1, nhánh của nó gồm c1+c2.
          roleCenterScope: { [R1]: { unitOnly: ["c1"], unitAndBelow: ["c1", "c2"] } },
          visibleCenterIds: ["c1", "c2", "c3"],
          permissionGrants: [grant({ dataScope: "UNIT_AND_BELOW" })],
        }),
      nullExpect: false,
      match: { target: { centerId: "c2" }, expect: true },
      mismatch: { target: { centerId: "c3" }, expect: false },
    },
    {
      scope: "UNIT_ONLY",
      actor: () =>
        makeActor({
          roleIds: [R1],
          roleCenterScope: { [R1]: { unitOnly: ["c1"], unitAndBelow: ["c1"] } },
          permissionGrants: [grant({ dataScope: "UNIT_ONLY" })],
        }),
      nullExpect: false,
      match: { target: { centerId: "c1" }, expect: true },
      mismatch: { target: { centerId: "c2" }, expect: false },
    },
    {
      scope: "OWN",
      actor: () => makeActor({ roleIds: [R1], permissionGrants: [grant({ dataScope: "OWN" })] }),
      nullExpect: false,
      match: { target: { createdById: "u1" }, expect: true },
      mismatch: { target: { createdById: "u2" }, expect: false },
    },
  ];

  for (const c of cases) {
    it(`${c.scope}: null=${c.nullExpect} · khớp=${c.match.expect} · lệch=${c.mismatch.expect}`, () => {
      expect(can(c.actor(), "students:view-all")).toBe(c.nullExpect);
      expect(can(c.actor(), "students:view-all", c.match.target)).toBe(c.match.expect);
      expect(can(c.actor(), "students:view-all", c.mismatch.target)).toBe(c.mismatch.expect);
    });
  }
});

describe("US-02 · không grant khớp → fallback NGUYÊN TRẠNG canV2 (luật #2)", () => {
  it("bảng grant rỗng → kết quả HỆT canV2 (cả allow lẫn deny)", () => {
    const allowed = makeActor({ grantsAllow: new Set(["students:view-all"]) });
    const denied = makeActor();
    for (const [actor, target] of [
      [allowed, undefined],
      [allowed, { centerId: "c1" }],
      [denied, undefined],
      [denied, { centerId: "c1" }],
    ] as Array<[Actor, Target | undefined]>) {
      expect(can(actor, "students:view-all", target)).toBe(
        canV2(actor, "students:view-all", target),
      );
    }
  });

  it("grant về key KHÁC không ảnh hưởng key đang hỏi → fallback", () => {
    const actor = makeActor({
      roleIds: [R1],
      grantsAllow: new Set(["students:view-all"]),
      permissionGrants: [grant({ permissionKey: "leads:view-all", effect: "DENY" })],
    });
    expect(can(actor, "students:view-all")).toBe(true); // theo đường cũ
  });

  it("grant GROUP khi actor chưa có nhóm (groupIds rỗng/undefined) → miss → fallback", () => {
    const actor = makeActor({
      roleIds: [R1],
      permissionGrants: [grant({ subjectType: "GROUP", subjectId: "g1", effect: "DENY" })],
    });
    expect(resolveGrant(actor, "students:view-all").hit).toBe(false);
  });
});

describe("US-02 · chống rò NGANG qua role kiêm nhiệm (review 09/08)", () => {
  it("grant UNIT_AND_BELOW của role CS1 KHÔNG vươn sang CS2 dù visibleCenterIds có c2 (role khác)", () => {
    // Kịch bản review: kiêm nhiệm R1@CS1 + TEACHER@CS2 — grant đứng tên R1 chỉ phủ CS1.
    const actor = makeActor({
      roleIds: [R1],
      roleCenterScope: { [R1]: { unitOnly: ["c1"], unitAndBelow: ["c1"] } },
      visibleCenterIds: ["c1", "c2"],
      permissionGrants: [grant({ dataScope: "UNIT_AND_BELOW" })],
    });
    expect(can(actor, "students:view-all", { centerId: "c1" })).toBe(true);
    expect(can(actor, "students:view-all", { centerId: "c2" })).toBe(false);
  });

  it("row ALLOW mang fieldMask là dữ liệu vô nghĩa → bị bỏ qua (fallback), không mở quyền", () => {
    const actor = makeActor({
      roleIds: [R1],
      permissionGrants: [grant({ effect: "ALLOW", fieldMask: ["name"] })],
    });
    // Row invalid bị loại → không grant nào khớp → hit:false, quyền theo đường cũ (rỗng = false).
    expect(resolveGrant(actor, "students:view-all").hit).toBe(false);
    expect(can(actor, "students:view-all")).toBe(false);
    expect(getFieldMask(actor, "students:view-all")).toEqual([]);
  });
});

describe("US-03 · GROUP grant (GHIM — engine US-02 đã sẵn nhánh GROUP, các case này XANH NGAY)", () => {
  // Vai trò của describe này là ĐÔNG CỨNG hành vi GROUP của engine TRƯỚC khi US-03 nối
  // dây thật (schema UserGroup + resolveActor nạp groupIds). Nếu ai sửa engine trong lúc
  // làm US-03 mà lệch các chân trị này → đỏ ngay ở unit, không đợi tới integration.
  const G1 = "group-1";

  it("GROUP ALLOW dataScope ALL, actor thuộc nhóm → hit + true", () => {
    const actor = makeActor({
      groupIds: [G1],
      permissionGrants: [grant({ subjectType: "GROUP", subjectId: G1, effect: "ALLOW" })],
    });
    const d = resolveGrant(actor, "students:view-all");
    expect(d.hit).toBe(true);
    if (d.hit) expect(d.allowed).toBe(true);
    expect(can(actor, "students:view-all")).toBe(true);
  });

  it("GROUP DENY toàn-action thắng ROLE ALLOW cùng key (AC2 US-03 — DENY nhóm > ALLOW vai)", () => {
    const actor = makeActor({
      roleIds: [R1],
      groupIds: [G1],
      permissionGrants: [
        grant({ subjectType: "ROLE", subjectId: R1, effect: "ALLOW" }),
        grant({ subjectType: "GROUP", subjectId: G1, effect: "DENY" }),
      ],
    });
    expect(can(actor, "students:view-all")).toBe(false);
    expect(() => assertCan(actor, "students:view-all")).toThrow();
  });

  it("GROUP DENY fieldMask góp mask qua getFieldMask CẢ KHI resolveGrant hit:false (TS-02 vế 1)", () => {
    // Chỉ có DENY cấp trường, không ALLOW nào cùng key trong bảng grant → hit:false,
    // action ALLOW đến từ ĐƯỜNG CŨ (grantsAllow) — nhưng trường vẫn phải che.
    const actor = makeActor({
      groupIds: [G1],
      grantsAllow: new Set(["students:view-all"]),
      permissionGrants: [
        grant({ subjectType: "GROUP", subjectId: G1, effect: "DENY", fieldMask: ["parentPhone"] }),
      ],
    });
    expect(resolveGrant(actor, "students:view-all").hit).toBe(false);
    expect(can(actor, "students:view-all")).toBe(true); // ALLOW từ đường cũ
    expect(getFieldMask(actor, "students:view-all")).toEqual(["parentPhone"]);
  });

  it("groupIds KHÔNG chứa subjectId → miss (grant nhóm khác không dính actor)", () => {
    const actor = makeActor({
      groupIds: ["group-khac"],
      grantsAllow: new Set(["students:view-all"]),
      permissionGrants: [grant({ subjectType: "GROUP", subjectId: G1, effect: "DENY" })],
    });
    expect(resolveGrant(actor, "students:view-all").hit).toBe(false);
    expect(can(actor, "students:view-all")).toBe(true); // fallback đường cũ
    expect(getFieldMask(actor, "students:view-all")).toEqual([]);
  });

  it("[PIN] GROUP + UNIT_ONLY thiếu mapping roleCenterScope → false (vì sao validator US-03 chặn UNIT_*)", () => {
    // roleCenterScope chỉ có entry cho RoleDef.id (buildActor) — GROUP không có mapping
    // center tới P1 ⇒ scopeSatisfied trả false an toàn ⇒ ALLOW hit nhưng allowed=false.
    // Đây CHÍNH là lý do write path US-03 chỉ cho dataScope ALL|OWN: grant UNIT_* cho
    // nhóm sẽ "trông như có" mà không bao giờ hoạt động.
    const actor = makeActor({
      groupIds: [G1],
      permissionGrants: [
        grant({ subjectType: "GROUP", subjectId: G1, effect: "ALLOW", dataScope: "UNIT_ONLY" }),
      ],
    });
    const d = resolveGrant(actor, "students:view-all", { centerId: "c1" });
    expect(d.hit).toBe(true);
    if (d.hit) expect(d.allowed).toBe(false);
    expect(can(actor, "students:view-all", { centerId: "c1" })).toBe(false);
  });

  it("SUPER_ADMIN bypass grant GROUP (DENY nhóm không khoá được admin)", () => {
    const actor = makeActor({
      isSuperAdmin: true,
      groupIds: [G1],
      permissionGrants: [grant({ subjectType: "GROUP", subjectId: G1, effect: "DENY" })],
    });
    expect(can(actor, "students:view-all")).toBe(true);
    expect(getFieldMask(actor, "students:view-all")).toEqual([]);
  });
});

describe("US-02 · SUPER_ADMIN bỏ qua grant + engine pure", () => {
  it("DENY trùm không khoá được SUPER_ADMIN", () => {
    const actor = makeActor({
      isSuperAdmin: true,
      roleIds: [R1],
      permissionGrants: [grant({ effect: "DENY" })],
    });
    expect(can(actor, "students:view-all")).toBe(true);
  });

  it("resolveGrant pure — gọi 2 lần cùng input cho cùng output", () => {
    const actor = makeActor({
      roleIds: [R1],
      permissionGrants: [grant({ effect: "ALLOW" }), grant({ effect: "DENY", fieldMask: ["phone"] })],
    });
    expect(resolveGrant(actor, "students:view-all")).toEqual(
      resolveGrant(actor, "students:view-all"),
    );
  });
});
