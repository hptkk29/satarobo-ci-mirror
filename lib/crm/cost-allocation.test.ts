// R1-09 — CPL/CPA/CP_TT + canReopen (THUẦN). Pure.
import { describe, it, expect } from "vitest";
import { computeCpl, computeCpa, computeCpTt, canReopenCost } from "@/lib/crm/cost-allocation";

describe("[R1-09] cost calc", () => {
  it("[R1-09-C9.1] CPL = spend/L2; CP_TT = CPL × L2 của tổ", () => {
    const cpl = computeCpl(1_000_000, 50);
    expect(cpl).toBe(20_000);
    expect(computeCpTt(cpl, 10)).toBe(200_000);
  });

  it("CPA = spend/L3", () => {
    expect(computeCpa(1_000_000, 20)).toBe(50_000);
  });

  it("[R1-09-C9.2] chia 0 khi L2/L3=0 → 0, không crash", () => {
    expect(computeCpl(1_000_000, 0)).toBe(0);
    expect(computeCpa(1_000_000, 0)).toBe(0);
  });

  it("[R1-09-C9.4] canReopenCost: SUPER_ADMIN/HO_ACCOUNTANT → true; khác → false", () => {
    expect(canReopenCost({ isSuperAdmin: true, orgRoles: [] })).toBe(true);
    expect(canReopenCost({ isSuperAdmin: false, orgRoles: [{ roleCode: "HO_ACCOUNTANT" }] })).toBe(true);
    expect(canReopenCost({ isSuperAdmin: false, orgRoles: [{ roleCode: "CENTER_MANAGER" }] })).toBe(false);
  });
});
