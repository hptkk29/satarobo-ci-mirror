// [VNG-*] Việc theo phân công cắt theo NGÀY (chủ dự án chốt 08/11/2026). Thuần. Mỗi ca xanh khi chạy một mình. Không họ tên thật.
import { describe, expect, it } from "vitest";
import type { DongGiaoVien, HoatDongHien, OLuoi } from "./luoi-tuan-ghep";
import { tongHopTuan } from "./luong-tuan";
import { nhanCaTruc, nhanViec, tongViec, viecTheoNgay, type LuoiCoSo } from "./viec-ngay";

const hd = (id: string, loai: HoatDongHien["loai"], vai: "MAIN" | "TA" = "MAIN"): HoatDongHien => ({
  id,
  sourceType: loai === "TRIAL" ? "TRIAL_SESSION" : "CLASS_SESSION",
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
const rong = () => o({ ke: { tiet: [], ma: "X", coTrial: false, canhBao: [], tong: 0, dong: [] } });
const dong = (userId: string, cells: Record<string, Record<string, OLuoi>>, ngoaiCa: DongGiaoVien["ngoaiCa"] = {}): DongGiaoVien & { ten: string } => ({
  userId,
  ten: `GV ${userId}`,
  laMuon: false,
  o: cells,
  tongNgay: {},
  tongTuan: 0,
  rankTheoNgay: {},
  ngoaiCa,
});

// Ô C: 1 tiết đứng chính + trực ⇒ TD, trực nửa ca. Ô T: 2 tiết ⇒ D2. Ô S: chỉ trực ⇒ T (1 ca).
const TD = o({
  hoatDong: [hd("c1", "REGULAR")],
  trucId: "tc",
  ke: { tiet: [],
    ma: "TD",
    coTrial: false,
    canhBao: [],
    tong: 165000,
    dong: [
      { loai: "MAIN", soLuong: 1, donGia: 120000, thanhTien: 120000, nguon: ["c1"] },
      { loai: "TRUC", soLuong: 0.5, donGia: 90000, thanhTien: 45000, nguon: ["tc"] },
    ],
  },
});
const D2 = o({
  hoatDong: [hd("t1", "REGULAR"), hd("t2", "MAKEUP")],
  ke: { tiet: [], ma: "D2", coTrial: false, canhBao: [], tong: 240000, dong: [{ loai: "MAIN", soLuong: 2, donGia: 120000, thanhTien: 240000, nguon: ["t1", "t2"] }] },
});
const T = o({ trucId: "ts", ke: { tiet: [], ma: "T", coTrial: false, canhBao: [], tong: 90000, dong: [{ loai: "TRUC", soLuong: 1, donGia: 90000, thanhTien: 90000, nguon: ["ts"] }] } });

const gopCua = (userId: string, ngay: string, ma: Record<string, string>, trial: string[] = []) => ({
  userId,
  o: { [ngay]: Object.fromEntries(Object.entries(ma).map(([ca, m]) => [ca, { ma: m, coTrial: trial.includes(ca) }])) },
});

describe("viecTheoNgay", () => {
  it("[VNG-01] đếm từ DÒNG TIỀN của ô (không từ hoatDong): tiết chính, trực đủ/nửa, mã ô từ lưới gộp; tiền = tongHopTuan của ngày", () => {
    const d = dong("u1", { "2026-11-05": { S: T, C: TD, T: D2 } });
    const luoi: LuoiCoSo[] = [{ centerId: "cs2", gop: [gopCua("u1", "2026-11-05", { S: "T", C: "TD", T: "D2" })], tuan: [d] }];
    const [v] = viecTheoNgay(luoi, "TAT_CA");
    expect(v).toMatchObject({ userId: "u1", ngay: "2026-11-05", coSo: ["cs2"], tietChinh: 3, tietTroGiang: 0, trucDu: 1, trucNua: 1, trucQuyDoi: 1.5, chuaTinh: 0, ngoaiCa: 0, legacy: false });
    expect(v!.o.map((x) => `${x.ca}:${x.ma}`)).toEqual(["S:T", "C:TD", "T:D2"]);
    expect(v!.tien).toBe(495000);
    // CÙNG con số màn Phân công in cho tuần (tongHopTuan của cả dòng).
    expect(v!.tien).toBe(tongHopTuan(d).keHoach);
    expect(nhanViec(v!)).toBe("3 tiết · trực 1½");
  });

  it("[VNG-02] việc GHÉP / Trial / chưa nhận có trong hoatDong nhưng KHÔNG có dòng MAIN ⇒ không thành tiết; Trial nói 'Trial 1'; mã có +TR", () => {
    // Ô C: một buổi lớp + một học bù GHÉP (tinhCaDuKien chỉ cộng 1 tiết) + buổi Trial (tiền hỗ trợ riêng).
    const c = o({
      hoatDong: [hd("l1", "REGULAR"), hd("b1", "MAKEUP"), hd("tr1", "TRIAL")],
      ke: { tiet: [],
        ma: "D",
        coTrial: true,
        canhBao: [],
        tong: 150000,
        dong: [
          { loai: "MAIN", soLuong: 1, donGia: 120000, thanhTien: 120000, nguon: ["l1"] },
          { loai: "TRIAL", soLuong: 0, donGia: 0, thanhTien: 30000, nguon: [] },
        ],
      },
    });
    const [v] = viecTheoNgay([{ centerId: "cs1", gop: [gopCua("u1", "2026-11-06", { C: "D" }, ["C"])], tuan: [dong("u1", { "2026-11-06": { C: c } })] }], ["u1"]);
    expect(v).toMatchObject({ tietChinh: 1, soBuoiTrial: 1, tien: 150000 });
    expect(v!.tienTheoNhom.HO_TRO_TRIAL).toBe(30000);
    expect(v!.o[0]).toMatchObject({ ma: "D", coTrial: true });
    expect(nhanViec(v!)).toBe("1 tiết · Trial 1");
  });

  it("[VNG-03] dòng tiền CHƯA tính được (thanhTien null) ⇒ không cộng tiền / tiết / trực, đếm vào chuaTinh", () => {
    const lech = o({
      hoatDong: [hd("l1", "REGULAR")],
      trucId: "tc",
      canhBao: ["POLICY_UNRESOLVED", "TRUC_CHUA_TINH_DUOC"],
      ke: { tiet: [],
        ma: "TD",
        coTrial: false,
        canhBao: ["POLICY_UNRESOLVED", "TRUC_CHUA_TINH_DUOC"],
        tong: 0,
        dong: [
          { loai: "MAIN", soLuong: 0, donGia: 120000, thanhTien: 0, nguon: ["l1"] },
          { loai: "TRUC", soLuong: 0, donGia: 90000, thanhTien: null, nguon: ["tc"] },
        ],
      },
    });
    const [v] = viecTheoNgay([{ centerId: "cs1", gop: [], tuan: [dong("u1", { "2026-11-07": { C: lech } })] }], "TAT_CA");
    expect(v).toMatchObject({ tien: 0, trucQuyDoi: 0, chuaTinh: 1 });
    expect(v!.o[0]!.canhBao).toContain("POLICY_UNRESOLVED");
    // Không có lưới gộp cho ô ⇒ rơi về mã của engine tiền (không bịa).
    expect(v!.o[0]!.ma).toBe("TD");
  });

  it("[VNG-04] ô trống (không việc, không trực) KHÔNG thành dòng; ngày chỉ có phân công vượt ca vẫn thành dòng và nói ngoaiCa", () => {
    const ds = viecTheoNgay(
      [
        {
          centerId: "cs1",
          gop: [],
          tuan: [dong("u1", { "2026-11-08": { S: rong(), C: rong(), T: rong() }, "2026-11-09": { S: rong() } }, { "2026-11-09": [{ id: "x", gioBatDau: "11:00", gioKetThuc: "14:00" }] })],
        },
      ],
      "TAT_CA",
    );
    expect(ds.map((v) => v.ngay)).toEqual(["2026-11-09"]);
    expect(ds[0]).toMatchObject({ ngoaiCa: 1, o: [], tien: 0 });
    expect(nhanViec(ds[0]!)).toBe("Không có tiết / trực");
  });

  it("[VNG-05] cùng người cùng ngày ở HAI cơ sở ⇒ GỘP (site GV); lọc userIds chỉ giữ đúng người", () => {
    const luoi: LuoiCoSo[] = [
      { centerId: "cs1", gop: [], tuan: [dong("u1", { "2026-11-05": { S: T } }), dong("u2", { "2026-11-05": { C: TD } })] },
      { centerId: "cs2", gop: [], tuan: [dong("u1", { "2026-11-05": { T: D2 } })] },
    ];
    const ds = viecTheoNgay(luoi, ["u1"]);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ userId: "u1", coSo: ["cs1", "cs2"], tietChinh: 2, trucDu: 1, tien: 330000 });
    expect(ds[0]!.o.map((x) => `${x.centerId}:${x.ca}`)).toEqual(["cs1:S", "cs2:T"]);
    // Admin xem MỘT cơ sở ⇒ chỉ việc ở cơ sở đó.
    expect(viecTheoNgay([luoi[0]!], ["u1"])[0]).toMatchObject({ tien: 90000, coSo: ["cs1"] });
  });

  it("[VNG-06] ngày không có chính sách (ke null) ⇒ legacy, không tiền, không tiết (màn nói 'chưa có chính sách', không in 0 công)", () => {
    const [v] = viecTheoNgay([{ centerId: "cs1", gop: [], tuan: [dong("u1", { "2026-10-20": { C: o({ hoatDong: [hd("l", "REGULAR")], canhBao: ["LEGACY"] }) } })] }], "TAT_CA");
    expect(v).toMatchObject({ legacy: true, tien: 0, tietChinh: 0 });
  });

  it("[VNG-07] tongViec cộng đúng các trường đã cắt; tổng tiền tháng = Σ tiền ngày", () => {
    const ds = viecTheoNgay([{ centerId: "cs1", gop: [], tuan: [dong("u1", { "2026-11-05": { S: T, C: TD }, "2026-11-06": { T: D2 } })] }], "TAT_CA");
    const t = tongViec(ds);
    expect(t).toMatchObject({ soNgay: 2, tietChinh: 3, trucDu: 1, trucNua: 1, tien: 495000 });
    expect(t.tienTheoNhom.TRUC_DU + t.tienTheoNhom.TRUC_NUA).toBe(135000);
  });

  it("[VNG-08] nhãn ca trực: ½ · 1 · 1½ · 2", () => {
    expect([0.5, 1, 1.5, 2].map(nhanCaTruc)).toEqual(["½", "1", "1½", "2"]);
    expect(nhanViec({ tietChinh: 0, tietTroGiang: 1, trucQuyDoi: 0.5, soBuoiTrial: 0 })).toBe("TG 1 · trực ½");
  });
});
