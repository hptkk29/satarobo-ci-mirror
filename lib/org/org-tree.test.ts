// Vitest — ticket A0-01 (org-tree). Pure, không cần DB.
// Cây theo Doc 15 OI-1: ROOT → HO, CS1, CS2 ĐỘC LẬP ngang hàng.
import { describe, it, expect } from "vitest";
import {
  getSubtreeCenterIds,
  getSubtreeOrgUnitIds,
  getAncestors,
  isAncestor,
  getDescendants,
  selectableOrgUnits,
} from "./org-tree";
import type { OrgUnitNode } from "./types";

function baseTree(): OrgUnitNode[] {
  return [
    { id: "r", code: "SATAROBO", type: "ROOT", parentId: null },
    { id: "ho", code: "HO", type: "HO", parentId: "r" },
    { id: "cs1", code: "CS1", type: "CENTER", parentId: "r", centerId: "c1" },
    { id: "cs2", code: "CS2", type: "CENTER", parentId: "r", centerId: "c2" },
  ];
}

function namedTree(): (OrgUnitNode & { name: string })[] {
  return [
    { id: "r", code: "SATAROBO", type: "ROOT", parentId: null, name: "Sata Robo" },
    { id: "ho", code: "HO", type: "HO", parentId: "r", name: "Hội sở" },
    { id: "cs1", code: "CS1", type: "CENTER", parentId: "r", centerId: "c1", name: "Cơ sở 1" },
    { id: "cs2", code: "CS2", type: "CENTER", parentId: "r", centerId: "c2", name: "Cơ sở 2" },
  ];
}

describe("[Đợt0a] selectableOrgUnits — picker gồm HO, loại ROOT", () => {
  it("SUPER_ADMIN thấy HO + CS1 + CS2, KHÔNG có ROOT (sửa lỗi 'HO không hiện')", () => {
    const r = selectableOrgUnits(namedTree(), { isSuperAdmin: true });
    expect(r.map((u) => u.code)).toEqual(["CS1", "CS2", "HO"]);
    expect(r.find((u) => u.code === "HO")).toBeTruthy();
    expect(r.some((u) => u.type === "ROOT")).toBe(false);
  });

  it("HO-level (cross-center) thấy mọi đơn vị", () => {
    const r = selectableOrgUnits(namedTree(), { isHoLevel: true });
    expect(r.map((u) => u.code).sort()).toEqual(["CS1", "CS2", "HO"]);
  });

  it("types:['CENTER'] chỉ trả cơ sở vận hành (gán lead/lớp) — kèm centerId cũ", () => {
    const r = selectableOrgUnits(namedTree(), { isSuperAdmin: true }, { types: ["CENTER"] });
    expect(r.map((u) => u.code)).toEqual(["CS1", "CS2"]);
    expect(r.map((u) => u.centerId)).toEqual(["c1", "c2"]);
  });

  it("actor scope CS1: chỉ thấy CS1, cách ly khỏi CS2 + HO", () => {
    const r = selectableOrgUnits(namedTree(), { visibleCenterIds: ["c1"] });
    expect(r.map((u) => u.code)).toEqual(["CS1"]);
  });

  it("actor có role trực tiếp tại HO → thấy HO dù không HO-level toàn cục", () => {
    const r = selectableOrgUnits(namedTree(), {
      visibleCenterIds: ["c1"],
      roleOrgUnitIds: ["ho"],
    });
    expect(r.map((u) => u.code).sort()).toEqual(["CS1", "HO"]);
  });

  it("thêm CS3 (data) → picker tự gồm, không sửa code", () => {
    const tree = [
      ...namedTree(),
      { id: "cs3", code: "CS3", type: "CENTER" as const, parentId: "r", centerId: "c3", name: "Cơ sở 3" },
    ];
    const r = selectableOrgUnits(tree, { isSuperAdmin: true }, { types: ["CENTER"] });
    expect(r.map((u) => u.code)).toEqual(["CS1", "CS2", "CS3"]);
  });

  it("loại đơn vị đã soft-delete trừ khi includeDeleted", () => {
    const tree = namedTree();
    tree[1].deletedAt = new Date("2020-01-01");
    expect(selectableOrgUnits(tree, { isSuperAdmin: true }).some((u) => u.code === "HO")).toBe(false);
    expect(
      selectableOrgUnits(tree, { isSuperAdmin: true }, { includeDeleted: true }).some((u) => u.code === "HO"),
    ).toBe(true);
  });
});

