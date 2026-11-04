// [PNG-*] Câu chữ + phép đếm của panel màn Phân công gộp (chủ dự án 26/10/2026). Thuần, mốc tuyệt đối (luật 19).
import { describe, expect, it } from "vitest";
import type { BuoiGop } from "./luoi-gop";
import { giaiThichMaO, lopCungGio, tenCa, tomTatCa, vaiCua } from "./panel-gop";

const buoi = (k: string, p: Partial<BuoiGop> = {}): BuoiGop => ({
  key: k,
  sourceType: "CLASS_SESSION",
  sourceId: k,
  ngay: "2026-10-29",
  gioBatDau: "08:00",
  gioKetThuc: "09:30",
  ten: k,
  phu: null,
  phong: "P1",
  mo: true,
  main: null,
  ta: [],
  loai: "LOP",
  ca: "S",
  khongAiTruc: false,
  ...p,
});
const o = (p: Partial<Parameters<typeof giaiThichMaO>[0]>) => ({ tietD: 0, tietTG: 0, trucId: null, trucQuyDoi: 0, coTrial: false, ...p });

describe("giaiThichMaO", () => {
  it("[PNG-01] TD nửa ca ⇒ 'Đứng chính + nửa ca trực'; ô trống ⇒ 'Chưa giao gì trong buổi này'", () => {
    expect(giaiThichMaO(o({ tietD: 1, trucId: "t", trucQuyDoi: 0.5 }))).toBe("Đứng chính + nửa ca trực");
    expect(giaiThichMaO(o({}))).toBe("Chưa giao gì trong buổi này");
  });
  it("[PNG-02] đọc SỐ quy đổi của ô, không tra theo mã: cùng 1 tiết + trực mà quy đổi 1 ⇒ 'cả ca trực'", () => {
    expect(giaiThichMaO(o({ tietD: 1, trucId: "t", trucQuyDoi: 1 }))).toBe("Đứng chính + cả ca trực");
    expect(giaiThichMaO(o({ trucId: "t", trucQuyDoi: 1 }))).toBe("Trực cả ca");
    expect(giaiThichMaO(o({ tietD: 2, trucId: "t", trucQuyDoi: 0 }))).toMatch(/^Đứng chính 2 lớp \+ trực \(không quy đổi/);
  });
  it("[PNG-03] trợ giảng + Trial ghi đủ", () => {
    expect(giaiThichMaO(o({ tietD: 1, tietTG: 1 }))).toBe("Đứng chính + Trợ giảng");
    expect(giaiThichMaO(o({ coTrial: true }))).toBe("Có Trial");
  });
});

describe("tomTatCa", () => {
  it("[PNG-04] đếm lớp của ĐÚNG ngày × buổi; thiếu = lớp còn mở chưa có đứng chính; bù/Trial không là 'lớp'", () => {
    const ds = [
      buoi("a", { main: { id: "1", userId: "u1" } }),
      buoi("b"),
      buoi("c", { mo: false }),
      buoi("d", { ca: "C" }),
      buoi("e", { ngay: "2026-10-30" }),
      buoi("f", { loai: "BU", sourceType: "MAKEUP_CASE" }),
    ];
    expect(tomTatCa({ buoi: ds, ngay: "2026-10-29", ca: "S", truc: ["u1", "u2", "u1"] })).toEqual({ soLop: 3, thieu: 1, soTruc: 2 });
  });
});

describe("lopCungGio", () => {
  const ds = [
    buoi("dang", { main: { id: "1", userId: "u1" } }),
    buoi("tg", { gioBatDau: "09:00", gioKetThuc: "10:00", ta: [{ id: "2", userId: "u2" }] }),
    buoi("sau", { gioBatDau: "09:30", gioKetThuc: "11:00", main: { id: "3", userId: "u1" } }),
    buoi("bu", { loai: "BU", sourceType: "MAKEUP_CASE", main: { id: "4", userId: "u3" } }),
  ];
  const moi = buoi("moi", { gioBatDau: "08:30", gioKetThuc: "09:15" });
  it("[PNG-05] bận vì đứng chính / trợ giảng lớp khác chồng giờ ⇒ trả lớp đó", () => {
    expect(lopCungGio("u1", moi, ds)?.key).toBe("dang");
    expect(lopCungGio("u2", moi, ds)?.key).toBe("tg");
  });
  it("[PNG-06] đối chứng: chạm mép (09:30) không bận; học bù không làm bận (có thể ghép); chính buổi đó không tính", () => {
    expect(lopCungGio("u1", buoi("x", { gioBatDau: "11:00", gioKetThuc: "12:00" }), ds)).toBeNull();
    expect(lopCungGio("u3", moi, ds)).toBeNull();
    expect(lopCungGio("u1", ds[0]!, [ds[0]!])).toBeNull();
  });
  it("[PNG-07] vaiCua + tên buổi đầy đủ", () => {
    expect(vaiCua("u1", ds[0]!)).toBe("MAIN");
    expect(vaiCua("u2", ds[1]!)).toBe("TA");
    expect(vaiCua("u9", ds[1]!)).toBeNull();
    expect([tenCa("S"), tenCa("C"), tenCa("T"), tenCa("K")]).toEqual(["Sáng", "Chiều", "Tối", "K"]);
  });
});
