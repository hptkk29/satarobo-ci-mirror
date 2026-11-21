// lib/org/path.test.ts — Nền Hệ thống P1 · US-05 (TS-05 phần THUẦN).
// VIẾT TRƯỚC phần hiện thực (luật cứng Nền Hệ thống #5). Chạy ở job `unit-tests`.
//
// Ranh giới với tầng DB: file này đóng băng CÔNG THỨC path/depth và luật cây. Phần
// "dời node cập nhật cả cây con TRONG MỘT transaction" là hành vi DB → nằm ở
// tests/e2e/a0/orgunit-path.spec.ts (job e2e-a0, có Postgres).

import { describe, expect, it } from "vitest";
import {
  buildPath,
  childPath,
  isUnderPath,
  recomputeSubtree,
  slugOf,
} from "./path";
import { centerScopeForOrgUnit } from "./org-tree";
import { validateParentType } from "./orgunit-rules";
import { isOrgUnitActiveAt, isOrgUnitLive, statusFromIsActive } from "./status";
import { OrgRuleError, type OrgUnitNode } from "./types";

/** Cây mẫu chuẩn của 04-TestScenarios, dựng bằng parentId (khác matrix-fixture: nó dùng path). */
function tree(): OrgUnitNode[] {
  return [
    { id: "ho", code: "HO", type: "HO", parentId: null },
    { id: "vunga", code: "VUNG_A", type: "REGION", parentId: "ho" },
    { id: "dn", code: "DANANG", type: "REGION", parentId: "ho" },
    { id: "csf", code: "CS_F", type: "CENTER", parentId: "vunga", centerId: "center-cs-f" },
    { id: "cs1", code: "CS1", type: "CENTER", parentId: "dn", centerId: "center-cs1" },
    { id: "csl", code: "CS_L", type: "CENTER", parentId: "dn", centerId: "center-cs-l" },
  ];
}

describe("[US-05] slug + path", () => {
  it("[US-05-U-01] slug = code viết thường, gạch dưới thành gạch ngang", () => {
    expect(slugOf("HO")).toBe("ho");
    expect(slugOf("CS_F")).toBe("cs-f");
    expect(slugOf("VUNG_A")).toBe("vung-a");
  });

  it("[US-05-U-02] path luôn mở đầu VÀ kết thúc bằng '/'", () => {
    expect(buildPath(tree(), "cs1")).toBe("/ho/danang/cs1/");
    expect(buildPath(tree(), "ho")).toBe("/ho/");
  });

  it("[US-05-U-03] childPath nối path cha + slug con", () => {
    expect(childPath("/ho/danang/", "CS1")).toBe("/ho/danang/cs1/");
    expect(childPath(null, "HO")).toBe("/ho/");
  });

  it("[US-05-U-04] '/' cuối chặn tiền tố dính: /cs1/ KHÔNG khớp /cs10/", () => {
    // Đây là lý do duy nhất path phải có '/' cuối. Không có nó, UNIT_AND_BELOW của CS1
    // sẽ nuốt luôn dữ liệu của CS10 — lỗi rò quyền im lặng, không ai thấy.
    expect(isUnderPath("/ho/danang/cs10/", "/ho/danang/cs1/")).toBe(false);
    expect(isUnderPath("/ho/danang/cs1/", "/ho/danang/cs1/")).toBe(true); // gồm chính nó
    expect(isUnderPath("/ho/danang/cs1/lab/", "/ho/danang/cs1/")).toBe(true);
    expect(isUnderPath("/ho/vung-a/cs-f/", "/ho/danang/")).toBe(false);
  });

  it("[US-05-U-05] công thức slug TRÙNG với SQL backfill của migration", () => {
    // Migration 20260811030000 dùng `replace(lower(code),'_','-')`. Hai chỗ lệch nhau là
    // path do DB sinh khác path do app sinh ⇒ scope hụt im lặng. Test này là dây nối.
    const sqlEquivalent = (code: string) => code.toLowerCase().replace(/_/g, "-");
    for (const code of ["HO", "CS_F", "VUNG_A", "CS1", "PHONG_DAO_TAO_2"]) {
      expect(slugOf(code)).toBe(sqlEquivalent(code));
    }
  });

  it("[US-05-U-06] depth = số segment - 1", () => {
    expect(buildPath(tree(), "ho")?.split("/").filter(Boolean).length).toBe(1);
    expect(buildPath(tree(), "cs1")?.split("/").filter(Boolean).length).toBe(3);
  });
});

