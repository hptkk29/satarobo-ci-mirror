// [GTPC-*] Kế hoạch ghi cứng lúc chốt kỳ THEO PHÂN CÔNG (chủ dự án chốt 09/11/2026). Thuần, mỗi ca xanh khi chạy một mình. Không tên thật.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DongGiaoVien, HoatDongHien, OLuoi } from "@/lib/parttime/luoi-tuan-ghep";
import { tongHopTuan } from "@/lib/parttime/luong-tuan";
import { keHoachGhiTheoPhanCong, tongGhiTheoNguoi } from "./ghi-theo-phan-cong";

const o = (p: Partial<OLuoi>): OLuoi => ({ ke: null, thucTe: null, hoatDong: [], trucId: null, canhBao: [], ...p });
const dong = (userId: string, cells: DongGiaoVien["o"], ngoaiCa: DongGiaoVien["ngoaiCa"] = {}): DongGiaoVien => ({
  userId,
  laMuon: false,
  o: cells,
  tongNgay: {},
  tongTuan: 0,
  rankTheoNgay: Object.fromEntries(Object.keys(cells).map((n) => [n, 2])),
  ngoaiCa,
});
// Ô C: 1 tiết đứng chính (rank 2, 130k) + trực nửa ca 45k. Ô T: D2 hai tiết (một lớp + một học bù).
const TD = o({
  trucId: "tc",
  ke: {
    ma: "TD",
    coTrial: false,
    canhBao: [],
    tong: 175000,
    tiet: [{ id: "c1", vai: "MAIN", soTiet: 1 }],
    dong: [
      { loai: "MAIN", soLuong: 1, donGia: 130000, thanhTien: 130000, nguon: ["c1"] },
      { loai: "TRUC", soLuong: 0.5, donGia: 90000, thanhTien: 45000, nguon: ["tc"] },
    ],
  },
});
const trialHd = (soCoMat: number, soTien: number): HoatDongHien => ({
  id: "tr1",
  sourceType: "TRIAL_SESSION",
  sourceId: "s-tr1",
  vai: "MAIN",
  loai: "TRIAL",
  gioBatDau: "20:00",
  gioKetThuc: "21:00",
  assignmentType: "REGULAR",
  daGan: true,
  trial: { trangThai: soTien > 0 ? "DU_DIEU_KIEN" : "KHONG_DU", soCoMat, soTien, lyDo: [] },
});
// Ô T: một tiết đứng chính + một trợ giảng + buổi Trial 1 HV có mặt (30.000đ — `xetHoTroTrial`).
const D2TG = o({
  hoatDong: [trialHd(1, 30000)],
  ke: {
    ma: "D+TG",
    coTrial: true,
    canhBao: [],
    tong: 240000,
    tiet: [
      { id: "t1", vai: "MAIN", soTiet: 1 },
      { id: "a1", vai: "TA", soTiet: 1 },
    ],
    dong: [
      { loai: "MAIN", soLuong: 1, donGia: 130000, thanhTien: 130000, nguon: ["t1"] },
      { loai: "TA", soLuong: 1, donGia: 80000, thanhTien: 80000, nguon: ["a1"] },
      { loai: "TRIAL", soLuong: 0, donGia: 0, thanhTien: 30000, nguon: [] },
    ],
  },
});
const LECH = o({
  trucId: "tl",
  ke: {
    ma: "TD",
    coTrial: false,
    canhBao: ["POLICY_UNRESOLVED", "TRUC_CHUA_TINH_DUOC"],
    tong: 0,
    tiet: [{ id: "l1", vai: "MAIN", soTiet: null }],
    dong: [
      { loai: "MAIN", soLuong: 0, donGia: 130000, thanhTien: 0, nguon: ["l1"] },
      { loai: "TRUC", soLuong: 0, donGia: 90000, thanhTien: null, nguon: ["tl"] },
    ],
  },
});
const MOI = (_u: string, n: string) => n >= "2026-11-01";

