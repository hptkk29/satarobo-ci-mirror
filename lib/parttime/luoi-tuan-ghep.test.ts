// [LTG-*] — ghép lưới tuần từ dòng nguồn (thuần). Mỗi ca mô phỏng TRẠNG THÁI NGUỒN sau một sự kiện (book / dời / huỷ / đổi người /
// dạy thay) — lưới không có bảng riêng nên "tự cập nhật" nghĩa là: dữ liệu nguồn đổi ⇒ lần ghép sau ra mã mới. Mốc tuyệt đối (luật 19).
import { describe, expect, it } from "vitest";
import type { BanChinhSach } from "./chinh-sach";
import { docThamSo } from "./chinh-sach";
import { ghepLuoi, type DauVaoGhep, type PhanCongVao, type TrucVao } from "./luoi-tuan-ghep";
import type { KetQuaTrial } from "./luoi-tuan";

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
const CS: BanChinhSach[] = [
  { id: "legacy", code: "LEGACY", hieuLucTu: "2000-01-01", hieuLucDen: "2026-10-14", thamSo: { loai: "LEGACY" } },
  { id: "srqd", code: "SR.QD.238", hieuLucTu: "2026-10-15", hieuLucDen: null, thamSo: SRQD },
];
const T7 = "2026-11-07";
const CN = "2026-11-08";
const NGAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", T7, CN];
const CHUAN = { trangThai: "CHUAN", donVi: "1", ghiDeId: null } as const;

let n = 0;
const pc = (p: Partial<PhanCongVao> = {}): PhanCongVao => ({
  id: `pc${++n}`,
  userId: "gvA",
  centerId: "cs2",
  sourceType: "CLASS_SESSION",
  sourceId: `s${n}`,
  ngay: T7,
  gioBatDau: "18:00",
  gioKetThuc: "19:30",
  role: "MAIN_TEACHER",
  activityType: "REGULAR_CLASS",
  assignmentType: "REGULAR",
  status: "ACCEPTED",
  donViTiet: CHUAN,
  ...p,
});
const truc = (p: Partial<TrucVao> = {}): TrucVao => ({ id: `d${++n}`, userId: "gvA", centerId: "cs2", ngay: T7, shiftCode: "T", status: "ACCEPTED", ...p });
const vao = (p: Partial<DauVaoGhep> = {}): DauVaoGhep => ({
  centerId: "cs2",
  ngays: NGAYS,
  chinhSach: CS,
  phanCong: [],
  phanCongNoiKhac: [],
  truc: [],
  rank: new Map(),
  coSoGoc: new Map([["gvA", "cs2"]]),
  trial: new Map(),
  daXacNhan: [],
  nghiDaDuyet: new Set(),
  ...p,
});
const o = (r: ReturnType<typeof ghepLuoi>, ngay = T7, ca = "T", user = "gvA") => r.find((d) => d.userId === user)!.o[ngay]![ca]!;