describe("[US-05] recomputeSubtree — dời node là tính lại cả nhánh", () => {
  it("[US-05-U-07] dời CS_F từ Vùng-A sang Đà Nẵng: đổi path CS_F", () => {
    const nodes = tree();
    const moved = nodes.map((n) => (n.id === "csf" ? { ...n, parentId: "dn" } : n));
    const out = recomputeSubtree(moved, "csf");
    expect(out.find((r) => r.id === "csf")?.path).toBe("/ho/danang/cs-f/");
    expect(out.find((r) => r.id === "csf")?.depth).toBe(2);
  });

  it("[US-05-U-08] dời node có CON: mọi hậu duệ đổi path trong CÙNG một kết quả", () => {
    // TS-05 nguyên văn: "path CS-F và toàn bộ con cháu đổi trong 1 transaction".
    const nodes: OrgUnitNode[] = [
      ...tree(),
      { id: "lab", code: "LAB1", type: "DEPARTMENT", parentId: "csf" },
      { id: "kho", code: "KHO", type: "DEPARTMENT", parentId: "lab" },
    ];
    const moved = nodes.map((n) => (n.id === "csf" ? { ...n, parentId: "dn" } : n));
    const out = recomputeSubtree(moved, "csf");

    expect(out.map((r) => r.id).sort()).toEqual(["csf", "kho", "lab"]);
    expect(out.find((r) => r.id === "lab")?.path).toBe("/ho/danang/cs-f/lab1/");
    expect(out.find((r) => r.id === "kho")?.path).toBe("/ho/danang/cs-f/lab1/kho/");
    expect(out.find((r) => r.id === "kho")?.depth).toBe(4);
  });

  it("[US-05-U-09] đổi CODE cũng phải tính lại cả nhánh, không chỉ đổi parent", () => {
    const nodes = tree().map((n) => (n.id === "dn" ? { ...n, code: "DA_NANG" } : n));
    const out = recomputeSubtree(nodes, "dn");
    expect(out.find((r) => r.id === "dn")?.path).toBe("/ho/da-nang/");
    expect(out.find((r) => r.id === "cs1")?.path).toBe("/ho/da-nang/cs1/");
  });

  it("[US-05-U-10] dữ liệu bẩn có vòng: dừng, KHÔNG treo vô hạn", () => {
    const nodes: OrgUnitNode[] = [
      { id: "a", code: "A1", type: "REGION", parentId: "b" },
      { id: "b", code: "B1", type: "REGION", parentId: "a" },
    ];
    expect(() => recomputeSubtree(nodes, "a")).toThrow(OrgRuleError);
  });
});

describe("[US-05] AC3 — luật loại cha/con", () => {
  it("[US-05-U-11] CENTER KHÔNG được làm cha của REGION", () => {
    expect(() => validateParentType("REGION", "CENTER")).toThrow(OrgRuleError);
    try {
      validateParentType("REGION", "CENTER");
    } catch (e) {
      expect((e as OrgRuleError).code).toBe("ORG_PARENT_TYPE_INVALID");
    }
  });

  it("[US-05-U-12] REGION dưới HO, CENTER dưới REGION — hợp lệ", () => {
    expect(() => validateParentType("REGION", "HO")).not.toThrow();
    expect(() => validateParentType("CENTER", "REGION")).not.toThrow();
  });

  it("[US-05-U-13] cây PHẲNG cũ (CENTER dưới ROOT/HO) vẫn hợp lệ — chưa dời thì không phải lỗi", () => {
    expect(() => validateParentType("CENTER", "ROOT")).not.toThrow();
    expect(() => validateParentType("CENTER", "HO")).not.toThrow();
  });

  it("[US-05-U-14] HO không nằm dưới CENTER; ROOT không có cha", () => {
    expect(() => validateParentType("HO", "CENTER")).toThrow(OrgRuleError);
    expect(() => validateParentType("ROOT", "HO")).toThrow(OrgRuleError);
    expect(() => validateParentType("HO", null)).not.toThrow(); // HO đứng gốc
  });
});

