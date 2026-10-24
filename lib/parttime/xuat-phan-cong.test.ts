// [XPC-*] — xuất phân công GV 4 dạng. Số phải là số của màn lưới (luật 12b): tổng dạng D = tổng tuần màn in.
import { describe, expect, it } from "vitest";
import type { LuoiTuan } from "./luoi-tuan-db";
import type { OLuoi, HoatDongHien } from "./luoi-tuan-ghep";
import { dungFileXuat, trangThaiDoiSoat, type CoSoXuat } from "./xuat-phan-cong";

const hd = (p: Partial<HoatDongHien>): HoatDongHien => ({
  id: "a1", sourceType: "CLASS_SESSION", sourceId: "S1", vai: "MAIN", loai: "REGULAR", gioBatDau: "17:30", gioKetThuc: "19:00", assignmentType: "REGULAR", daGan: true, trial: null, ...p,
});
const oTD: OLuoi = {
  ke: {
    ma: "TD", coTrial: false, tong: 165000, canhBao: [],
    dong: [
      { loai: "MAIN", soLuong: 1, donGia: 120000, thanhTien: 120000, nguon: ["a1"] },
      { loai: "TRUC", soLuong: 0.5, donGia: 90000, thanhTien: 45000, nguon: ["d1"] },
    ],
  },
  thucTe: null, hoatDong: [hd({})], trucId: "d1", canhBao: [],
};
const oT: OLuoi = { ke: { ma: "T", coTrial: false, tong: 90000, canhBao: [], dong: [{ loai: "TRUC", soLuong: 1, donGia: 90000, thanhTien: 90000, nguon: ["d2"] }] }, thucTe: { ma: "T", tong: 90000 }, hoatDong: [], trucId: "d2", canhBao: [] };
const oX: OLuoi = { ke: { ma: null, coTrial: false, tong: 0, canhBao: [], dong: [] }, thucTe: null, hoatDong: [], trucId: null, canhBao: [] };

const luoi = (): LuoiTuan => ({
  ngays: ["2026-11-02", "2026-11-03"],
  lopTrialCuaBuoi: {},
  dong: [
    { userId: "u1", ten: "GV Một", tenCoSoGoc: "CS1", laMuon: true, o: { "2026-11-02": { S: oX, C: oX, T: oTD }, "2026-11-03": { S: oT, C: oX, T: oX } }, tongNgay: { "2026-11-02": 165000, "2026-11-03": 90000 }, tongTuan: 255000, rankTheoNgay: { "2026-11-02": 2, "2026-11-03": 2 }, ngoaiCa: {} },
    { userId: "u2", ten: "GV Hai", tenCoSoGoc: "CS2", laMuon: false, o: { "2026-11-02": { S: oT, C: oX, T: oX }, "2026-11-03": { S: oX, C: oX, T: oX } }, tongNgay: { "2026-11-02": 90000, "2026-11-03": 0 }, tongTuan: 90000, rankTheoNgay: {}, ngoaiCa: {} },
  ],
});
const cs = (): CoSoXuat => ({ ma: "CS2", luoi: luoi(), bangChung: new Map([["a1", "Có mặt đủ"]]), tuanThu: new Map([["a1", "COMPLIANT"]]) });
const hang = (ws: import("exceljs").Worksheet) => ws.getRows(4, Math.max(0, ws.rowCount - 3))?.map((r) => (r.values as unknown[]).slice(1)) ?? [];
const KHONG_LOC = { userId: null, trangThai: null };

describe("[XPC] xuất phân công", () => {
  it("[XPC-01] bốn dạng A/B/C/D", () => {
    expect(dungFileXuat({ tu: "2026-11-02", den: "2026-11-03", coSo: [cs()], loc: KHONG_LOC }).worksheets.map((w) => w.name)).toEqual(["A_LUOI_TUAN", "B_CHI_TIET", "C_DOI_SOAT", "D_THU_NHAP"]);
  });
  it("[XPC-02] trạng thái đối soát: chính sách cũ · chưa xác nhận · khớp · lệch", () => {
    expect(trangThaiDoiSoat({ ...oX, ke: null })).toBe("CHINH_SACH_CU");
    expect(trangThaiDoiSoat(oTD)).toBe("CHUA_XAC_NHAN");
    expect(trangThaiDoiSoat(oT)).toBe("KHOP");
    expect(trangThaiDoiSoat({ ...oTD, thucTe: { ma: "D", tong: 120000 } })).toBe("LECH");
  });
  it("[XPC-03] B: ô TD tách 2 dòng (dạy + trực), tiền từng dòng, Rank đúng ngày, cơ sở gốc/dùng, bằng chứng + tuân thủ theo assignmentId", () => {
    const b = hang(dungFileXuat({ tu: "2026-11-02", den: "2026-11-03", coSo: [cs()], loc: KHONG_LOC }).getWorksheet("B_CHI_TIET")!);
    const td = b.filter((r) => r[4] === "2026-11-02" && r[2] === "GV Một");
    expect(td.map((r) => [r[0], r[1], r[3], r[6], r[7], r[11], r[16], r[17], r[20]])).toEqual([
      ["CS1", "CS2", 2, "CLASS_SESSION", "S1", "TD", "Có mặt đủ", "COMPLIANT", 120000],
      ["CS1", "CS2", 2, "OPERATIONS_DUTY", "d1", "TD", "", "", 45000],
    ]);
    expect(b).toHaveLength(4); // TD (2) + T của GV Một + T của GV Hai; ô X không xuất
  });
  it("[XPC-04] D: tổng dự kiến mỗi GV = tổng tuần màn lưới in (cùng nguồn)", () => {
    const d = hang(dungFileXuat({ tu: "2026-11-02", den: "2026-11-03", coSo: [cs()], loc: KHONG_LOC }).getWorksheet("D_THU_NHAP")!);
    expect(d.map((r) => [r[2], r[4], r[6], r[8], r[9]])).toEqual([
      ["GV Một", 120000, 135000, 255000, 90000],
      ["GV Hai", 0, 90000, 90000, 90000],
    ]);
    for (const g of luoi().dong) expect(d.find((r) => r[2] === g.ten)![8]).toBe(g.tongTuan);
  });
  it("[XPC-05] lọc theo GV và theo trạng thái đối soát", () => {
    const c1 = hang(dungFileXuat({ tu: "2026-11-02", den: "2026-11-03", coSo: [cs()], loc: { userId: "u2", trangThai: null } }).getWorksheet("C_DOI_SOAT")!);
    expect(c1.map((r) => r[2])).toEqual(["GV Hai"]);
    const c2 = hang(dungFileXuat({ tu: "2026-11-02", den: "2026-11-03", coSo: [cs()], loc: { userId: null, trangThai: "CHUA_XAC_NHAN" } }).getWorksheet("C_DOI_SOAT")!);
    expect(c2.map((r) => [r[2], r[5], r[10]])).toEqual([["GV Một", "TD", "Chưa xác nhận"]]);
  });
});
