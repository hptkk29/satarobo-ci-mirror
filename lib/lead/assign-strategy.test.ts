import { describe, it, expect } from "vitest";
import {
  computeCloseRate,
  pickByCloseRate,
  pickRoundRobin,
  pickCenterEvenly,
} from "./assign-strategy";

describe("assign-strategy", () => {
  it("computeCloseRate", () => {
    expect(computeCloseRate(3, 10)).toBeCloseTo(0.3);
    expect(computeCloseRate(0, 0)).toBe(0);
  });

  it("pickRoundRobin chọn ít lead mở nhất", () => {
    expect(
      pickRoundRobin([
        { id: "a", openCount: 5 },
        { id: "b", openCount: 2 },
        { id: "c", openCount: 3 },
      ]),
    ).toBe("b");
  });

  it("pickByCloseRate: cùng tải, tỷ lệ chốt cao được chọn", () => {
    const r = pickByCloseRate([
      { id: "low", openCount: 2, closed: 1, handled: 10 }, // rate 0.1 → weight 0.6 → score 3.33
      { id: "high", openCount: 2, closed: 8, handled: 10 }, // rate 0.8 → weight 1.3 → score 1.54
    ]);
    expect(r).toBe("high");
  });

  it("pickByCloseRate: chốt cao nhưng đã quá tải → nhường", () => {
    const r = pickByCloseRate([
      { id: "high", openCount: 20, closed: 8, handled: 10 }, // score 20/1.3 = 15.4
      { id: "low", openCount: 2, closed: 0, handled: 10 }, // score 2/0.5 = 4
    ]);
    expect(r).toBe("low");
  });

  it("pickByCloseRate rỗng → null", () => {
    expect(pickByCloseRate([])).toBeNull();
  });

  it("pickCenterEvenly chọn cơ sở ít lead hơn", () => {
    expect(
      pickCenterEvenly([
        { centerId: "cs1", openCount: 10 },
        { centerId: "cs2", openCount: 4 },
      ]),
    ).toBe("cs2");
  });

  it("pickCenterEvenly tie → centerId nhỏ hơn", () => {
    expect(
      pickCenterEvenly([
        { centerId: "cs2", openCount: 5 },
        { centerId: "cs1", openCount: 5 },
      ]),
    ).toBe("cs1");
  });
});
