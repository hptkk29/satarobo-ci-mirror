// R7-03 — computeEnrollmentPrice (THUẦN). Pure.
import { describe, it, expect } from "vitest";
import { computeEnrollmentPrice } from "@/lib/finance/pricing";

describe("[R7-03-C1] computeEnrollmentPrice — happy path", () => {
  const listPrice = 10_000_000;

  it("PERCENT 10% → discount 1,000,000, final 9,000,000", () => {
    expect(
      computeEnrollmentPrice({ listPrice, discount: { type: "PERCENT", value: 10 } }),
    ).toEqual({
      listPrice,
      discountType: "PERCENT",
      discountAmount: 1_000_000,
      finalPrice: 9_000_000,
    });
  });

  it("AMOUNT 500,000 → final 9,500,000", () => {
    expect(
      computeEnrollmentPrice({ listPrice, discount: { type: "AMOUNT", value: 500_000 } }),
    ).toEqual({
      listPrice,
      discountType: "AMOUNT",
      discountAmount: 500_000,
      finalPrice: 9_500_000,
    });
  });

  it("SCHOLARSHIP 100% → final 0", () => {
    expect(
      computeEnrollmentPrice({ listPrice, discount: { type: "SCHOLARSHIP", value: 100 } }),
    ).toEqual({
      listPrice,
      discountType: "SCHOLARSHIP",
      discountAmount: 10_000_000,
      finalPrice: 0,
    });
  });

  it("no discount → final = listPrice, discountType null", () => {
    expect(computeEnrollmentPrice({ listPrice, discount: null })).toEqual({
      listPrice,
      discountType: null,
      discountAmount: 0,
      finalPrice: listPrice,
    });
  });

  it("PROGRAM treated as AMOUNT (VND off)", () => {
    expect(
      computeEnrollmentPrice({ listPrice, discount: { type: "PROGRAM", value: 2_000_000 } }),
    ).toEqual({
      listPrice,
      discountType: "PROGRAM",
      discountAmount: 2_000_000,
      finalPrice: 8_000_000,
    });
  });
});

describe("[R7-03-C4] computeEnrollmentPrice — clamp / edge cases", () => {
  const listPrice = 10_000_000;

  it("PERCENT 100 → final 0", () => {
    const r = computeEnrollmentPrice({ listPrice, discount: { type: "PERCENT", value: 100 } });
    expect(r.discountAmount).toBe(10_000_000);
    expect(r.finalPrice).toBe(0);
  });

  it("AMOUNT = listPrice + 1 → final 0, not negative (discountAmount clamped to listPrice)", () => {
    const r = computeEnrollmentPrice({
      listPrice,
      discount: { type: "AMOUNT", value: listPrice + 1 },
    });
    expect(r.discountAmount).toBe(listPrice);
    expect(r.finalPrice).toBe(0);
    expect(r.finalPrice).toBeGreaterThanOrEqual(0);
  });

  it("PERCENT 0 → final = listPrice", () => {
    const r = computeEnrollmentPrice({ listPrice, discount: { type: "PERCENT", value: 0 } });
    expect(r.discountAmount).toBe(0);
    expect(r.finalPrice).toBe(listPrice);
  });
});
