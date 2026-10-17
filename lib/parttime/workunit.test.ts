// [P5-*] — ỨNG VIÊN đơn vị công việc từ bằng chứng P4 (thuần, đồng hồ đóng băng). DB: tests/cham-cong/parttime-workunit.spec.ts.
import { describe, expect, it } from "vitest";
import type { BangChungPhanCong } from "./bang-chung-cong";
import { docThamSo, type ThamSoChinhSach } from "./chinh-sach";
import { anhChupDonVi, kiemXacNhan, lyDoCu, trangThaiHieuLuc, xetUngVien, type UngVienWorkUnit } from "./workunit";

const SRQD = docThamSo({
  loai: "SR_QD_238",
  tiet: { chuanBiPhut: 10, dayPhut: 90, chuanPhut: 100 },
  ca: [{ ma: "T", tu: "17:15", den: "21:00" }],
  toiDaTietMoiCa: 2,
  donGia: { mainTheoRank: { "1": 120000, "2": 140000, "3": 160000, "4": 200000 }, troGiang: 80000, trucCa: 90000, nuaCaTruc: 45000 },
  rankMacDinh: 1,
  nguongTroGiang: [],
});
const LEGACY: ThamSoChinhSach = { loai: "LEGACY" };
const vn = (h: string, ngay = "2026-11-02") => new Date(`${ngay}T${h}:00+07:00`);
const NOW = vn("22:00");

type Tuy = Partial<Omit<BangChungPhanCong, "dongDoi">> & { dongDoi?: Partial<BangChungPhanCong["dongDoi"]> };
const bc = (p: Tuy = {}): BangChungPhanCong => {
  const { dongDoi, ...con } = p;
  return {
    assignmentId: "pc1",
    assignmentVersion: 1,
    userId: "gv",
    role: "MAIN_TEACHER",
    activity: "REGULAR_CLASS",
    sourceType: "CLASS_SESSION",
    sourceId: "s1",
    centerId: "cs1",
    workDate: "2026-11-02",
    requiredFrom: vn("17:50"),
    requiredTo: vn("19:30"),
    trangThai: "DU_BANG_CHUNG",
    coMat: "DU",
    treVaoPhut: 0,
    diMuon: false,
    raSomPhut: 0,
    raSom: false,
    khopNguoiDay: "KHOP",
    daNhan: true,
    checkInAt: vn("17:45"),
    checkOutAt: vn("19:35"),
    canhBaoLuot: [],
    ngoaiLe: [],
    dauVan: "dv1",
    ...con,
    dongDoi: { attendanceInId: "in", attendanceOutId: "out", nguoiDayId: "gv", nguonNguoiDay: "class.teacherId", tinhTrangBuoi: "DA_CHOT", chinhSach: "SR.QD.238", ...dongDoi },
  };
};
const xet = (p: Tuy = {}, ctx: { thamSo?: ThamSoChinhSach | null; hocBuVangMat?: boolean; now?: Date } = {}) =>
  xetUngVien(bc(p), { thamSo: ctx.thamSo === undefined ? SRQD : ctx.thamSo, hocBuVangMat: ctx.hocBuVangMat ?? false, now: ctx.now ?? NOW });

