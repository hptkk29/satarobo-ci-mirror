// [CNT-*] Tự xếp học bù / Trial cho người trực (GĐ5, chốt 2 · 3 · 11). Thuần, mỗi ca xanh khi chạy một mình.
import { describe, expect, it } from "vitest";
import { chonNguoiTruc, type UngVienTruc } from "./chon-nguoi-truc";
import type { KhungCa } from "./ma-o";

const CA: KhungCa[] = [
  { ma: "S", tu: "07:45", den: "11:30" },
  { ma: "C", tu: "13:45", den: "17:30" },
  { ma: "T", tu: "17:15", den: "21:00" },
];
const uv = (userId: string, x: Partial<UngVienTruc> = {}): UngVienTruc => ({ userId, maNv: null, caTruc: ["C"], viec: [], soBuTrialThang: 0, coChungNhanTrial: true, ...x });
const BU = { ca: CA, loai: "BU" as const, gioBatDau: "14:00", gioKetThuc: "15:30" };

describe("chonNguoiTruc", () => {
  it("[CNT-01] một người trực ca của buổi ⇒ người đó (tầng 0)", () => {
    expect(chonNguoiTruc({ ...BU, ungVien: [uv("a"), uv("b", { caTruc: ["S"] })] })).toEqual({ userId: "a", ca: "C", tang: 0 });
  });
  it("[CNT-02] tầng 1 — người KHÔNG bận giờ thắng, kể cả khi có mã NV lớn hơn", () => {
    const r = chonNguoiTruc({ ...BU, ungVien: [uv("a", { maNv: "SR.NV.001", viec: [{ gioBatDau: "15:00", gioKetThuc: "16:00", ca: "C" }] }), uv("b", { maNv: "SR.NV.009" })] });
    expect(r).toEqual({ userId: "b", ca: "C", tang: 1 });
  });
  it("[CNT-03] tầng 2 — cùng rảnh giờ ⇒ ít tiết trong ca hơn", () => {
    const r = chonNguoiTruc({ ...BU, ungVien: [uv("a", { viec: [{ gioBatDau: "16:00", gioKetThuc: "17:00", ca: "C" }] }), uv("b", { soBuTrialThang: 9 })] });
    expect(r).toEqual({ userId: "b", ca: "C", tang: 2 });
  });
  it("[CNT-04] tầng 3 — hoà tiết ⇒ ít học bù / Trial trong tháng hơn (chia đều)", () => {
    expect(chonNguoiTruc({ ...BU, ungVien: [uv("a", { maNv: "SR.NV.001", soBuTrialThang: 3 }), uv("b", { maNv: "SR.NV.002", soBuTrialThang: 1 })] })).toEqual({ userId: "b", ca: "C", tang: 3 });
  });
  it("[CNT-05] tầng 4 — hoà hết ⇒ mã NV tăng dần; chưa có mã xếp cuối; không phụ thuộc thứ tự mảng", () => {
    const ds = [uv("z", { maNv: null }), uv("y", { maNv: "SR.NV.010" }), uv("x", { maNv: "SR.NV.002" })];
    expect(chonNguoiTruc({ ...BU, ungVien: ds })).toEqual({ userId: "x", ca: "C", tang: 4 });
    expect(chonNguoiTruc({ ...BU, ungVien: [...ds].reverse() })).toEqual({ userId: "x", ca: "C", tang: 4 });
  });
  it("[CNT-06] không ai trực ca của buổi ⇒ null + KHONG_AI_TRUC (đường lùi); ngoài mọi khung ⇒ NGOAI_KHUNG", () => {
    expect(chonNguoiTruc({ ...BU, ungVien: [uv("a", { caTruc: ["T"] })] })).toEqual({ userId: null, ca: "C", lyDo: "KHONG_AI_TRUC" });
    expect(chonNguoiTruc({ ...BU, gioBatDau: "12:00", gioKetThuc: "13:30", ungVien: [uv("a")] })).toEqual({ userId: null, ca: null, lyDo: "NGOAI_KHUNG" });
  });
  it("[CNT-07] Trial chỉ giao người CÓ chứng nhận; không ai có ⇒ KHONG_AI_CO_CHUNG_NHAN; học bù không đòi chứng nhận (đối chứng)", () => {
    const ds = [uv("a", { coChungNhanTrial: false, maNv: "SR.NV.001" }), uv("b", { coChungNhanTrial: true, maNv: "SR.NV.002" })];
    expect(chonNguoiTruc({ ...BU, loai: "TRIAL", ungVien: ds })).toMatchObject({ userId: "b" });
    expect(chonNguoiTruc({ ...BU, loai: "TRIAL", ungVien: [uv("a", { coChungNhanTrial: false })] })).toEqual({ userId: null, ca: "C", lyDo: "KHONG_AI_CO_CHUNG_NHAN" });
    expect(chonNguoiTruc({ ...BU, ungVien: ds })).toMatchObject({ userId: "a" });
  });
  it("[CNT-08] buổi vắt hai ca, hoà phút ⇒ ca có người trực (chốt 11)", () => {
    // 17:15–17:30 nằm trong cả C lẫn T; chỉ T có người trực ⇒ ca T.
    expect(chonNguoiTruc({ ...BU, gioBatDau: "17:15", gioKetThuc: "17:30", ungVien: [uv("t", { caTruc: ["T"] })] })).toEqual({ userId: "t", ca: "T", tang: 0 });
    // Chỉ C có người trực ⇒ ca C (không có tầng "ca sau" chen vào khi đã có ca có trực).
    expect(chonNguoiTruc({ ...BU, gioBatDau: "17:15", gioKetThuc: "17:30", ungVien: [uv("c", { caTruc: ["C"] })] })).toEqual({ userId: "c", ca: "C", tang: 0 });
  });
});
