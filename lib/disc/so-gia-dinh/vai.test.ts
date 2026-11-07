import { describe, expect, it } from "vitest";

import * as engine from "@/lib/disc/engine-goc/config/disc-gia-dinh";
import * as nguong from "@/lib/disc/engine-goc/config/disc-nguong";
import { MA_BO_DE, MA_TRUC } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

import { CHU_VAI, LOP_MAM_NON, LOP_TREN_12, VAI_GIA_DINH, coHoiLop, laTreEm, soLopCua } from "./vai";
import { BON_TRUC } from "./kieu";

describe("bản sao không phụ thuộc engine phải KHỚP engine", () => {
  it("[SG-VAI-01] danh sách vai, chữ hiển thị, coHoiLop, laTreEm giống hệt engine (thứ tự vai là cố định vĩnh viễn)", () => {
    expect([...VAI_GIA_DINH]).toEqual([...engine.VAI_GIA_DINH]);
    expect(CHU_VAI).toEqual(engine.CHU_VAI);
    for (const v of VAI_GIA_DINH) {
      expect(coHoiLop(v), v).toBe(engine.coHoiLop(v));
      for (const lop of [undefined, "5", "mam-non"]) expect(laTreEm(v, lop), `${v}/${lop}`).toBe(engine.laTreEm(v, lop));
    }
  });

  it("[SG-VAI-02] hằng lớp + soLopCua + bốn trục + mã bộ đề khớp engine", () => {
    expect(LOP_MAM_NON).toBe(nguong.LOP_MAM_NON);
    expect(LOP_TREN_12).toBe(nguong.LOP_TREN_12);
    for (const l of [undefined, null, "", "0", "1", "12", "13", "mam-non", "tren-12", "5.5", "abc", " 3"]) {
      expect(soLopCua(l), String(l)).toBe(nguong.soLopCua(l ?? undefined));
    }
    expect([...BON_TRUC]).toEqual([...MA_TRUC]);
    expect(MA_BO_DE).toEqual(["MN", "TH", "THCS", "PH", "QS"]);
  });
});
