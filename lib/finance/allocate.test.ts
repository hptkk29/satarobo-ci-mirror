import { describe, it, expect } from "vitest";
import { allocateByWeight } from "./allocate";

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe("allocateByWeight (FIN-01 Q1=A chia tiền theo finalPrice)", () => {
  it("chia đúng tỉ lệ, tổng bằng total", () => {
    expect(allocateByWeight(100, [1, 1])).toEqual([50, 50]);
    expect(allocateByWeight(100, [2, 1])).toEqual([67, 33]); // dư 1 dồn cho phần lẻ lớn nhất (i0)
    expect(allocateByWeight(8_640_000, [6_000_000, 2_640_000])).toEqual([6_000_000, 2_640_000]);
  });

  it("BẤT BIẾN: tổng các phần luôn === total (không mất đồng nào)", () => {
    const cases: Array<[number, number[]]> = [
      [10, [1, 1, 1]],
      [8_640_001, [3, 5, 7]],
      [999_999, [1000000, 1, 1]],
      [12_345_678, [6_000_000, 4_000_000, 2_345_678]],
      [7, [1, 1, 1, 1, 1]],
    ];
    for (const [total, w] of cases) {
      const parts = allocateByWeight(total, w);
      expect(sum(parts)).toBe(Math.round(total));
      expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
      expect(parts.length).toBe(w.length);
    }
  });

  it("dồn dư cho phần lẻ lớn nhất, tie-break index nhỏ trước", () => {
    expect(allocateByWeight(10, [1, 1, 1])).toEqual([4, 3, 3]); // dư 1 → i0
    expect(allocateByWeight(11, [1, 1, 1])).toEqual([4, 4, 3]); // dư 2 → i0,i1
  });

  it("Σweights = 0 → chia đều", () => {
    expect(allocateByWeight(100, [0, 0])).toEqual([50, 50]);
    expect(allocateByWeight(9, [0, 0, 0])).toEqual([3, 3, 3]);
    expect(sum(allocateByWeight(100, [0, 0, 0]))).toBe(100);
  });

  it("biên: 1 phần / total 0 / weight âm bị coi = 0", () => {
    expect(allocateByWeight(100, [5])).toEqual([100]);
    expect(allocateByWeight(0, [1, 1])).toEqual([0, 0]);
    expect(allocateByWeight(100, [-3, 1])).toEqual([0, 100]); // weight âm → 0 → dồn hết cho phần dương
    expect(allocateByWeight(50, [])).toEqual([]);
  });

  it("property: random vẫn giữ tổng + không âm", () => {
    // seed cố định (không dùng Math.random — deterministic)
    const seeds = [3, 17, 42, 101, 777, 9001];
    for (const s of seeds) {
      const total = (s * 12_345) % 5_000_000;
      const w = [((s * 7) % 97) + 1, ((s * 13) % 89) + 1, ((s * 29) % 61) + 1];
      const parts = allocateByWeight(total, w);
      expect(sum(parts)).toBe(total);
      expect(parts.every((p) => p >= 0)).toBe(true);
    }
  });
});
