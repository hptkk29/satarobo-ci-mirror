import { describe, expect, it } from "vitest";
import { boDeChoKhach, type BoDeDisc, type DiscEngine } from "./engine";

// ⚠️ Dữ liệu GIẢ: không phải bộ đề DISC thật.
const boGia = {
  ma: "HS-GIA",
  phienBan: "gia-1",
  doiTuong: "TH",
  nguoiLonTraLoiHo: false,
  cauHoi: [
    { id: "c1", noiDung: "Câu giả 1", trongSo: { D: 9, I: 0, S: 0, C: 0 } },
    { id: "c2", noiDung: "Câu giả 2", dapAnDung: "BI-MAT" },
  ],
  khoaCham: "KHOA-CHAM-BI-MAT",
} as unknown as BoDeDisc;

const engine = (bo: BoDeDisc | null): DiscEngine => ({
  phienBan: "e-gia",
  chonBoDe: () => bo,
  layBoDe: () => bo,
  cham: () => ({ ok: false, lyDo: "BO_DE_KHONG_TON_TAI" }),
});

describe("[DISC-ENG-01] boDeChoKhach", () => {
  it("chỉ pick ma/phienBan/doiTuong/nguoiLonTraLoiHo/cauHoi[{id,noiDung}] — trọng số & khoá chấm của object runtime KHÔNG rò", () => {
    const r = boDeChoKhach(engine(boGia), { vai: "HS", bacHoc: "4", namSinh: 2016, namNay: 2026 });
    expect(r).toEqual({
      ma: "HS-GIA",
      phienBan: "gia-1",
      doiTuong: "TH",
      nguoiLonTraLoiHo: false,
      cauHoi: [
        { id: "c1", noiDung: "Câu giả 1" },
        { id: "c2", noiDung: "Câu giả 2" },
      ],
    });
    const json = JSON.stringify(r);
    for (const dau of ["trongSo", "dapAnDung", "BI-MAT", "khoaCham"]) expect(json).not.toContain(dau);
  });
  it("engine không có bộ đề phù hợp ⇒ null", () => {
    expect(boDeChoKhach(engine(null), { vai: "PH", namSinh: 1988, namNay: 2026 })).toBeNull();
  });
  it("chuyển nguyên tham số cho engine.chonBoDe (cùng hàm đường lưu dùng để đối chiếu)", () => {
    let nhan: unknown;
    const e: DiscEngine = { ...engine(boGia), chonBoDe: (d) => ((nhan = d), boGia) };
    boDeChoKhach(e, { vai: "HS", bacHoc: "MN", namSinh: 2021, namNay: 2027 });
    expect(nhan).toEqual({ vai: "HS", bacHoc: "MN", namSinh: 2021, namNay: 2027 });
  });
});
