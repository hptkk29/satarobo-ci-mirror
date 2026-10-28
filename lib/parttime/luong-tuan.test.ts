// [LTU-*] — lương tuần của một giáo viên theo LOẠI (PR8 lưới phân công GV): KẾ HOẠCH tách từ chính các dòng tiền của ô (không tính lại),
// ĐÃ XÁC NHẬN tách từ đơn vị đã xác nhận. Tổng các loại PHẢI bằng tổng tuần màn in (luật 12b).
import { describe, expect, it } from "vitest";
import type { DongGiaoVien, HoatDongHien, OLuoi } from "./luoi-tuan-ghep";
import { tongHopTuan } from "./luong-tuan";

const hd = (id: string, loai: HoatDongHien["loai"], vai: "MAIN" | "TA" = "MAIN"): HoatDongHien => ({
  id,
  sourceType: "CLASS_SESSION",
  sourceId: `s-${id}`,
  vai,
  loai,
  gioBatDau: "18:00",
  gioKetThuc: "19:30",
  assignmentType: "REGULAR",
  daGan: true,
  trial: null,
});
const o = (p: Partial<OLuoi>): OLuoi => ({ ke: null, thucTe: null, hoatDong: [], trucId: null, canhBao: [], ...p });
const dong = (cells: Record<string, Record<string, OLuoi>>, tongTuan: number): DongGiaoVien =>
  ({ userId: "u", laMuon: false, o: cells, tongNgay: {}, tongTuan, rankTheoNgay: {}, ngoaiCa: {} }) as DongGiaoVien;

