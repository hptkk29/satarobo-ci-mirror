import { describe, expect, it } from "vitest";
import { docRange as docNoiBo, rangeChoR2 as r2NoiBo } from "../elearning/range";
import { docRange, rangeChoR2 } from "./range-http";

/** [RGH] Bản sao Range của Online giống HỆT bản Nội bộ trên một bộ header biên (chống hai bản lệch nhau). */
describe("[RGH] range-http ≡ lib/elearning/range", () => {
  const header = [null, undefined, "", "bytes=0-", "bytes=0-0", "bytes=5-9", "bytes=-3", "bytes=9-5", "bytes=0-99", "bytes=100-", "bytes=abc", "bytes=1-2,4-5", "items=0-1", "bytes=-0", "bytes=0-9"];
  it("cùng kết quả cho mọi header × kích thước", () => {
    for (const h of header) for (const size of [0, 1, 10, 100]) expect(docRange(h, size), `${h}/${size}`).toEqual(docNoiBo(h, size));
  });
  it("rangeChoR2 giống nhau", () => {
    for (const [a, b] of [[0, 0], [0, 9], [5, 5], [10, 99]] as const) expect(rangeChoR2(a, b)).toBe(r2NoiBo(a, b));
  });
});