describe("[P5] ứng viên đơn vị công việc", () => {
  it("[P5-01] đứng chính thường, sạch ⇒ TU_DONG · MAIN_TEACHING · ảnh chụp 1 × 100' theo Rank", () => {
    expect(xet()).toEqual({ lop: "TU_DONG", lyDo: [], loai: "MAIN_TEACHING", thoiLuongDayPhut: 90 });
    expect(anhChupDonVi("MAIN_TEACHING", SRQD, 2)).toEqual({ loai: "MAIN_TEACHING", quantity: "1", standardMinutes: 100, rateSnapshot: 140000, rankSnapshot: 2 });
  });

  it("[P5-02] dạy thay: ứng viên giữ loại MAIN_TEACHING (dạy thay là CHIỀU assignmentType, không phải loại trả tiền)", () => {
    expect(xet({ dongDoi: { nguonNguoiDay: "substituteTeacherId" } })).toMatchObject({ lop: "TU_DONG", loai: "MAIN_TEACHING" });
  });

  it("[P5-04] học bù đứng chính ⇒ MAIN_TEACHING (hoạt động MAKEUP là chiều, không phải lối tắt trả tiền)", () => {
    expect(xet({ activity: "MAKEUP", sourceType: "MAKEUP_CASE" })).toMatchObject({ lop: "TU_DONG", loai: "MAIN_TEACHING" });
  });

  it("[P5-05] trợ giảng ⇒ ASSISTANT_TEACHING 1 × 100' · 80.000đ; KHÔNG đòi khớp người đứng lớp", () => {
    expect(xet({ role: "TEACHING_ASSISTANT", khopNguoiDay: "KHONG_XET" })).toMatchObject({ lop: "TU_DONG", loai: "ASSISTANT_TEACHING" });
    expect(anhChupDonVi("ASSISTANT_TEACHING", SRQD, null)).toEqual({ loai: "ASSISTANT_TEACHING", quantity: "1", standardMinutes: 100, rateSnapshot: 80000, rankSnapshot: null });
  });

  it("[P5-06] học thử (TRIAL) KHÔNG thành tiết đứng chính", () => {
    expect(xet({ activity: "TRIAL", sourceType: "TRIAL_SESSION" })).toEqual({ lop: "KHONG_AP_DUNG", lyDo: ["TRIAL_TACH_RIENG"], loai: null, thoiLuongDayPhut: 90 });
  });

  it("[P5-07] không có bằng chứng có mặt ⇒ CHAN (không xác nhận được kể cả tay)", () => {
    expect(xet({ trangThai: "KHONG_BANG_CHUNG", coMat: "KHONG", checkInAt: null, checkOutAt: null })).toMatchObject({ lop: "CHAN", lyDo: ["KHONG_BANG_CHUNG"] });
  });

  it("[P5-08] người đứng lớp khác người được phân ⇒ CHAN; MAIN không xác định được người đứng lớp cũng CHAN", () => {
    expect(xet({ trangThai: "SAI_NGUOI_DUNG_LOP", khopNguoiDay: "LECH" })).toMatchObject({ lop: "CHAN", lyDo: ["SAI_NGUOI_DUNG_LOP"] });
    expect(xet({ khopNguoiDay: "KHONG_XET" })).toMatchObject({ lop: "CHAN", lyDo: ["KHONG_RO_NGUOI_DUNG_LOP"] });
  });

  it("[P5-11] ngày LEGACY (trước 15/10) ⇒ KHONG_AP_DUNG, không sinh đơn vị", () => {
    expect(xet({ trangThai: "KHONG_AP_DUNG", requiredFrom: null, requiredTo: null }, { thamSo: LEGACY })).toMatchObject({ lop: "KHONG_AP_DUNG", lyDo: ["LEGACY"], loai: null });
    expect(xet({}, { thamSo: null })).toMatchObject({ lop: "KHONG_AP_DUNG", lyDo: ["LEGACY"] });
  });

  it("[P5-12] thời lượng KHÔNG chuẩn (60' / 120') ⇒ CHAN THOI_LUONG_KHONG_CHUAN (Q1 còn mở — không suy số tiết)", () => {
    expect(xet({ requiredTo: vn("19:00") })).toMatchObject({ lop: "CHAN", lyDo: ["THOI_LUONG_KHONG_CHUAN"], thoiLuongDayPhut: 60 });
    expect(xet({ requiredTo: vn("20:00") })).toMatchObject({ lop: "CHAN", thoiLuongDayPhut: 120 });
  });

  it("[P5-13] buổi chưa chốt / chưa hết giờ / đã huỷ / chưa nhận", () => {
    expect(xet({ dongDoi: { tinhTrangBuoi: "MO" } })).toMatchObject({ lop: "CHUA_XONG", lyDo: ["BUOI_CHUA_CHOT"] });
    expect(xet({}, { now: vn("19:00") })).toMatchObject({ lop: "CHUA_XONG", lyDo: ["CHUA_HET_GIO"] });
    expect(xet({ trangThai: "BUOI_DA_HUY", dongDoi: { tinhTrangBuoi: "DA_DONG" } })).toMatchObject({ lop: "KHONG_AP_DUNG", lyDo: ["BUOI_DA_HUY"] });
    expect(xet({ daNhan: false })).toMatchObject({ lop: "CHAN", lyDo: ["CHUA_NHAN"] });
  });

  it("[P5-14] có mặt nhưng có ngoại lệ ⇒ XEM_TAY (muộn · muộn > 30' · ra sớm · thiếu ra · cảnh báo thiết bị · học bù vắng mặt)", () => {
    expect(xet({ trangThai: "DI_MUON", diMuon: true, treVaoPhut: 8 })).toMatchObject({ lop: "XEM_TAY", lyDo: ["DI_MUON"] });
    expect(xet({ trangThai: "DI_MUON", diMuon: true, treVaoPhut: 31 })).toMatchObject({ lop: "XEM_TAY", lyDo: ["TRE_QUA_30"] });
    expect(xet({ trangThai: "DI_MUON", diMuon: true, treVaoPhut: 30 })).toMatchObject({ lyDo: ["DI_MUON"] });
    expect(xet({ trangThai: "RA_SOM", raSom: true, raSomPhut: 30 })).toMatchObject({ lop: "XEM_TAY", lyDo: ["RA_SOM"] });
    expect(xet({ trangThai: "THIEU_RA", coMat: "THIEU_RA", checkOutAt: null })).toMatchObject({ lop: "XEM_TAY", lyDo: ["THIEU_RA"] });
    expect(xet({ canhBaoLuot: ["THIET_BI_CHUA_TIN_CAY"] })).toMatchObject({ lop: "XEM_TAY", lyDo: ["CANH_BAO_THIET_BI"] });
    expect(xet({ activity: "MAKEUP", sourceType: "MAKEUP_CASE" }, { hocBuVangMat: true })).toMatchObject({ lop: "XEM_TAY", lyDo: ["HOC_BU_VANG_MAT"] });
  });

  it("[P5-15] dòng bị CHAN vẫn nói thêm ngoại lệ có mặt (để màn hình không giấu)", () => {
    expect(xet({ requiredTo: vn("19:00"), diMuon: true, treVaoPhut: 8 }).lyDo).toEqual(["THOI_LUONG_KHONG_CHUAN", "DI_MUON"]);
  });
});

