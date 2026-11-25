import { describe, it, expect } from "vitest";
import { classifyNps, computeNps } from "./nps";

describe("NPS", () => {
  it("classifyNps", () => {
    expect(classifyNps(10)).toBe("promoter");
    expect(classifyNps(9)).toBe("promoter");
    expect(classifyNps(8)).toBe("passive");
    expect(classifyNps(7)).toBe("passive");
    expect(classifyNps(6)).toBe("detractor");
    expect(classifyNps(0)).toBe("detractor");
  });

  it("computeNps cơ bản", () => {
    // 3 promoter, 1 passive, 1 detractor → (3-1)/5 = 40
    const r = computeNps([10, 9, 9, 8, 3]);
    expect(r.total).toBe(5);
    expect(r.promoters).toBe(3);
    expect(r.passives).toBe(1);
    expect(r.detractors).toBe(1);
    expect(r.nps).toBe(40);
  });

  it("bỏ qua điểm null/ngoài 0-10", () => {
    const r = computeNps([10, null, 11, -1, 0]);
    expect(r.total).toBe(2);
    expect(r.nps).toBe(0); // 1 promoter, 1 detractor → 0
  });

  it("rỗng → nps 0", () => {
    expect(computeNps([]).nps).toBe(0);
  });
});
