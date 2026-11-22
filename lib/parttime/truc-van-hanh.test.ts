// [P5-O*] — đơn vị trả của ca trực vận hành (thuần, đồng hồ đóng băng). DB: tests/cham-cong/parttime-truc-van-hanh.spec.ts.
import { describe, expect, it } from "vitest";
import type { KhoangCoMat } from "./bang-chung-cong";
import { docThamSo, type ThamSoChinhSach } from "./chinh-sach";
import { danhGiaTruc, dauVanTruc, type DauVaoTruc, type TietTrongNgay } from "./truc-van-hanh";

const SRQD = docThamSo({
  loai: "SR_QD_238",
  tiet: { chuanBiPhut: 10, dayPhut: 90, chuanPhut: 100 },
  ca: [
    { ma: "S", tu: "07:45", den: "11:30" },
    { ma: "C", tu: "13:45", den: "17:30" },
    { ma: "T", tu: "17:15", den: "21:00" },
  ],
  toiDaTietMoiCa: 2,
  donGia: { mainTheoRank: { "1": 120000, "2": 140000, "3": 160000, "4": 200000 }, troGiang: 80000, trucCa: 90000, nuaCaTruc: 45000 },
  rankMacDinh: 1,
  nguongTroGiang: [],
});
const NGAY = "2026-11-02";
const vn = (h: string) => new Date(`${NGAY}T${h}:00+07:00`);
const coMat = (tu: string, den: string | null, centerId = "cs1"): KhoangCoMat => ({ inId: `in${tu}`, outId: den ? `out${den}` : null, tu: vn(tu), den: den ? vn(den) : null, centerId, canhBao: [] });
const tiet = (id: string, a: string, b: string, quyet: TietTrongNgay["quyet"] = "XAC_NHAN"): TietTrongNgay => ({ assignmentId: id, gioBatDau: a, gioKetThuc: b, quyet });
const dg = (p: Partial<DauVaoTruc> = {}) =>
  danhGiaTruc({ thamSo: SRQD, ngay: NGAY, shiftCode: "T", centerId: "cs1", conSong: true, daNhan: true, tiet: [], khoang: [coMat("17:10", "21:05")], now: vn("22:00"), ...p });