describe("[A0-01] org-tree — subtree & quan hệ", () => {
  it("[A0-01-T1-03] getSubtreeCenterIds(CS1) = [c1]", () => {
    expect(getSubtreeCenterIds(baseTree(), "cs1")).toEqual(["c1"]);
  });

  it("[A0-01-T1-04] getSubtreeCenterIds(ROOT) = [c1, c2]", () => {
    expect(getSubtreeCenterIds(baseTree(), "r").sort()).toEqual(["c1", "c2"]);
  });

  it("[A0-01-T5-HO] getSubtreeCenterIds(HO) = [] — HO độc lập, KHÔNG cha CS1/CS2 (Doc 15 OI-1)", () => {
    expect(getSubtreeCenterIds(baseTree(), "ho")).toEqual([]);
  });

  it("[A0-01-T5-01] subtree(CS1) KHÔNG chứa c2 (cách ly cơ sở — nền A0-04)", () => {
    expect(getSubtreeCenterIds(baseTree(), "cs1")).not.toContain("c2");
  });

  it("[A0-01-T1-05] getAncestors(CS1) = [CS1, ROOT]", () => {
    expect(getAncestors(baseTree(), "cs1").map((n) => n.id)).toEqual(["cs1", "r"]);
  });

  it("[A0-01-T1-06] isAncestor: ROOT→CS2 = true, CS1→CS2 = false, CS2→CS2 = false", () => {
    const t = baseTree();
    expect(isAncestor(t, "r", "cs2")).toBe(true);
    expect(isAncestor(t, "cs1", "cs2")).toBe(false);
    expect(isAncestor(t, "cs2", "cs2")).toBe(false);
  });

  it("[A0-01-T5-02] thêm CS3 → subtree(ROOT) tự gồm c3 (không cần đổi code)", () => {
    const t = baseTree();
    t.push({ id: "cs3", code: "CS3", type: "CENTER", parentId: "r", centerId: "c3" });
    expect(getSubtreeCenterIds(t, "r").sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("[A0-01-T7-03] soft-delete CS1 → subtree(ROOT) loại c1", () => {
    const t = baseTree();
    t.find((n) => n.id === "cs1")!.deletedAt = new Date("2026-06-08");
    expect(getSubtreeCenterIds(t, "r")).toEqual(["c2"]);
  });

  it("[A0-01-T8-01] cây có node con đa cấp (CAMPUS dưới CENTER) — descendants đúng", () => {
    const t = baseTree();
    t.push({ id: "camp", code: "CS1A", type: "CAMPUS", parentId: "cs1" });
    expect(getDescendants(t, "cs1").map((n) => n.id)).toEqual(["camp"]);
    // CAMPUS không có centerId → subtree(CS1) vẫn chỉ [c1]
    expect(getSubtreeCenterIds(t, "cs1")).toEqual(["c1"]);
  });

  it("[Phase0] getSubtreeOrgUnitIds(CS1) = [cs1] (chính nó, mọi type)", () => {
    expect(getSubtreeOrgUnitIds(baseTree(), "cs1")).toEqual(["cs1"]);
  });

  it("[Phase0] getSubtreeOrgUnitIds(HO) = [ho] — HO độc lập (OI-1)", () => {
    expect(getSubtreeOrgUnitIds(baseTree(), "ho")).toEqual(["ho"]);
  });

  it("[Phase0] getSubtreeOrgUnitIds(ROOT) = mọi node sống (gồm cả non-CENTER)", () => {
    expect(getSubtreeOrgUnitIds(baseTree(), "r").sort()).toEqual(["cs1", "cs2", "ho", "r"]);
  });

  it("[Phase0] subtree(CS1) gồm CAMPUS con — khác getSubtreeCenterIds (chỉ centerId)", () => {
    const t = baseTree();
    t.push({ id: "camp", code: "CS1A", type: "CAMPUS", parentId: "cs1" });
    expect(getSubtreeOrgUnitIds(t, "cs1").sort()).toEqual(["camp", "cs1"]);
  });

  it("[Phase0] soft-delete loại khỏi subtree orgUnitIds trừ includeDeleted", () => {
    const t = baseTree();
    t.find((n) => n.id === "cs1")!.deletedAt = new Date("2026-06-08");
    expect(getSubtreeOrgUnitIds(t, "r")).not.toContain("cs1");
    expect(getSubtreeOrgUnitIds(t, "r", { includeDeleted: true })).toContain("cs1");
  });

  it("[A0-01-T8-02] dữ liệu vòng bẩn (parent trỏ vòng) không gây loop vô hạn", () => {
    const t: OrgUnitNode[] = [
      { id: "a", code: "AA", type: "CENTER", parentId: "b", centerId: "ca" },
      { id: "b", code: "BB", type: "CENTER", parentId: "a", centerId: "cb" },
    ];
    expect(() => getAncestors(t, "a")).not.toThrow();
    expect(() => getDescendants(t, "a")).not.toThrow();
  });
});
