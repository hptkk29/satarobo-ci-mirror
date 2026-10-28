// [DSLS-*] đối soát lịch sử cutover (thuần) + cổng chống mời hồi tố `chonBuoiNhap` + tác động lời mời. DB thật: [CUT-DB-04].
import { describe, expect, it } from "vitest";
import { chonBuoiNhap, tacDongLoiMoi, type KetQuaCutover } from "./cutover";
import { doiChieuPhanCongCo, phanLoaiLichSu, tongHopLichSu, type BuoiLichSu } from "./cutover-lich-su";

const goc: BuoiLichSu = {
  sessionId: "s1",
  centerCode: "CS2",
  classCode: "L1",
  ngay: "2026-10-17",
  gio: "10:00–11:30",
  trangThai: "COMPLETED",
  gvLopId: "gv",
  dayThayId: null,
  thucDayId: "gv",
  soDiemDanh: 8,
  soNhanXet: 8,
  phanCong: [],
};

describe("[DSLS] phanLoaiLichSu", () => {
  it("[DSLS-01] đã dạy, đủ ba bằng chứng ⇒ DA_DAY không ngoại lệ, người đứng lớp = người thực dạy", () => {
    expect(phanLoaiLichSu(goc)).toMatchObject({ loai: "DA_DAY", nguoiDungLop: "gv", ngoaiLe: [], ghiChu: [] });
  });
  it("[DSLS-02] đã dạy, thiếu từng bằng chứng ⇒ ngoại lệ đúng tên (không đoán)", () => {
    expect(phanLoaiLichSu({ ...goc, thucDayId: null }).ngoaiLe).toEqual(["THIEU_NGUOI_THUC_DAY"]);
    expect(phanLoaiLichSu({ ...goc, soDiemDanh: 0 }).ngoaiLe).toEqual(["THIEU_DIEM_DANH"]);
    expect(phanLoaiLichSu({ ...goc, soNhanXet: 0 }).ngoaiLe).toEqual(["THIEU_NHAN_XET"]);
  });
  it("[DSLS-03] thực dạy khác GV lớp (không phải người dạy thay đã xếp) ⇒ ghi chú, KHÔNG ngoại lệ", () => {
    expect(phanLoaiLichSu({ ...goc, thucDayId: "khac" })).toMatchObject({ ngoaiLe: [], ghiChu: ["THUC_DAY_KHAC_GV_LOP"], nguoiDungLop: "khac" });
    expect(phanLoaiLichSu({ ...goc, dayThayId: "khac", thucDayId: "khac" }).ghiChu).toEqual([]);
  });
  it("[DSLS-04] huỷ ⇒ DA_HUY; còn phân công sống trên buổi huỷ ⇒ ngoại lệ cho QLCS", () => {
    expect(phanLoaiLichSu({ ...goc, trangThai: "CANCELLED" })).toMatchObject({ loai: "DA_HUY", ngoaiLe: [], nguoiDungLop: null });
    const pc = [{ userId: "gv", role: "MAIN_TEACHER" as const, status: "WAITING_ACCEPTANCE", assignmentType: "SYSTEM", daNhan: false }];
    expect(phanLoaiLichSu({ ...goc, trangThai: "CANCELLED", phanCong: pc }).ngoaiLe).toEqual(["PHAN_CONG_SONG_TREN_BUOI_HUY"]);
  });
  it("[DSLS-05] đã qua mà chưa chốt ⇒ CHUA_CHOT, QLCS xác minh, không kết luận người đứng lớp", () => {
    for (const t of ["SCHEDULED", "IN_PROGRESS"]) expect(phanLoaiLichSu({ ...goc, trangThai: t, thucDayId: null })).toMatchObject({ loai: "CHUA_CHOT", ngoaiLe: ["CHUA_CHOT_BUOI"], nguoiDungLop: null });
  });
  it("[DSLS-06] tổng hợp đếm đúng từng loại", () => {
    const ds = [phanLoaiLichSu(goc), phanLoaiLichSu({ ...goc, soNhanXet: 0 }), phanLoaiLichSu({ ...goc, trangThai: "CANCELLED" }), phanLoaiLichSu({ ...goc, trangThai: "SCHEDULED" })];
    expect(tongHopLichSu(ds)).toEqual({ soBuoi: 4, daDay: 2, daDayDuBangChung: 1, daHuy: 1, chuaChot: 1, canQlcsXem: 2, ngoaiLe: { THIEU_NHAN_XET: 1, CHUA_CHOT_BUOI: 1 } });
  });
});