describe("[US-05] phạm vi cơ sở — tách UNIT_ONLY khỏi UNIT_AND_BELOW", () => {
  /** Cây mẫu + path đã điền (mô phỏng sau backfill). */
  function treeWithPath(): OrgUnitNode[] {
    const base = tree();
    return base.map((n) => ({ ...n, path: buildPath(base, n.id) }));
  }

  it("[US-05-U-18] phạm vi KHÔNG phụ thuộc việc node đã có path hay chưa", () => {
    // centerScopeForOrgUnit cố ý CHỈ duyệt parentId (xem ghi chú trong org-tree.ts:
    // so prefix path bỏ qua liveness của tổ tiên ⇒ nở quyền). Test này ghim điều đó:
    // thêm/bớt cột path KHÔNG được làm đổi kết quả phạm vi.
    const withPath = treeWithPath();
    const withoutPath = tree();
    for (const id of ["ho", "dn", "vunga", "cs1", "csf"]) {
      expect(centerScopeForOrgUnit(withPath, id).unitAndBelow.sort()).toEqual(
        centerScopeForOrgUnit(withoutPath, id).unitAndBelow.sort(),
      );
    }
  });

  it("[US-05-U-18b] vùng CHẾT thì cơ sở dưới nó rơi khỏi phạm vi của HO", () => {
    // Đây là ngữ nghĩa mà so prefix path KHÔNG có. Ghim lại để ai định "tối ưu" bằng path
    // sẽ thấy đỏ ngay, thay vì mở rộng quyền im lặng.
    const t = treeWithPath().map((n) => (n.id === "dn" ? { ...n, status: "SUSPENDED" as const } : n));
    expect(centerScopeForOrgUnit(t, "ho").unitAndBelow).toEqual(["center-cs-f"]);
  });

  it("[US-05-U-19] REGION: unitOnly rỗng, unitAndBelow = cơ sở trong vùng", () => {
    const t = treeWithPath();
    expect(centerScopeForOrgUnit(t, "dn")).toEqual({
      unitOnly: [],
      unitAndBelow: ["center-cs1", "center-cs-l"],
    });
  });

  it("[US-05-U-20] CENTER: hai mức trùng nhau (cơ sở không có cơ sở con)", () => {
    const t = treeWithPath();
    expect(centerScopeForOrgUnit(t, "cs1")).toEqual({
      unitOnly: ["center-cs1"],
      unitAndBelow: ["center-cs1"],
    });
  });

  it("[US-05-U-21] HO là tổ tiên mọi cơ sở sau khi dời cây — KHÁC hành vi trước P1", () => {
    // Trước P1: getSubtreeCenterIds(HO) === [] (Doc 15 OI-1, có test ghim).
    // Sau khi chốt hình cây theo BA 08/08, HO đứng gốc nên nhánh của nó chứa mọi cơ sở.
    const t = treeWithPath();
    expect(centerScopeForOrgUnit(t, "ho").unitAndBelow.sort()).toEqual(
      ["center-cs-f", "center-cs-l", "center-cs1"].sort(),
    );
    expect(centerScopeForOrgUnit(t, "ho").unitOnly).toEqual([]);
  });

  it("[US-05-U-22] cơ sở đã xoá mềm KHÔNG lọt vào phạm vi", () => {
    const t = treeWithPath().map((n) =>
      n.id === "csl" ? { ...n, deletedAt: new Date() } : n,
    );
    expect(centerScopeForOrgUnit(t, "dn").unitAndBelow).toEqual(["center-cs1"]);
  });
});

describe("[US-05] trạng thái — ĐÚNG MỘT định nghĩa 'còn sống'", () => {
  const base: OrgUnitNode = { id: "x", code: "X1", type: "CENTER", parentId: null };

  it("[US-05-U-15] status là GƯƠNG của isActive, không phải nguồn sự thật thứ ba", () => {
    expect(statusFromIsActive(true)).toBe("ACTIVE");
    expect(statusFromIsActive(false)).toBe("SUSPENDED");
  });

  it("[US-05-U-16] bất kỳ cờ nào báo chết thì isOrgUnitLive = false", () => {
    expect(isOrgUnitLive(base)).toBe(true);
    expect(isOrgUnitLive({ ...base, deletedAt: new Date() })).toBe(false);
    expect(isOrgUnitLive({ ...base, isActive: false })).toBe(false);
    expect(isOrgUnitLive({ ...base, status: "SUSPENDED" })).toBe(false);
    expect(isOrgUnitLive({ ...base, status: "CLOSED" })).toBe(false);
  });

  it("[US-05-U-17] khoảng hiệu lực: ngoài [effectiveFrom, effectiveTo] là KHÔNG active", () => {
    const at = new Date("2026-08-11T00:00:00Z");
    expect(isOrgUnitActiveAt({ ...base, effectiveFrom: new Date("2026-09-01") }, at)).toBe(false);
    expect(isOrgUnitActiveAt({ ...base, effectiveTo: new Date("2026-08-01") }, at)).toBe(false);
    expect(
      isOrgUnitActiveAt(
        { ...base, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-12-31") },
        at,
      ),
    ).toBe(true);
    expect(isOrgUnitActiveAt(base, at)).toBe(true); // không đặt hạn = vô thời hạn
  });
});