describe("[LTG] lưới tuần — dữ liệu nguồn đổi ⇒ mã đổi", () => {
  it("[LTG-01] EV-01 lớp cố định tự lên lưới: một buổi lớp MAIN 18:00 T7 ⇒ ô T7·T = D, 120.000", () => {
    const r = ghepLuoi(vao({ phanCong: [pc()] }));
    expect(o(r).ke).toMatchObject({ ma: "D", tong: 120000 });
    expect(r[0]!.tongNgay[T7]).toBe(120000);
  });
  it("[LTG-02] EV-08 book học bù vào ca T đang có trực ⇒ TD 165.000; EV-09 không trực ⇒ D", () => {
    expect(o(ghepLuoi(vao({ phanCong: [pc({ sourceType: "MAKEUP_CASE", activityType: "MAKEUP" })], truc: [truc()] }))).ke).toMatchObject({ ma: "TD", tong: 165000 });
    expect(o(ghepLuoi(vao({ phanCong: [pc({ sourceType: "MAKEUP_CASE", activityType: "MAKEUP" })] }))).ke).toMatchObject({ ma: "D" });
  });
  it("[LTG-03] EV-10 học bù bị huỷ (phân công không còn trong danh sách sống) ⇒ ô quay về T nếu chỉ còn trực", () => {
    expect(o(ghepLuoi(vao({ phanCong: [], truc: [truc()] }))).ke).toMatchObject({ ma: "T", tong: 90000 });
  });
  it("[LTG-04] EV-11 học bù dời T7 tối → CN sáng: hai ô đều cập nhật, T7·T chỉ còn trực", () => {
    const r = ghepLuoi(vao({ phanCong: [pc({ sourceType: "MAKEUP_CASE", activityType: "MAKEUP", ngay: CN, gioBatDau: "09:45", gioKetThuc: "11:15" })], truc: [truc()] }));
    expect(o(r).ke).toMatchObject({ ma: "T" });
    expect(o(r, CN, "S").ke).toMatchObject({ ma: "D", tong: 120000 });
  });
  it("[LTG-05] EV-02 / EV-03 Trial trong ca trực: T + lớp phủ TR; huỷ Trial ⇒ trực GIỮ NGUYÊN", () => {
    const trialPc = pc({ sourceType: "TRIAL_SESSION", activityType: "TRIAL", gioBatDau: "20:00", gioKetThuc: "21:00" });
    const kq: KetQuaTrial = { trangThai: "DU_DIEU_KIEN", soCoMat: 2, soTien: 60000, lyDo: [] };
    const co = o(ghepLuoi(vao({ phanCong: [trialPc], truc: [truc()], trial: new Map([[trialPc.id, kq]]) })));
    expect(co.ke).toMatchObject({ ma: "T", coTrial: true, tong: 150000 });
    expect(o(ghepLuoi(vao({ phanCong: [], truc: [truc()] }))).ke).toMatchObject({ ma: "T", coTrial: false, tong: 90000 });
  });
  it("[LTG-06] EV-12 / EV-13 đổi GV (dạy thay đã duyệt): phân công sống chuyển sang người mới ⇒ ô hiện ở người mới, người cũ X", () => {
    const r = ghepLuoi(vao({ phanCong: [pc({ userId: "gvB", assignmentType: "SUBSTITUTE" })], truc: [truc()], coSoGoc: new Map([["gvA", "cs2"], ["gvB", "cs2"]]) }));
    expect(o(r, T7, "T", "gvB").ke).toMatchObject({ ma: "D" });
    expect(o(r, T7, "T", "gvB").hoatDong[0]!.loai).toBe("SUBSTITUTE");
    expect(o(r).ke).toMatchObject({ ma: "T" }); // gvA vẫn còn trực
  });
  it("[LTG-07] EV-15 hai buổi cùng giờ (kể cả ở cơ sở khác) ⇒ cảnh báo TRUNG_GIO + O_CO_SO_KHAC", () => {
    const r = ghepLuoi(vao({ phanCong: [pc()], phanCongNoiKhac: [pc({ centerId: "cs1", gioBatDau: "19:00", gioKetThuc: "20:30" })] }));
    expect(o(r).canhBao).toEqual(expect.arrayContaining(["TRUNG_GIO", "O_CO_SO_KHAC"]));
  });
  it("[LTG-08] EV-16 GV mượn từ cơ sở khác ⇒ laMuon, cơ sở gốc không đổi; tiền tính ở cơ sở đang xem", () => {
    const r = ghepLuoi(vao({ phanCong: [pc()], coSoGoc: new Map([["gvA", "cs1"]]) }));
    expect(r[0]).toMatchObject({ laMuon: true });
    expect(o(r).ke?.tong).toBe(120000);
  });
  it("[LTG-09] EV-20 buổi lệch chuẩn ⇒ POLICY_UNRESOLVED trên ô, 0đ tiết đó", () => {
    const r = ghepLuoi(vao({ phanCong: [pc({ donViTiet: { trangThai: "NEEDS_POLICY_DECISION", donVi: null, ghiDeId: null, lyDo: "THOI_LUONG_LECH_CHUAN" } })] }));
    expect(o(r).canhBao).toContain("POLICY_UNRESOLVED");
    expect(o(r).ke?.tong).toBe(0);
  });
  it("[LTG-10] Rank theo NGÀY hiệu lực: R2 từ CN ⇒ T7 120k, CN 140k (không tính lại ngày trước)", () => {
    const r = ghepLuoi(vao({ phanCong: [pc(), pc({ ngay: CN })], rank: new Map([["gvA", [{ rank: 2, hieuLucTu: CN }]]]) }));
    expect(o(r).ke?.tong).toBe(120000);
    expect(o(r, CN).ke?.tong).toBe(140000);
    expect(r[0]!.rankTheoNgay).toMatchObject({ [T7]: 1, [CN]: 2 });
  });
  it("[LTG-11] phân công còn chờ nhận ⇒ CHUA_NHAN; tiết vượt ranh ca ⇒ ngoaiCa của ngày, không ép vào ô", () => {
    const r = ghepLuoi(vao({ phanCong: [pc({ status: "WAITING_ACCEPTANCE" }), pc({ gioBatDau: "11:00", gioKetThuc: "12:30" })] }));
    expect(o(r).canhBao).toContain("CHUA_NHAN");
    expect(r[0]!.ngoaiCa[T7]).toHaveLength(1);
    expect(o(r, T7, "S").hoatDong).toHaveLength(0);
  });
  it("[LTG-12] THỰC TẾ chỉ từ đơn vị đã xác nhận: KẾ TD nhưng chỉ xác nhận tiết dạy (không xác nhận trực) ⇒ thực tế D", () => {
    const p1 = pc({ sourceType: "MAKEUP_CASE", activityType: "MAKEUP" });
    const t1 = truc();
    const r = ghepLuoi(vao({ phanCong: [p1], truc: [t1], daXacNhan: [{ assignmentId: p1.id, loai: "MAIN_TEACHING", quantity: 1, rateSnapshot: 120000 }] }));
    expect(o(r).ke?.ma).toBe("TD");
    expect(o(r).thucTe).toEqual({ ma: "D", tong: 120000 });
  });
  it("[LTG-13] chưa xác nhận gì ⇒ thực tế null (không suy công từ booking)", () => {
    expect(o(ghepLuoi(vao({ phanCong: [pc()] }))).thucTe).toBeNull();
  });
  it("[LTG-14] ngày LEGACY (trước 15/10) ⇒ không mã, không tiền, cảnh báo LEGACY", () => {
    const r = ghepLuoi(vao({ ngays: ["2026-10-10"], phanCong: [pc({ ngay: "2026-10-10" })] }));
    expect(o(r, "2026-10-10").ke).toBeNull();
    expect(o(r, "2026-10-10").canhBao).toContain("LEGACY");
    expect(r[0]!.tongTuan).toBe(0);
  });
  it("[LTG-15] tổng tuần = Σ tổng ngày; ví dụ chủ dự án S TD + C T + T X (R1) = 255.000", () => {
    const r = ghepLuoi(vao({ phanCong: [pc({ gioBatDau: "09:45", gioKetThuc: "11:15" })], truc: [truc({ shiftCode: "S" }), truc({ shiftCode: "C" })] }));
    expect(r[0]!.tongNgay[T7]).toBe(255000);
    expect(r[0]!.tongTuan).toBe(255000);
  });
});