const kq = (p: Partial<KetQuaCutover>): KetQuaCutover => ({
  sessionId: "x",
  centerCode: "CS2",
  classCode: "L",
  ngay: "2026-10-21",
  gio: "18:00–19:30",
  mainId: "gv",
  taId: null,
  yeuCauTA: "OPTIONAL",
  thoiLuongDayPhut: 90,
  chinhSach: "CHUAN",
  nhom: "READY_TO_IMPORT",
  nhan: [],
  chinh: "READY_TO_IMPORT",
  lyDo: [],
  seNhap: [{ role: "MAIN_TEACHER", userId: "gv" }],
  ...p,
});

describe("[DSLS-NHAP] cổng nhập + tác động", () => {
  it("[DSLS-07] buổi trước hôm nay KHÔNG BAO GIỜ được nhập (chống mời hồi tố), buổi hôm nay và sau thì được", () => {
    const ds = [kq({ sessionId: "qua", ngay: "2026-10-17" }), kq({ sessionId: "nay", ngay: "2026-10-20" }), kq({ sessionId: "sau" })];
    expect(chonBuoiNhap(ds, "2026-10-20").map((k) => k.sessionId)).toEqual(["nay", "sau"]);
  });
  it("[DSLS-08] nhóm không nhập / không còn vai thiếu ⇒ không chọn", () => {
    expect(chonBuoiNhap([kq({ nhom: "MISSING_MAIN" }), kq({ nhom: "PENDING_ACCEPTANCE", seNhap: [] }), kq({ nhom: "REVIEW" })], "2026-10-20")).toEqual([]);
  });
  it("[DSLS-09] tác động: đếm lời mời theo vai và số người nhận, bỏ buổi đã qua", () => {
    const ds = [
      kq({ sessionId: "a", seNhap: [{ role: "MAIN_TEACHER", userId: "gv" }, { role: "TEACHING_ASSISTANT", userId: "ta" }] }),
      kq({ sessionId: "b", seNhap: [{ role: "MAIN_TEACHER", userId: "gv" }] }),
      kq({ sessionId: "c", ngay: "2026-10-17" }),
    ];
    expect(tacDongLoiMoi(ds, "2026-10-20")).toEqual({ loiMoi: 3, gvChinh: 2, troGiang: 1, soNguoiNhan: 2, theoNguoi: { gv: 2, ta: 1 } });
  });
});

describe("[DSLS-PC] đối chiếu phân công đã có — tách theo nguồn", () => {
  it("[DSLS-10] lớp chính khoá theo vị trí buổi; trial / học bù riêng; không gộp thành một tổng để trừ", () => {
    const viTri = new Map([["s-tl", "TUONG_LAI" as const], ["s-ls", "LICH_SU" as const]]);
    const r = doiChieuPhanCongCo(
      [
        { sourceType: "CLASS_SESSION", sourceId: "s-tl", role: "MAIN_TEACHER", status: "WAITING_ACCEPTANCE", userId: "a", ngay: "2026-10-21" },
        { sourceType: "CLASS_SESSION", sourceId: "s-tl", role: "TEACHING_ASSISTANT", status: "WAITING_ACCEPTANCE", userId: "b", ngay: "2026-10-21" },
        { sourceType: "CLASS_SESSION", sourceId: "s-ls", role: "MAIN_TEACHER", status: "WAITING_ACCEPTANCE", userId: "a", ngay: "2026-10-17" },
        { sourceType: "CLASS_SESSION", sourceId: "s-huy", role: "MAIN_TEACHER", status: "CANCELLED", userId: "a", ngay: "2026-10-18" },
        { sourceType: "TRIAL_SESSION", sourceId: "t", role: "MAIN_TEACHER", status: "WAITING_ACCEPTANCE", userId: "a", ngay: "2026-10-16" },
        { sourceType: "MAKEUP_CASE", sourceId: "m", role: "MAIN_TEACHER", status: "WAITING_ACCEPTANCE", userId: "a", ngay: "2026-10-25" },
      ],
      viTri,
    );
    expect(r).toEqual({
      tong: 6,
      lopChinhKhoa: { TUONG_LAI: { MAIN_TEACHER: 1, TEACHING_ASSISTANT: 1 }, LICH_SU: { MAIN_TEACHER: 1 }, NGOAI_PHAM_VI: { MAIN_TEACHER: 1 } },
      trial: { MAIN_TEACHER: 1 },
      hocBu: { MAIN_TEACHER: 1 },
      khac: {},
      theoTrangThai: { WAITING_ACCEPTANCE: 5, CANCELLED: 1 },
    });
  });
});

describe("[DSLS-DUNG] nút Dựng — không mời hồi tố", () => {
  it("[DSLS-11] duocDungMacDinh: hôm nay và sau thì dựng, trước hôm nay thì không", async () => {
    const { duocDungMacDinh } = await import("./phan-cong");
    expect([duocDungMacDinh("2026-10-19", "2026-10-20"), duocDungMacDinh("2026-10-20", "2026-10-20"), duocDungMacDinh("2026-10-21", "2026-10-20")]).toEqual([false, true, true]);
  });
});