describe("[P5-STALE] đơn vị đã xác nhận còn là căn cứ không", () => {
  const dv = { status: "CONFIRMED" as const, assignmentVersion: 1, evidenceFingerprint: "dv1" };
  it("[P5-10] phiên bản đổi / dấu vân đổi / phân công không còn sống ⇒ CŨ; kỳ khoá ⇒ giữ nguyên", () => {
    expect(lyDoCu(dv, { assignmentVersion: 1, dauVan: "dv1" }, false)).toBeNull();
    expect(lyDoCu(dv, { assignmentVersion: 2, dauVan: "dv1" }, false)).toBe("PHIEN_BAN_DOI");
    expect(lyDoCu(dv, { assignmentVersion: 1, dauVan: "dv2" }, false)).toBe("BANG_CHUNG_DOI");
    expect(lyDoCu(dv, null, false)).toBe("PHAN_CONG_KHONG_CON_SONG");
    expect(lyDoCu(dv, { assignmentVersion: 2, dauVan: "dv9" }, true)).toBeNull();
    expect(trangThaiHieuLuc(dv, { assignmentVersion: 1, dauVan: "dv2" }, false)).toBe("STALE");
    expect(trangThaiHieuLuc({ ...dv, status: "VOIDED" }, { assignmentVersion: 1, dauVan: "dv1" }, false)).toBe("VOIDED");
  });
});

describe("[P5-GATE] cổng xác nhận", () => {
  const uv = (lop: UngVienWorkUnit["lop"], lyDo: UngVienWorkUnit["lyDo"] = []): UngVienWorkUnit => ({ lop, lyDo, loai: "MAIN_TEACHING", thoiLuongDayPhut: 90 });
  const kiem = (p: Partial<Parameters<typeof kiemXacNhan>[0]> = {}) =>
    kiemXacNhan({ ungVien: uv("TU_DONG"), phienBanHienTai: 1, dauVanHienTai: "a", phienBanDaXem: 1, dauVanDaXem: "a", quyetDinh: "CONFIRMED", lyDo: null, nguoiXacNhanId: "ql", nguoiLamId: "gv", kyKhoa: false, hangLoat: false, ...p });
  it("[P5-GATE-01] sạch ⇒ qua (lẻ lẫn hàng loạt)", () => {
    expect(kiem()).toBeNull();
    expect(kiem({ hangLoat: true })).toBeNull();
  });
  it("[P5-GATE-02] tự xác nhận công của mình · kỳ đã khoá · dữ liệu đổi sau khi xem ⇒ từ chối", () => {
    expect(kiem({ nguoiXacNhanId: "gv" })).toMatch(/chính mình/);
    expect(kiem({ kyKhoa: true })).toMatch(/khoá/);
    expect(kiem({ dauVanDaXem: "b" })).toMatch(/vừa thay đổi/);
    expect(kiem({ phienBanDaXem: 2 })).toMatch(/vừa thay đổi/);
  });
  it("[P5-GATE-03] XEM_TAY: hàng loạt bị loại; lẻ đòi lý do; CHAN thì không xác nhận được kể cả có lý do", () => {
    expect(kiem({ ungVien: uv("XEM_TAY", ["DI_MUON"]), hangLoat: true })).toMatch(/từng dòng/);
    expect(kiem({ ungVien: uv("XEM_TAY", ["DI_MUON"]) })).toMatch(/lý do/);
    expect(kiem({ ungVien: uv("XEM_TAY", ["DI_MUON"]), lyDo: "GV báo kẹt xe, QLCS đã kiểm" })).toBeNull();
    expect(kiem({ ungVien: uv("CHAN", ["THOI_LUONG_KHONG_CHUAN"]), lyDo: "xác nhận đại" })).toMatch(/THOI_LUONG_KHONG_CHUAN/);
    expect(kiem({ ungVien: uv("CHUA_XONG", ["BUOI_CHUA_CHOT"]) })).toMatch(/chưa tới lượt/);
  });
  it("[P5-GATE-04] từ chối / cần bổ sung luôn đòi lý do; làm được cả với dòng CHAN", () => {
    expect(kiem({ quyetDinh: "REJECTED" })).toMatch(/lý do/);
    expect(kiem({ quyetDinh: "REJECTED", ungVien: uv("CHAN", ["KHONG_BANG_CHUNG"]), lyDo: "Không có mặt" })).toBeNull();
    expect(kiem({ quyetDinh: "NEEDS_INFO", lyDo: "Bổ sung ảnh lớp" })).toBeNull();
  });
});