describe("[P5-O] đơn vị trả ca trực (D-Q3 / D-N1)", () => {
  it("[P5-O02] trực + 0 tiết ⇒ 1,0 ca · 90.000đ/ca", () => {
    expect(dg()).toMatchObject({ lop: "TU_DONG", donViTra: "1", soTietTrongCa: 0, donGiaCa: 90000, khung: { tu: "17:15", den: "21:00" } });
  });

  it("[P5-O03][P5-O04] trực + 1 tiết (MAIN hoặc TA) đã xác nhận ⇒ 0,5 ca — KHÔNG chia thời gian ca", () => {
    expect(dg({ tiet: [tiet("main", "18:00", "19:30")] })).toMatchObject({ lop: "TU_DONG", donViTra: "0.5", soTietTrongCa: 1 });
    expect(dg({ tiet: [tiet("ta", "19:15", "20:45")] })).toMatchObject({ donViTra: "0.5" });
  });

  it("[P5-O05][P5-O06] trực + 2 tiết (MAIN+MAIN / MAIN+TA) ⇒ 0", () => {
    expect(dg({ tiet: [tiet("a", "17:15", "18:45"), tiet("b", "19:00", "20:30")] })).toMatchObject({ lop: "TU_DONG", donViTra: "0", soTietTrongCa: 2 });
  });

  it("[P5-O07] có mặt cả ca mà KHÔNG nhận trực ⇒ không xác nhận được (CHAN CHUA_NHAN) — có mặt không sinh trực", () => {
    expect(dg({ daNhan: false })).toMatchObject({ lop: "CHAN", lyDo: ["CHUA_NHAN"], donViTra: null });
  });

  it("[P5-O09] tiết VƯỢT ranh ca (09:45–11:45 với ca S kết thúc 11:30) ⇒ CHAN Q2_VUOT_CA, không đoán đơn vị", () => {
    const r = dg({ shiftCode: "S", khoang: [coMat("07:40", "12:00")], tiet: [tiet("x", "09:45", "11:45")] });
    expect(r).toMatchObject({ lop: "CHAN", lyDo: ["Q2_VUOT_CA"], donViTra: null, tietVuotCa: ["x"], soTietTrongCa: 0 });
  });

  it("[P5-O10] tiết chưa được QLCS quyết ⇒ CHO (không tính trước); tiết bị TỪ CHỐI ⇒ đếm 0", () => {
    expect(dg({ tiet: [tiet("a", "18:00", "19:30", "CHUA")] })).toMatchObject({ lop: "CHO", lyDo: ["TIET_CHUA_QUYET"], donViTra: null });
    expect(dg({ tiet: [tiet("a", "18:00", "19:30", "TU_CHOI")] })).toMatchObject({ lop: "TU_DONG", donViTra: "1", soTietTrongCa: 0 });
  });

  it("[P5-O15] tiết thời lượng KHÔNG chuẩn trong ca ⇒ CHAN Q1_THOI_LUONG kể cả QLCS đã từ chối tiết đó (không âm thầm quyết Q1)", () => {
    expect(dg({ tiet: [tiet("q1", "18:00", "19:00", "Q1_KHONG_CHUAN")] })).toMatchObject({ lop: "CHAN", lyDo: ["Q1_THOI_LUONG"], donViTra: null });
  });

  it("[P5-O11] tiết ở ca KHÁC không đếm vào ca này", () => {
    expect(dg({ tiet: [tiet("sang", "08:00", "09:30"), tiet("chieu", "14:00", "15:30")] })).toMatchObject({ donViTra: "1", soTietTrongCa: 0, tietTrongCa: [] });
  });

  it("[P5-O12] không có mặt trong khung ca ⇒ CHAN; có mặt ở cơ sở khác không tính; phút có mặt là thước đo RIÊNG", () => {
    expect(dg({ khoang: [] })).toMatchObject({ lop: "CHAN", lyDo: ["KHONG_CO_MAT"] });
    expect(dg({ khoang: [coMat("17:10", "21:05", "cs2")] })).toMatchObject({ lop: "CHAN", lyDo: ["KHONG_CO_MAT"] });
    // Có mặt 1 giờ vẫn là 1,0 ca nếu không có tiết — đơn vị trả không quy từ phút.
    expect(dg({ khoang: [coMat("18:00", "19:00")] })).toMatchObject({ donViTra: "1", phutCoMatTrongCa: 60 });
    expect(dg().phutCoMatTrongCa).toBe(225);
  });

  it("[P5-O13] chưa hết ca ⇒ CHO; ngày LEGACY ⇒ không áp dụng; mã ca lạ ⇒ CHAN; trực đã huỷ ⇒ không áp dụng", () => {
    expect(dg({ now: vn("20:00") })).toMatchObject({ lop: "CHO", lyDo: ["CHUA_HET_CA"] });
    expect(dg({ thamSo: { loai: "LEGACY" } as ThamSoChinhSach })).toMatchObject({ lop: "KHONG_AP_DUNG", lyDo: ["LEGACY"] });
    expect(dg({ shiftCode: "X" })).toMatchObject({ lop: "CHAN", lyDo: ["MA_CA_KHONG_CO"] });
    expect(dg({ conSong: false })).toMatchObject({ lop: "KHONG_AP_DUNG", lyDo: ["TRUC_DA_HUY"] });
  });

  it("[P5-O14] dấu vân đổi khi tiết / quyết định / nhận / phiên bản đổi; KHÔNG đổi theo đồng hồ sau khi hết ca", () => {
    const vao = (p: Partial<DauVaoTruc> = {}, phienBan = 1) => {
      const v: DauVaoTruc = { thamSo: SRQD, ngay: NGAY, shiftCode: "T", centerId: "cs1", conSong: true, daNhan: true, tiet: [tiet("a", "18:00", "19:30")], khoang: [coMat("17:10", "21:05")], now: vn("22:00"), ...p };
      return dauVanTruc({ dutyId: "d1", phienBan, v, d: danhGiaTruc(v) });
    };
    const goc = vao();
    expect(vao({ now: new Date(vn("22:00").getTime() + 5 * 86_400_000) })).toBe(goc);
    expect(vao({ tiet: [tiet("a", "18:00", "19:30", "TU_CHOI")] })).not.toBe(goc);
    expect(vao({ tiet: [] })).not.toBe(goc);
    expect(vao({ daNhan: false })).not.toBe(goc);
    expect(vao({}, 2)).not.toBe(goc);
    // Tiết ở ca KHÁC (sáng) đổi quyết định ⇒ đơn vị trực ca tối KHÔNG được thành cũ.
    const sang = (q: TietTrongNgay["quyet"]) => vao({ tiet: [tiet("a", "18:00", "19:30"), tiet("s", "08:00", "09:30", q)] });
    expect(sang("XAC_NHAN")).toBe(sang("CHUA"));
    expect(sang("XAC_NHAN")).toBe(goc);
  });
});
