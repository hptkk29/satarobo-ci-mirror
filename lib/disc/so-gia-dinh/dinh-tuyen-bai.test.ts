import { describe, expect, it } from "vitest";

import { boDeChoThanhVien, boDeQuanSatTheoLop } from "@/lib/disc/engine-goc/modules/test/dinh-tuyen";

import { TUOI_TU_DANH_GIA_TOI_THIEU, boDeChoBai, cachLamKhaDung, laCheDoTreEm, tuoiTuNamSinh } from "./dinh-tuyen-bai";
import { VAI_GIA_DINH, coHoiLop } from "./vai";

const con = (lop: string | null, tuoi: number | null) => ({ vaiTro: "con" as const, lop, tuoi });
const lon = (vai: "bo" | "me" | "ong" | "ba" | "nguoi-than" | "khac") => ({ vaiTro: vai, lop: null, tuoi: null });

describe("định tuyến bộ đề (doc 18, 2.4) — từng ô của bảng", () => {
  it("[SG-DT-01] người lớn tự làm: bộ PH; theo góc nhìn: CHẶN", () => {
    for (const v of ["bo", "me", "ong", "ba", "nguoi-than", "khac"] as const) {
      expect(boDeChoBai(lon(v), "TU_LAM")).toEqual({ duoc: true, boDe: "PH" });
      expect(boDeChoBai(lon(v), "GOC_NHIN")).toEqual({ duoc: false, lyDo: "NGUOI_LON_CHUA_HO_TRO_GOC_NHIN" });
    }
  });

  it("[SG-DT-02] con mầm non / lớp 1–2: KHÔNG cho tự làm (ADR-002); góc nhìn: MN", () => {
    for (const lop of ["mam-non", "1", "2"]) {
      expect(boDeChoBai(con(lop, 6), "TU_LAM")).toEqual({ duoc: false, lyDo: "TRE_NHO_KHONG_TU_LAM" });
      expect(boDeChoBai(con(lop, 6), "GOC_NHIN")).toEqual({ duoc: true, boDe: "MN" });
    }
  });

  it("[SG-DT-03] con lớp 3–5, ≥ 8 tuổi: tự làm TH, góc nhìn QS", () => {
    for (const lop of ["3", "4", "5"]) {
      expect(boDeChoBai(con(lop, 10), "TU_LAM")).toEqual({ duoc: true, boDe: "TH" });
      expect(boDeChoBai(con(lop, 10), "GOC_NHIN")).toEqual({ duoc: true, boDe: "QS" });
    }
  });

  it("[SG-DT-04] con dưới 8 tuổi (dù đang học lớp cao hơn): không tự làm, góc nhìn dùng MN", () => {
    expect(boDeChoBai(con("3", 7), "TU_LAM")).toEqual({ duoc: false, lyDo: "TRE_NHO_KHONG_TU_LAM" });
    expect(boDeChoBai(con("3", 7), "GOC_NHIN")).toEqual({ duoc: true, boDe: "MN" });
  });

  it("[SG-DT-05] con lớp 6–9: THCS / QS", () => {
    for (const lop of ["6", "7", "8", "9"]) {
      expect(boDeChoBai(con(lop, 13), "TU_LAM")).toEqual({ duoc: true, boDe: "THCS" });
      expect(boDeChoBai(con(lop, 13), "GOC_NHIN")).toEqual({ duoc: true, boDe: "QS" });
    }
  });

  it("[SG-DT-06] con lớp 10–12 / trên 12: tự làm PH; góc nhìn QS chỉ khi ≤ 15 tuổi, trên 15 CHẶN", () => {
    for (const lop of ["10", "11", "12", "tren-12"]) {
      expect(boDeChoBai(con(lop, 17), "TU_LAM")).toEqual({ duoc: true, boDe: "PH" });
      expect(boDeChoBai(con(lop, 17), "GOC_NHIN")).toEqual({ duoc: false, lyDo: "QUA_15_TUOI_CHUA_CO_BO_QUAN_SAT" });
    }
    expect(boDeChoBai(con("10", 15), "GOC_NHIN")).toEqual({ duoc: true, boDe: "QS" });
    expect(boDeChoBai(con("10", 16), "GOC_NHIN")).toEqual({ duoc: false, lyDo: "QUA_15_TUOI_CHUA_CO_BO_QUAN_SAT" });
  });

  it("[SG-DT-07] thiếu năm sinh + lớp 10 trở lên ⇒ chặn góc nhìn (không đoán); lớp 9 thì cho", () => {
    expect(boDeChoBai(con("10", null), "GOC_NHIN")).toEqual({ duoc: false, lyDo: "QUA_15_TUOI_CHUA_CO_BO_QUAN_SAT" });
    expect(boDeChoBai(con("9", null), "GOC_NHIN")).toEqual({ duoc: true, boDe: "QS" });
  });

  it("[SG-DT-08] chưa có lớp ⇒ hỏi, không đoán (cả hai cách làm)", () => {
    expect(boDeChoBai(con(null, 10), "TU_LAM")).toEqual({ duoc: false, lyDo: "CHUA_CO_LOP" });
    expect(boDeChoBai(con(null, 10), "GOC_NHIN")).toEqual({ duoc: false, lyDo: "CHUA_CO_LOP" });
    expect(boDeChoBai(con("lop-la", 10), "TU_LAM")).toEqual({ duoc: false, lyDo: "CHUA_CO_LOP" });
  });

  it("[SG-DT-09] anh/chị/em còn đi học được xử như con (có hỏi lớp)", () => {
    expect(boDeChoBai({ vaiTro: "anh-chi-em", lop: "7", tuoi: 12 }, "TU_LAM")).toEqual({ duoc: true, boDe: "THCS" });
  });

  it("[SG-DT-10] cachLamKhaDung trả đủ hai lựa chọn; góc nhìn luôn được hỏi kể cả khi đã tự làm", () => {
    const k = cachLamKhaDung(con("4", 9));
    expect(k.tuLam.duoc && k.gocNhin.duoc).toBe(true);
  });

  it("[SG-DT-11] tuổi từ năm sinh; phi lý ⇒ null; chế độ trẻ em chỉ với bé tự làm TH/THCS", () => {
    expect(tuoiTuNamSinh(2016, 2026)).toBe(10);
    expect(tuoiTuNamSinh(2030, 2026)).toBeNull();
    expect(tuoiTuNamSinh(1800, 2026)).toBeNull();
    expect(tuoiTuNamSinh(null, 2026)).toBeNull();
    expect(laCheDoTreEm("TH", "TU_LAM")).toBe(true);
    expect(laCheDoTreEm("THCS", "TU_LAM")).toBe(true);
    expect(laCheDoTreEm("PH", "TU_LAM")).toBe(false);
    expect(laCheDoTreEm("TH", "GOC_NHIN")).toBe(false);
  });

  it("[SG-DT-12] khớp engine gốc TỪNG Ô (vai × lớp): bộ tự làm dựa trên boDeChoThanhVien, bộ quan sát dựa trên boDeQuanSatTheoLop", () => {
    const lops = [null, "mam-non", ...Array.from({ length: 12 }, (_, i) => String(i + 1)), "tren-12", "lop-la"];
    for (const vai of VAI_GIA_DINH) {
      for (const lop of lops) {
        const goc = boDeChoThanhVien(vai, lop ?? undefined);
        const tuLam = boDeChoBai({ vaiTro: vai, lop, tuoi: null }, "TU_LAM");
        if (goc === null) expect(tuLam, `${vai}/${lop}`).toEqual({ duoc: false, lyDo: "CHUA_CO_LOP" });
        else if (goc.nguoiLonTraLoiHo) expect(tuLam, `${vai}/${lop}`).toEqual({ duoc: false, lyDo: "TRE_NHO_KHONG_TU_LAM" });
        else expect(tuLam, `${vai}/${lop}`).toEqual({ duoc: true, boDe: goc.boDe });

        if (coHoiLop(vai)) {
          const qs = boDeQuanSatTheoLop(lop ?? undefined);
          const gn = boDeChoBai({ vaiTro: vai, lop, tuoi: null }, "GOC_NHIN");
          if (qs === null) {
            // engine không có bộ quan sát cho «trên lớp 12» / lớp lạ: ta chặn (trên lớp 12) hoặc hỏi lớp (lớp lạ).
            expect(gn.duoc, `${vai}/${lop}`).toBe(false);
          } else if (qs === "MN") expect(gn, `${vai}/${lop}`).toEqual({ duoc: true, boDe: "MN" });
          else expect(gn.duoc && gn.boDe === "QS" ? true : !gn.duoc && gn.lyDo === "QUA_15_TUOI_CHUA_CO_BO_QUAN_SAT", `${vai}/${lop}`).toBe(true);
        }
      }
    }
    expect(TUOI_TU_DANH_GIA_TOI_THIEU).toBe(8);
  });
});
