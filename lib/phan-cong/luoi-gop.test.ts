// [LG-*] Ghép lưới Phân công gộp (GĐ3). Thuần, mốc tuyệt đối, mỗi ca xanh khi chạy một mình.
import { describe, expect, it } from "vitest";
import { docThamSo, type ThamSoSrQd238 } from "@/lib/parttime/chinh-sach";
import { ghepLuoiGop, type BuoiVao } from "./luoi-gop";

const TS = docThamSo({
  loai: "SR_QD_238",
  tiet: { chuanBiPhut: 10, dayPhut: 90, chuanPhut: 100 },
  ca: [
    { ma: "S", tu: "07:45", den: "11:30" },
    { ma: "C", tu: "13:45", den: "17:30" },
    { ma: "T", tu: "17:15", den: "21:00" },
  ],
  toiDaTietMoiCa: 2,
  donGia: { mainTheoRank: { "1": 1, "2": 1, "3": 1, "4": 1 }, troGiang: 1, trucCa: 2, nuaCaTruc: 1 },
  rankMacDinh: 1,
  nguongTroGiang: [],
}) as ThamSoSrQd238;
const N = "2026-11-04";
const thamSoTai = (ngay: string) => (ngay >= "2026-10-15" ? TS : null);
let k = 0;
const buoi = (p: Partial<BuoiVao> & Pick<BuoiVao, "sourceType" | "gioBatDau" | "gioKetThuc">): BuoiVao => ({
  key: `b${++k}`,
  sourceId: `s${k}`,
  ngay: N,
  ten: "Lớp",
  phu: null,
  phong: "P1",
  mo: true,
  main: null,
  ta: [],
  ...p,
});
const nguoi = [{ id: "gv", ten: "GV", laMuon: false }];

describe("ghepLuoiGop", () => {
  it("[LG-01] học bù / Trial rơi vào ca KHÔNG ai trực ⇒ đánh dấu; có người trực ca đó ⇒ không; buổi lớp không bao giờ đánh dấu", () => {
    const bu = buoi({ sourceType: "MAKEUP_CASE", gioBatDau: "14:00", gioKetThuc: "15:30" });
    const tr = buoi({ sourceType: "TRIAL_SESSION", gioBatDau: "18:00", gioKetThuc: "19:00" });
    const lop = buoi({ sourceType: "CLASS_SESSION", gioBatDau: "09:00", gioKetThuc: "10:30" });
    const r = ghepLuoiGop({ ngays: [N], thamSoTai, centerId: "cs", nguoi, buoi: [bu, tr, lop], truc: [{ id: "d1", userId: "x", ngay: N, shiftCode: "T" }], viecNoiKhac: [] });
    const co = Object.fromEntries(r.buoi.map((b) => [b.key, b.khongAiTruc]));
    expect(co).toEqual({ [bu.key]: true, [tr.key]: false, [lop.key]: false });
    expect(r.trucTheoCa[N]).toEqual({ T: ["x"] });
  });
  it("[LG-02] đứng chính + trực cùng ca ⇒ TD, trực 0,5; cặp quét là cặp trực", () => {
    const lop = buoi({ sourceType: "CLASS_SESSION", gioBatDau: "14:00", gioKetThuc: "15:30", main: { id: "pc1", userId: "gv" } });
    const r = ghepLuoiGop({ ngays: [N], thamSoTai, centerId: "cs", nguoi, buoi: [lop], truc: [{ id: "d1", userId: "gv", ngay: N, shiftCode: "C" }], viecNoiKhac: [] });
    expect(r.dong[0]!.o[N]!.C).toMatchObject({ ma: "TD", trucQuyDoi: 0.5, trucId: "d1", viec: [{ assignmentId: "pc1", buoiKey: lop.key, vai: "MAIN" }] });
    expect(r.dong[0]!.o[N]!.S).toMatchObject({ ma: "X" });
    expect(r.dong[0]!.cap[N]!.map((c) => c.ma)).toEqual(["TRUC_C"]);
  });
  it("[LG-03] việc ở CƠ SỞ KHÁC chồng giờ ⇒ cờ đỏ ở ô của cơ sở đang xem; không chồng ⇒ không cờ (đối chứng)", () => {
    const lop = buoi({ sourceType: "CLASS_SESSION", gioBatDau: "14:00", gioKetThuc: "15:30", main: { id: "pc1", userId: "gv" } });
    const chong = ghepLuoiGop({ ngays: [N], thamSoTai, centerId: "cs", nguoi, buoi: [lop], truc: [], viecNoiKhac: [{ id: "x1", userId: "gv", ngay: N, gioBatDau: "15:00", gioKetThuc: "16:00", coSoId: "cs2", loai: "LOP" }] });
    expect(chong.dong[0]!.o[N]!.C!.coTrungGio).toBe(true);
    const khong = ghepLuoiGop({ ngays: [N], thamSoTai, centerId: "cs", nguoi, buoi: [lop], truc: [], viecNoiKhac: [{ id: "x1", userId: "gv", ngay: N, gioBatDau: "16:00", gioKetThuc: "17:00", coSoId: "cs2", loai: "LOP" }] });
    expect(khong.dong[0]!.o[N]!.C!.coTrungGio).toBe(false);
  });
  it("[LG-04] ngày trước SR.QD.238 ⇒ không có lưới (không đoán mã)", () => {
    const r = ghepLuoiGop({ ngays: ["2026-10-10"], thamSoTai, centerId: "cs", nguoi, buoi: [], truc: [], viecNoiKhac: [] });
    expect(r.caTheoNgay["2026-10-10"]).toBeNull();
    expect(r.dong[0]!.o["2026-10-10"]).toBeUndefined();
  });
  it("[LG-05] buổi đã đóng KHÔNG đánh dấu không ai trực", () => {
    const bu = buoi({ sourceType: "MAKEUP_CASE", gioBatDau: "14:00", gioKetThuc: "15:30", mo: false });
    expect(ghepLuoiGop({ ngays: [N], thamSoTai, centerId: "cs", nguoi, buoi: [bu], truc: [], viecNoiKhac: [] }).buoi[0]!.khongAiTruc).toBe(false);
  });
});
