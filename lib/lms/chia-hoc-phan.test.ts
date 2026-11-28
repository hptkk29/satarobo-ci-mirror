import { describe, it, expect } from "vitest";
import { chiaHocPhan, tomTatHocPhan } from "./chia-hoc-phan";

const tu1Den = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const dem = (r: ReturnType<typeof chiaHocPhan>) =>
  Object.values(r.reduce<Record<string, number>>((a, x) => ({ ...a, [x.moduleCode ?? "-"]: (a[x.moduleCode ?? "-"] ?? 0) + 1 }), {}));

describe("chiaHocPhan", () => {
  it("[CHP-01] 48 bài / 4 ⇒ 4 học phần × 12, đúng thứ tự, có tên học phần", () => {
    const r = chiaHocPhan(tu1Den(48), 4);
    expect(dem(r)).toEqual([12, 12, 12, 12]);
    expect(r[0]).toEqual({ order: 1, moduleCode: "HP1", moduleName: "Học phần 1" });
    expect(r[11]!.moduleCode).toBe("HP1");
    expect(r[12]!.moduleCode).toBe("HP2");
    expect(r[47]!.moduleCode).toBe("HP4");
  });

  it("[CHP-02] phần dư dồn vào học phần ĐẦU", () => {
    expect(dem(chiaHocPhan(tu1Den(50), 4))).toEqual([13, 13, 12, 12]);
  });

  it("[CHP-03] 0 học phần ⇒ bỏ chia; nhiều học phần hơn số bài ⇒ mỗi bài một học phần", () => {
    expect(chiaHocPhan(tu1Den(5), 0).every((x) => x.moduleCode === null)).toBe(true);
    expect(chiaHocPhan(tu1Den(3), 8).map((x) => x.moduleCode)).toEqual(["HP1", "HP2", "HP3"]);
  });

  it("[CHP-04] thứ tự bài không liền (bài bị xoá) vẫn chia theo THỨ TỰ, không theo số", () => {
    const r = chiaHocPhan([10, 2, 7, 5], 2);
    expect(r.map((x) => [x.order, x.moduleCode])).toEqual([
      [2, "HP1"],
      [5, "HP1"],
      [7, "HP2"],
      [10, "HP2"],
    ]);
  });
});

describe("tomTatHocPhan", () => {
  it("[CHP-05] khoảng bài của từng học phần", () => {
    const r = tomTatHocPhan(chiaHocPhan(tu1Den(48), 4));
    expect(r[1]).toEqual({ moduleCode: "HP2", tu: 13, den: 24, soBai: 12 });
    expect(tomTatHocPhan([{ order: 1, moduleCode: null }])).toEqual([]);
  });
});

import { chiaHocPhanTheoSo } from "./chia-hoc-phan";
describe("chiaHocPhanTheoSo", () => {
  it("[CHP-06] chia đúng số buổi riêng từng học phần, theo thứ tự bài", () => {
    const r = chiaHocPhanTheoSo(tu1Den(10), [3, 5, 2]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.gan.map((g) => g.moduleCode)).toEqual(["HP1", "HP1", "HP1", "HP2", "HP2", "HP2", "HP2", "HP2", "HP3", "HP3"]);
  });

  it("[CHP-07] tổng lệch số bài / học phần 0 buổi ⇒ từ chối, không chia nửa vời", () => {
    expect(chiaHocPhanTheoSo(tu1Den(10), [3, 5]).ok).toBe(false);
    expect(chiaHocPhanTheoSo(tu1Den(10), [10, 0]).ok).toBe(false);
    const r = chiaHocPhanTheoSo(tu1Den(4), []);
    expect(r.ok && r.gan.every((g) => g.moduleCode === null)).toBe(true);
  });
});
