import { describe, expect, it } from "vitest";

import { quyDoiSaoTuDiem } from "./gop-y-diem";

describe("OD-16 — quy đổi điểm góp ý 0–10 → rating 1–5", () => {
  it("[GY-01] bảng quy đổi đúng từng điểm (cả hai đầu)", () => {
    const bang = [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
    bang.forEach((sao, diem) => expect(quyDoiSaoTuDiem(diem), `điểm ${diem}`).toBe(sao));
  });
  it("[GY-02] từ chối điểm ngoài 0–10 hoặc không nguyên (không kẹp im lặng)", () => {
    for (const x of [-1, 11, 4.5, Number.NaN]) expect(() => quyDoiSaoTuDiem(x), String(x)).toThrow(RangeError);
  });
});