describe("[LTU] lương tuần theo loại", () => {
  it("[LTU-01] tách đúng nhóm: dạy chính · dạy bù · dạy thay · học vượt · trợ giảng · trực đủ ca · nửa ca · Trial; tổng = tổng tuần", () => {
    const tdBu = o({
      hoatDong: [hd("b1", "MAKEUP")],
      trucId: "d1",
      ke: {
        ma: "TD",
        coTrial: false,
        canhBao: [],
        tong: 165000,
        dong: [
          { loai: "MAIN", soLuong: 1, donGia: 120000, thanhTien: 120000, nguon: ["b1"] },
          { loai: "TRUC", soLuong: 0.5, donGia: 90000, thanhTien: 45000, nguon: ["d1"] },
        ],
      },
    });
    const d2 = o({
      hoatDong: [hd("r1", "REGULAR"), hd("t1", "SUBSTITUTE")],
      ke: { ma: "D2", coTrial: false, canhBao: [], tong: 240000, dong: [{ loai: "MAIN", soLuong: 2, donGia: 120000, thanhTien: 240000, nguon: ["r1", "t1"] }] },
    });
    const ttr = o({
      hoatDong: [hd("tr", "TRIAL"), hd("a1", "REGULAR", "TA")],
      trucId: "d2",
      ke: {
        ma: "TTG",
        coTrial: true,
        canhBao: [],
        tong: 155000,
        dong: [
          { loai: "TA", soLuong: 1, donGia: 80000, thanhTien: 80000, nguon: ["a1"] },
          { loai: "TRUC", soLuong: 0.5, donGia: 90000, thanhTien: 45000, nguon: ["d2"] },
          { loai: "TRIAL", soLuong: 0, donGia: 0, thanhTien: 30000, nguon: [] },
        ],
      },
    });
    const t = o({ trucId: "d3", ke: { ma: "T", coTrial: false, canhBao: [], tong: 90000, dong: [{ loai: "TRUC", soLuong: 1, donGia: 90000, thanhTien: 90000, nguon: ["d3"] }] } });
    const v = o({
      hoatDong: [hd("v1", "ADVANCE")],
      ke: { ma: "D", coTrial: false, canhBao: [], tong: 120000, dong: [{ loai: "MAIN", soLuong: 1, donGia: 120000, thanhTien: 120000, nguon: ["v1"] }] },
    });
    const r = tongHopTuan(dong({ "2026-11-02": { S: d2, C: ttr, T: tdBu }, "2026-11-03": { S: t, C: v } }, 770000));
    expect(Object.fromEntries(r.nhom.map((n) => [n.loai, n.keHoach]))).toEqual({
      DAY_CHINH: 120000,
      DAY_BU: 120000,
      DAY_THAY: 120000,
      HOC_VUOT: 120000,
      TRO_GIANG: 80000,
      TRUC_DU: 90000,
      TRUC_NUA: 90000,
      HO_TRO_TRIAL: 30000,
    });
    expect(r.keHoach).toBe(770000); // = tongTuan
    expect(r.chuaTinh).toBe(0);
  });

  it("[LTU-02] dòng tiền CHƯA TÍNH (vd. trực chờ quyết khi có học bù) không cộng — đếm riêng để màn nói ra", () => {
    const c = o({
      hoatDong: [hd("b1", "MAKEUP")],
      trucId: "d1",
      ke: {
        ma: "D",
        coTrial: false,
        canhBao: ["CAN_QUYET_TRUC"],
        tong: 120000,
        dong: [
          { loai: "MAIN", soLuong: 1, donGia: 120000, thanhTien: 120000, nguon: ["b1"] },
          { loai: "TRUC", soLuong: 0, donGia: 90000, thanhTien: null, nguon: ["d1"] },
        ],
      },
    });
    const r = tongHopTuan(dong({ "2026-11-02": { T: c } }, 120000));
    expect(r.keHoach).toBe(120000);
    expect(r.chuaTinh).toBe(1);
  });

  it("[LTU-03] ĐÃ XÁC NHẬN tách theo đơn vị thật (trực 1 ⇒ đủ ca, 0,5 ⇒ nửa ca; tiết dạy theo loại hoạt động); không có ⇒ 0", () => {
    const c = o({
      hoatDong: [hd("b1", "MAKEUP")],
      trucId: "d1",
      ke: { ma: "TD", coTrial: false, canhBao: [], tong: 165000, dong: [] },
      thucTe: { ma: "D", tong: 120000, dong: [{ assignmentId: "b1", loai: "MAIN_TEACHING", quantity: 1, thanhTien: 120000 }] },
    });
    const t = o({
      trucId: "d2",
      ke: { ma: "T", coTrial: false, canhBao: [], tong: 0, dong: [] },
      thucTe: { ma: "T", tong: 45000, dong: [{ assignmentId: "d2", loai: "OPERATIONS_DUTY", quantity: 0.5, thanhTien: 45000 }] },
    });
    const r = tongHopTuan(dong({ "2026-11-02": { T: c, S: t } }, 0));
    expect(Object.fromEntries(r.nhom.map((n) => [n.loai, n.daXacNhan]))).toMatchObject({ DAY_BU: 120000, TRUC_NUA: 45000, TRUC_DU: 0, DAY_CHINH: 0 });
    expect(r.daXacNhan).toBe(165000);
  });

  it("[LTU-04] một dòng MAIN gộp hai tiết có số lẻ ⇒ chia không rơi đồng nào: tổng các nhóm = thanhTien của dòng", () => {
    const c = o({
      hoatDong: [hd("r1", "REGULAR"), hd("b1", "MAKEUP")],
      ke: { ma: "D2", coTrial: false, canhBao: [], tong: 250001, dong: [{ loai: "MAIN", soLuong: 2, donGia: 125000, thanhTien: 250001, nguon: ["r1", "b1"] }] },
    });
    const r = tongHopTuan(dong({ "2026-11-02": { S: c } }, 250001));
    expect(r.keHoach).toBe(250001);
    expect(Object.fromEntries(r.nhom.map((n) => [n.loai, n.keHoach]))).toMatchObject({ DAY_CHINH: 125000, DAY_BU: 125001 });
  });
});