describe("keHoachGhiTheoPhanCong", () => {
  it("[GTPC-01] ghi MỌI tiết / ca trực engine tính — không có điều kiện lượt quét; số tiết, đơn giá, Rank là số engine", () => {
    const k = keHoachGhiTheoPhanCong([dong("u1", { "2026-11-05": { C: TD } })], MOI);
    expect(k.day).toEqual([{ assignmentId: "c1", userId: "u1", ngay: "2026-11-05", ca: "C", loai: "MAIN_TEACHING", soTiet: 1, donGia: 130000, rank: 2 }]);
    expect(k.truc).toEqual([{ dutyId: "tc", userId: "u1", ngay: "2026-11-05", ca: "C", soCa: 0.5, donGia: 90000 }]);
    expect(k.boQua).toEqual([]);
    expect(k.tienSeGhi).toBe(175000);
  });
  it("[GTPC-02] ĐẲNG THỨC: Σ sẽ ghi = Σ Lương dự kiến − phần chưa tính (kể cả hỗ trợ Trial — loại TRIAL_SUPPORT, 09/11/2026)", () => {
    const d = dong("u1", { "2026-11-05": { C: TD, T: D2TG }, "2026-11-06": { C: LECH } });
    const k = keHoachGhiTheoPhanCong([d], MOI);
    const lv = tongHopTuan(d);
    expect(lv.chuaTinh).toBe(1); // ca trực chưa tính được (tiết lệch chuẩn không có dòng tiền riêng: soLuong 0, thanhTien 0)
    expect(k.tienSeGhi).toBe(lv.keHoach);
    expect(k.day.map((x) => `${x.assignmentId}:${x.loai}`)).toEqual(["c1:MAIN_TEACHING", "t1:MAIN_TEACHING", "a1:ASSISTANT_TEACHING"]);
    expect(k.trial).toEqual([{ assignmentId: "tr1", userId: "u1", ngay: "2026-11-05", ca: "T", soCoMat: 1, donGia: 30000 }]);
    expect(k.boQua.map((b) => `${b.loai}:${b.id}`)).toEqual(["TIET_CHUA_TINH:l1", "TRUC_CHUA_TINH:tl"]);
  });
  it("[GTPC-02b] buổi Trial KHÔNG đủ điều kiện (0đ) ⇒ không có đơn vị Trial", () => {
    const c = o({ hoatDong: [trialHd(0, 0)], ke: { ma: "X", coTrial: true, canhBao: [], tong: 0, tiet: [], dong: [{ loai: "TRIAL", soLuong: 0, donGia: 0, thanhTien: 0, nguon: [] }] } });
    expect(keHoachGhiTheoPhanCong([dong("u1", { "2026-11-05": { T: c } })], MOI)).toMatchObject({ trial: [], tienSeGhi: 0 });
  });
  it("[GTPC-03] ngày / người KHÔNG theo phân công (trước mốc, FULLTIME) ⇒ không ghi gì (đối chứng âm)", () => {
    const d = dong("u1", { "2026-10-30": { C: TD }, "2026-11-05": { C: TD } });
    expect(keHoachGhiTheoPhanCong([d], MOI).day.map((x) => x.ngay)).toEqual(["2026-11-05"]);
    expect(keHoachGhiTheoPhanCong([d], () => false)).toMatchObject({ day: [], truc: [], boQua: [], tienSeGhi: 0 });
  });
  it("[GTPC-04] trực quy đổi 0 (≥ 2 tiết) ⇒ không có mục trực; phân công vượt ca ⇒ bỏ qua có lý do", () => {
    const c = o({ trucId: "t0", ke: { ma: null, coTrial: false, canhBao: [], tong: 0, tiet: [], dong: [{ loai: "TRUC", soLuong: 0, donGia: 90000, thanhTien: 0, nguon: ["t0"] }] } });
    const k = keHoachGhiTheoPhanCong([dong("u1", { "2026-11-05": { C: c } }, { "2026-11-05": [{ id: "v1", gioBatDau: "11:00", gioKetThuc: "14:00" }] })], MOI);
    expect(k.truc).toEqual([]);
    expect(k.boQua.map((b) => `${b.loai}:${b.id}`)).toEqual(["VUOT_CA:v1"]);
  });
  it("[GTPC-05] tổng theo người = cộng mục kế hoạch; đếm mục chưa tính riêng", () => {
    const k = keHoachGhiTheoPhanCong([dong("u1", { "2026-11-05": { C: TD, T: D2TG }, "2026-11-06": { C: LECH } }), dong("u2", { "2026-11-05": { C: TD } })], MOI);
    const t = tongGhiTheoNguoi(k);
    expect(t.find((x) => x.userId === "u1")).toEqual({ userId: "u1", tietChinh: 2, tietTroGiang: 1, caTruc: 0.5, buoiTrial: 1, tien: 415000, boQua: 2, chuaTinh: 2 });
    expect(t.reduce((s, x) => s + x.tien, 0)).toBe(k.tienSeGhi);
  });
});

describe("[GTPC-W] lưới ghim dây nối — chốt kỳ và màn đọc ĐÚNG kế hoạch theo phân công", () => {
  const doc = (p: string) =>
    readFileSync(resolve(process.cwd(), p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
  it("[GTPC-W1] ghiCungDay lập kế hoạch bằng docKeHoachGhiKy → keHoachGhiTheoPhanCong (engine docLuoiTuan + chamTheoPhanCong); KHÔNG còn đọc ô theo lượt quét", () => {
    const src = doc("lib/phan-cong/chot-ky-cong-db.ts");
    expect(src).not.toContain("docCongOThang");
    expect(src).not.toContain("TU_DONG");
    expect(src).toMatch(/const \{ tu, den, ke \} = await docKeHoachGhiKy\(p\);/);
    expect(src).toMatch(/keHoachGhiTheoPhanCong\(luoi\.dong, \(userId, ngay\) => chamTheoPhanCong\(\{/);
    // Đơn vị trực ghi bằng số engine, không bằng đánh giá P5.
    expect(src).toMatch(/donViTheoPhanCong: \{ soCa: muc\.soCa, donGia: muc\.donGia \}/);
    // Đã có đơn vị CONFIRMED cùng phiên bản ⇒ giữ nguyên (3 chỗ: dạy + hỗ trợ Trial + trực).
    expect(src.match(/w\.assignmentVersion === /g)?.length).toBe(3);
    // Hỗ trợ Trial ghi bằng đơn vị TRIAL_SUPPORT đúng số engine.
    expect(src).toMatch(/anh: anhChupHoTroTrial\(m\.soCoMat, m\.donGia\)/);
    expect(doc("lib/cham-cong/period.ts")).toMatch(/keHoachTruc\(\{ centerId: input\.centerId, periodKey: input\.periodKey, now, keTruc: day\.keTruc \}\)/);
  });
  it("[GTPC-W2] tab 'Tổng hợp tự động' in CÙNG docKeHoachGhiKy (không tự tính); xác nhận tay P5 vẫn truyền donViTheoPhanCong: null", () => {
    const page = doc("app/(admin)/admin/cham-cong/phan-cong/thang/page.tsx");
    expect(page).toMatch(/docKeHoachGhiKy\(\{ centerId: coSo, periodKey: thang, now \}\)/);
    expect(page).toMatch(/nguoi: tongGhiTheoNguoi\(keGhi\.ke\)/);
    expect(doc("lib/parttime/truc-van-hanh-db.ts")).toMatch(/now: p\.now, donViTheoPhanCong: null \}/);
  });
});
