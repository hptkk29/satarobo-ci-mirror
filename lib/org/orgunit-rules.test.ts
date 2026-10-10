// Vitest — ticket A0-01 (validation rules + Zod schema). Pure, không cần DB.
import { describe, it, expect } from "vitest";
import {
  normalizeCode,
  validateCode,
  validateRootRule,
  validateCenterId,
  wouldCreateCycle,
} from "./orgunit-rules";
import { OrgRuleError, type OrgUnitNode } from "./types";
import { orgUnitCreateSchema } from "@/lib/validators/orgunit";

describe("[A0-01] validateCode (V2)", () => {
  it("[A0-01-T1-01] code hợp lệ + chuẩn hóa uppercase", () => {
    expect(validateCode("cs1")).toBe("CS1");
    expect(normalizeCode("  cs1 ")).toBe("CS1");
  });
  it("[A0-01-T2-02] code rỗng → ORG_CODE_REQUIRED", () => {
    expect(() => validateCode("")).toThrowError(OrgRuleError);
    try { validateCode("  "); } catch (e) { expect((e as OrgRuleError).code).toBe("ORG_CODE_REQUIRED"); }
  });
  it("[A0-01-T2-03] code có khoảng trắng/ký tự lạ → ORG_CODE_INVALID", () => {
    try { validateCode("cs 1"); } catch (e) { expect((e as OrgRuleError).code).toBe("ORG_CODE_INVALID"); }
    expect(() => validateCode("cs@1")).toThrow();
  });
  it("[A0-01-T3-01] biên độ dài: 2 ký tự OK", () => {
    expect(validateCode("ho")).toBe("HO");
  });
  it("[A0-01-T3-02] biên độ dài: 20 ký tự OK, 21 ký tự → lỗi", () => {
    expect(validateCode("A".repeat(20))).toBe("A".repeat(20));
    expect(() => validateCode("A".repeat(21))).toThrow();
  });
});

describe("[A0-01] validateRootRule (V3)", () => {
  it("[A0-01-T2-07] tạo ROOT thứ 2 → ORG_MULTIPLE_ROOT", () => {
    try {
      validateRootRule({ type: "ROOT", parentId: null, existingRootId: "r0", selfId: "new" });
    } catch (e) { expect((e as OrgRuleError).code).toBe("ORG_MULTIPLE_ROOT"); }
  });
  it("[A0-01-T2-07b] ROOT có parent → ORG_ROOT_HAS_PARENT", () => {
    expect(() => validateRootRule({ type: "ROOT", parentId: "x" })).toThrow();
  });
  it("[A0-01-T2-04] non-ROOT thiếu parent → ORG_PARENT_REQUIRED", () => {
    try { validateRootRule({ type: "CENTER", parentId: null }); }
    catch (e) { expect((e as OrgRuleError).code).toBe("ORG_PARENT_REQUIRED"); }
  });
  it("update chính ROOT hiện tại (selfId === existingRootId) → OK", () => {
    expect(() => validateRootRule({ type: "ROOT", parentId: null, existingRootId: "r0", selfId: "r0" })).not.toThrow();
  });
});

describe("[A0-01] validateCenterId (V7)", () => {
  it("[A0-01-T2-08] HO + centerId → ORG_CENTERID_NOT_CENTER", () => {
    try { validateCenterId("HO", "c1"); }
    catch (e) { expect((e as OrgRuleError).code).toBe("ORG_CENTERID_NOT_CENTER"); }
  });
  it("CENTER + centerId → OK; CENTER + null → OK", () => {
    expect(() => validateCenterId("CENTER", "c1")).not.toThrow();
    expect(() => validateCenterId("CENTER", null)).not.toThrow();
  });
});

describe("[A0-01] wouldCreateCycle (V5/V6)", () => {
  const tree: OrgUnitNode[] = [
    { id: "r", code: "SATAROBO", type: "ROOT", parentId: null },
    { id: "cs1", code: "CS1", type: "CENTER", parentId: "r", centerId: "c1" },
    { id: "camp", code: "CS1A", type: "CAMPUS", parentId: "cs1" },
  ];
  it("[A0-01-T7-02] tự làm cha chính nó → cycle", () => {
    expect(wouldCreateCycle(tree, "cs1", "cs1")).toBe(true);
  });
  it("[A0-01-T7-01] đặt parent = hậu duệ của mình (ROOT→CAMP) → cycle", () => {
    expect(wouldCreateCycle(tree, "r", "camp")).toBe(true); // r là tổ tiên của camp
  });
  it("đặt parent hợp lệ (CS1 → ROOT) → KHÔNG cycle", () => {
    expect(wouldCreateCycle(tree, "cs1", "r")).toBe(false);
  });
  it("parent null → KHÔNG cycle", () => {
    expect(wouldCreateCycle(tree, "cs1", null)).toBe(false);
  });
});

describe("[A0-01] Zod orgUnitCreateSchema", () => {
  it("[A0-01-T3-03] HO và CS2 cùng address nhưng khác đơn vị → đều parse OK", () => {
    const addr = "114 Hoàng Diệu, Đà Nẵng";
    expect(orgUnitCreateSchema.safeParse({ type: "HO", code: "HO", name: "Hội sở", parentId: "r", address: addr }).success).toBe(true);
    expect(orgUnitCreateSchema.safeParse({ type: "CENTER", code: "CS2", name: "Cơ sở 2", parentId: "r", address: addr, centerId: "c2" }).success).toBe(true);
  });
  it("[A0-01-T2-08b] non-CENTER + centerId → schema fail", () => {
    const r = orgUnitCreateSchema.safeParse({ type: "HO", code: "HO", name: "Hội sở", parentId: "r", centerId: "c1" });
    expect(r.success).toBe(false);
  });
  it("[A0-01-T2-07c] ROOT + parentId → schema fail; non-ROOT thiếu parentId → fail", () => {
    expect(orgUnitCreateSchema.safeParse({ type: "ROOT", code: "SATAROBO", name: "Sata", parentId: "x" }).success).toBe(false);
    expect(orgUnitCreateSchema.safeParse({ type: "CENTER", code: "CS9", name: "CS9" }).success).toBe(false);
  });
  it("[A0-01-T1-02] input hợp lệ tối thiểu (ROOT) → parse OK + code uppercase", () => {
    const r = orgUnitCreateSchema.safeParse({ type: "ROOT", code: "satarobo", name: "Sata Robo" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.code).toBe("SATAROBO");
  });
});
