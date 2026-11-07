// PORT từ repo hodacphuchtc/DISC · tests/bac-hoc.test.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c (chỉ đổi đường dẫn import).
/**
 * `29.0` — bậc của một đứa trẻ. Core không import được module test, nên ranh giới được lặp
 * lại ở `bac-hoc.ts`; test này canh để nó KHÔNG BAO GIỜ lệch với `dinh-tuyen`.
 */

import { describe, expect, it } from "vitest";

import { LOP_CUOI_TIEU_HOC, LOP_MAM_NON, LOP_TREN_12 } from "@/lib/disc/engine-goc/config/disc-nguong";
import { bacCuaTre } from "@/lib/disc/engine-goc/modules/core/gia-dinh/bac-hoc";
import {
  LOP_CAO_NHAT_DUNG_BAN_QUAN_SAT,
  boDeQuanSatTheoLop,
} from "@/lib/disc/engine-goc/modules/test/dinh-tuyen";

const MOI_LOP = [LOP_MAM_NON, "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", LOP_TREN_12];

describe("bacCuaTre", () => {
  it("mầm non và lớp 1–2 ⇒ nho", () => {
    for (const l of [LOP_MAM_NON, "1", "2"]) expect(bacCuaTre(l), l).toBe("nho");
  });
  it("lớp 3–5 ⇒ tieu-hoc", () => {
    for (const l of ["3", "4", "5"]) expect(bacCuaTre(l), l).toBe("tieu-hoc");
  });
  it("lớp 6 trở lên và 'đã qua lớp 12' ⇒ lon", () => {
    for (const l of ["6", "7", "9", "10", "12", LOP_TREN_12]) expect(bacCuaTre(l), l).toBe("lon");
  });
  it("🔴 chưa có lớp hoặc lớp hỏng ⇒ undefined, KHÔNG đoán", () => {
    for (const l of [undefined, "", "abc", "0", "13", "4.5"]) expect(bacCuaTre(l), String(l)).toBeUndefined();
  });
  it("🔴 ranh 'nho' khớp CHÍNH XÁC bộ quan sát MN của dinh-tuyen, cho mọi lớp", () => {
    for (const l of MOI_LOP) {
      expect(bacCuaTre(l) === "nho", l).toBe(boDeQuanSatTheoLop(l) === "MN");
    }
  });
  it("hằng số lặp lại khớp nguồn", () => {
    expect(LOP_CAO_NHAT_DUNG_BAN_QUAN_SAT).toBe(2);
    expect(LOP_CUOI_TIEU_HOC).toBe(5);
    expect(bacCuaTre("5")).toBe("tieu-hoc");
    expect(bacCuaTre("6")).toBe("lon");
  });
});