describe("[LTG-NGHI] đơn nghỉ đã duyệt (G3)", () => {
  it("[LTG-16] EV-14 GV có đơn nghỉ ĐÃ DUYỆT nhưng còn buổi trong ngày ⇒ cảnh báo NGHI_DA_DUYET; MAIN KHÔNG tự đổi người", () => {
    const r = ghepLuoi(vao({ phanCong: [pc()], nghiDaDuyet: new Set([`gvA|${T7}`]) }));
    expect(o(r).canhBao).toContain("NGHI_DA_DUYET");
    expect(o(r).ke).toMatchObject({ ma: "D" }); // vẫn là buổi của gvA — chỉ dạy thay được duyệt mới đổi người
  });
  it("[LTG-17] đơn nghỉ ngày khác / người khác ⇒ không cảnh báo; ngày nghỉ không có việc ⇒ không cảnh báo", () => {
    expect(o(ghepLuoi(vao({ phanCong: [pc()], nghiDaDuyet: new Set([`gvA|${CN}`, `gvB|${T7}`]) }))).canhBao).not.toContain("NGHI_DA_DUYET");
    const r = ghepLuoi(vao({ phanCong: [pc()], nghiDaDuyet: new Set([`gvA|${T7}`]) }));
    expect(o(r, T7, "S").canhBao).not.toContain("NGHI_DA_DUYET");
  });
});
