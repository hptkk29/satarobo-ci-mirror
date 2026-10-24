// [PT3B-*] Công Parttime SR.QD.238 · P3b — luật THUẦN của Control Tower, bằng chứng chấm công, chia tab "Công việc của
// tôi", và hàm chung "mặc định + tình trạng buổi". Đồng hồ ĐÓNG BĂNG (luật 19): mọi `now` là mốc cố định.
import { describe, expect, it } from "vitest";
import { canhBaoBuoi, demThe, MA_THE, THE, xemTruocKhoiDong, type MaThe } from "./control-tower";
import { nhanBangChung } from "./nhan-bang-chung";
import { canhBaoTuBangChung } from "./control-tower";
import type { BangChungPhanCong } from "./bang-chung-cong";
import { chiaTab } from "./cong-viec";
import { macDinhCuaBuoi } from "./phan-cong";
import type { BuoiTrongTuan, DongPhanCong, PhanCongCuaToi } from "./bang-phan-cong";

const NOW = new Date("2026-11-02T08:00:00+07:00"); // Thứ Hai 02/11/2026, 08:00 giờ VN

let soId = 0;
const pc = (p: Partial<DongPhanCong> = {}): DongPhanCong => ({
  id: `pc${++soId}`,
  userId: "gv",
  ten: "GV",
  role: "MAIN_TEACHER",
  status: "WAITING_ACCEPTANCE",
  assignmentType: "SYSTEM",
  phienBan: 1,
  daNhan: false,
  lyDoTuChoi: null,
  song: true,
  ...p,
});
const buoi = (p: Partial<BuoiTrongTuan> = {}): BuoiTrongTuan => ({
  key: `CLASS_SESSION:s${++soId}`,
  sourceType: "CLASS_SESSION",
  sourceId: `s${soId}`,
  ngay: "2026-11-02",
  gioBatDau: "17:30",
  gioKetThuc: "19:30",
  ten: "Sata 3",
  phu: null,
  activity: "REGULAR_CLASS",
  trangThaiBuoi: "SCHEDULED",
  tinhTrang: "MO",
  lyDoDong: null,
  daDong: false,
  classId: "c1",
  siSo: 5,
  phong: null,
  apDung: true,
  yeuCauTA: "OPTIONAL",
  trangThai: "WAITING_ACCEPTANCE",
  main: pc(),
  ta: null,
  lichSu: [],
  macDinhMainId: "gv",
  macDinhMainKieu: "SYSTEM",
  macDinhTaId: null,
  nguoiDayThay: null,
  nguoiDungLop: "gv",
  keHoach: [],
  nhatKySua: [],
  ...p,
});
const ma = (b: BuoiTrongTuan, now = NOW) => canhBaoBuoi(b, now).map((c) => c.ma);

describe("[PT3B-KPI] thẻ số và bộ lọc dùng CHUNG một vị từ", () => {
  const ds = [
    buoi({ trangThai: "STAFFING_CONFIRMED", main: pc({ daNhan: true, status: "ACCEPTED" }) }),
    buoi({ trangThai: "WAITING_ACCEPTANCE" }),
    buoi({ trangThai: "STAFFING_DRAFT", main: null }),
    buoi({ trangThai: "PARTIALLY_ACCEPTED", yeuCauTA: "REQUIRED", ta: null }),
    buoi({ trangThai: "NEEDS_REASSIGNMENT", main: null, lichSu: [pc({ status: "DECLINED", song: false })] }),
    buoi({ apDung: false, main: null }), // LEGACY — không phải việc
    buoi({ tinhTrang: "DA_DONG", lyDoDong: "Lớp đã huỷ", daDong: true, main: null }), // lớp huỷ — không phải việc
  ];

  it("[PT3B-KPI-01] mỗi thẻ đếm ĐÚNG bằng số buổi mà bộ lọc của chính nó trả ra", () => {
    const dem = demThe(ds);
    for (const m of MA_THE) expect(dem[m], m).toBe(ds.filter((b) => THE[m].khop(b)).length);
  });

  it("[PT3B-KPI-02] số cụ thể: buổi LEGACY và buổi của lớp đã huỷ KHÔNG vào thẻ nào", () => {
    expect(demThe(ds)).toEqual<Record<MaThe, number>>({ tong: 5, du: 1, "cho-xac-nhan": 2, "thieu-gv": 2, "thieu-ta": 1, "tu-choi": 1, "phan-lai": 1 });
  });
});

describe("[PT3B-CB] canhBaoBuoi", () => {
  it("[PT3B-CB-01] buổi trong 24 giờ tới mà MAIN chưa nhận ⇒ cảnh báo; quá 24 giờ hoặc đã nhận ⇒ không", () => {
    expect(ma(buoi({ ngay: "2026-11-02", gioBatDau: "17:30" }))).toContain("SAP_DIEN_RA_MAIN_CHUA_NHAN");
    expect(ma(buoi({ ngay: "2026-11-04", gioBatDau: "17:30" }))).not.toContain("SAP_DIEN_RA_MAIN_CHUA_NHAN");
    expect(ma(buoi({ main: pc({ daNhan: true, status: "ACCEPTED" }) }))).not.toContain("SAP_DIEN_RA_MAIN_CHUA_NHAN");
  });

  it("[PT3B-CB-02] thiếu TA bắt buộc; TA tuỳ chọn vắng thì không", () => {
    expect(ma(buoi({ yeuCauTA: "REQUIRED" }))).toContain("THIEU_TA_BAT_BUOC");
    expect(ma(buoi({ yeuCauTA: "OVERRIDDEN_REQUIRED" }))).toContain("THIEU_TA_BAT_BUOC");
    expect(ma(buoi({ yeuCauTA: "OPTIONAL" }))).not.toContain("THIEU_TA_BAT_BUOC");
  });

  it("[PT3B-CB-03] MAIN / TA đã từ chối mà vai chưa có người nhận lại ⇒ cảnh báo riêng từng vai", () => {
    const tc = (role: DongPhanCong["role"]) => pc({ status: "DECLINED", song: false, role });
    expect(ma(buoi({ main: null, lichSu: [tc("MAIN_TEACHER")] }))).toContain("MAIN_TU_CHOI");
    expect(ma(buoi({ ta: null, lichSu: [tc("TEACHING_ASSISTANT")] }))).toContain("TA_TU_CHOI");
    expect(ma(buoi({ main: pc({ daNhan: true, status: "ACCEPTED" }), lichSu: [tc("MAIN_TEACHER")] }))).not.toContain("MAIN_TU_CHOI");
  });

  it("[PT3B-CB-04] lịch đổi (phiên bản > 1) chưa nhận lại ⇒ cảnh báo", () => {
    expect(ma(buoi({ main: pc({ phienBan: 2 }) }))).toContain("LICH_DOI_CAN_NHAN_LAI");
    expect(ma(buoi({ main: pc({ phienBan: 1 }) }))).not.toContain("LICH_DOI_CAN_NHAN_LAI");
  });

  it("[PT3B-CB-05] đã diễn ra mà chưa đủ người ⇒ cảnh báo; đủ người thì không", () => {
    const qua = { ngay: "2026-11-01", gioBatDau: "17:30" };
    expect(ma(buoi({ ...qua, trangThai: "WAITING_ACCEPTANCE" }))).toContain("DA_DIEN_RA_CHUA_DU");
    expect(ma(buoi({ ...qua, trangThai: "STAFFING_CONFIRMED", main: pc({ daNhan: true }) }))).not.toContain("DA_DIEN_RA_CHUA_DU");
  });

  it("[PT3B-CB-06] MAIN đã nhận nhưng người được quy công là người khác ⇒ cần đối soát (chỉ buổi lớp)", () => {
    expect(ma(buoi({ main: pc({ daNhan: true, userId: "gv" }), nguoiDungLop: "gv-khac" }))).toContain("LECH_NGUOI_DUNG_LOP");
    expect(ma(buoi({ main: pc({ daNhan: true, userId: "gv" }), nguoiDungLop: "gv" }))).not.toContain("LECH_NGUOI_DUNG_LOP");
    expect(ma(buoi({ sourceType: "MAKEUP_CASE", main: pc({ daNhan: true }), nguoiDungLop: "khac" }))).not.toContain("LECH_NGUOI_DUNG_LOP");
  });

  it("[PT3B-CB-07] ngoại lệ + ảnh chụp lệch đến từ CHÍNH kế hoạch đồng bộ (không suy lại)", () => {
    const b = buoi({
      keHoach: [
        { loai: "NGOAI_LE", ma: "LECH_PHAN_CONG_TAY", role: "MAIN_TEACHER", userId: "gv", chiTiet: "" },
        { loai: "DOI_LICH", id: "x" },
      ],
    });
    expect(ma(b)).toEqual(expect.arrayContaining(["LECH_PHAN_CONG_TAY", "ANH_CHUP_LECH"]));
  });

  it("[PT3B-CB-08] buổi không phải việc (LEGACY / đã đóng) chỉ còn cảnh báo ĐỐI SOÁT, không cảnh báo vận hành", () => {
    const b = buoi({ tinhTrang: "DA_DONG", daDong: true, yeuCauTA: "REQUIRED", main: null, ngay: "2026-11-01" });
    expect(ma(b)).toEqual([]);
    const chot = buoi({ tinhTrang: "DA_DONG", keHoach: [{ loai: "NGOAI_LE", ma: "DA_CHOT_NHUNG_BUOI_DONG", role: "MAIN_TEACHER", userId: "gv", chiTiet: "" }] });
    expect(ma(chot)).toEqual(["DA_CHOT_NHUNG_BUOI_DONG"]);
  });
});

describe("[PT3B-XT] xem trước khởi động", () => {
  it("[PT3B-XT-01] đếm TẠO / THAY theo vai từ kế hoạch chạy thử; bỏ buổi không phải việc", () => {
    const ds = [
      buoi({ keHoach: [{ loai: "TAO", role: "MAIN_TEACHER", userId: "a", kieu: "SYSTEM" }, { loai: "TAO", role: "TEACHING_ASSISTANT", userId: "b", kieu: "SYSTEM" }] }),
      buoi({ keHoach: [{ loai: "THAY", cuId: "x", role: "MAIN_TEACHER", userId: "c", kieu: "SYSTEM" }] }),
      buoi({ keHoach: [{ loai: "NGOAI_LE", ma: "TRUNG_VAI", role: "MAIN_TEACHER", userId: "d", chiTiet: "" }] }),
      buoi({ apDung: false, keHoach: [{ loai: "TAO", role: "MAIN_TEACHER", userId: "e", kieu: "SYSTEM" }] }),
    ];
    expect(xemTruocKhoiDong(ds)).toEqual({ soBuoi: 3, dungMain: 2, dungTa: 1, loiMoi: 3, ngoaiLe: 1 });
  });
});

describe("[P4B-NHAN] nhãn bằng chứng P4 — MỘT hàm cho QLCS và GV", () => {
  const vn = (h: string) => new Date(`2026-11-02T${h}:00+07:00`);
  const bc = (p: Partial<BangChungPhanCong>) =>
    ({ trangThai: "DU_BANG_CHUNG", checkInAt: vn("17:46"), checkOutAt: vn("19:35"), treVaoPhut: 0, raSomPhut: 0, ngoaiLe: [], canhBaoLuot: [], ...p }) as BangChungPhanCong;

  it("[P4B-NHAN-01] đủ bằng chứng ⇒ giờ vào/ra; đi muộn ⇒ số phút; ra sớm ⇒ số phút; không bao giờ nói 'được tính công'", () => {
    expect(nhanBangChung(bc({}))).toMatchObject({ nhan: "Vào 17:46 · ra 19:35", tone: "success" });
    expect(nhanBangChung(bc({ trangThai: "DI_MUON", treVaoPhut: 6 }))).toMatchObject({ nhan: "Đi muộn 6'", tone: "warning" });
    expect(nhanBangChung(bc({ trangThai: "RA_SOM", raSomPhut: 30, checkOutAt: vn("19:00") }))).toMatchObject({ nhan: "Ra sớm 30'" });
    for (const t of ["DU_BANG_CHUNG", "DI_MUON", "RA_SOM", "THIEU_RA", "DA_VAO", "SAI_NGUOI_DUNG_LOP", "KHONG_BANG_CHUNG"] as const) {
      const n = nhanBangChung(bc({ trangThai: t, treVaoPhut: 6, raSomPhut: 30 }))!;
      expect(`${n.nhan} ${n.chiTiet}`, t).not.toMatch(/được tính|\btiền\b/i);
      expect(n.chiTiet, t).toContain("chưa tính công");
    }
  });

  it("[P4B-NHAN-02] thiếu lượt ra / sai người đứng lớp / chưa chấm / ở cơ sở khác / có mặt ở buổi huỷ đều có chữ riêng; ngày cũ / chưa tới giờ ⇒ không hiện", () => {
    expect(nhanBangChung(bc({ trangThai: "THIEU_RA", checkOutAt: null }))!.nhan).toBe("Thiếu lượt ra");
    expect(nhanBangChung(bc({ trangThai: "SAI_NGUOI_DUNG_LOP" }))).toMatchObject({ nhan: "Sai người đứng lớp", tone: "danger" });
    expect(nhanBangChung(bc({ trangThai: "KHONG_BANG_CHUNG", checkInAt: null, checkOutAt: null }))!.nhan).toBe("Chưa chấm");
    expect(nhanBangChung(bc({ trangThai: "KHONG_BANG_CHUNG", ngoaiLe: ["PRESENT_AT_OTHER_CENTER"] }))!.nhan).toBe("Chấm công ở cơ sở khác");
    expect(nhanBangChung(bc({ trangThai: "BUOI_DA_HUY", ngoaiLe: ["SESSION_CANCELLED_WITH_ATTENDANCE"] }))!.nhan).toBe("Có mặt ở buổi đã huỷ");
    expect(nhanBangChung(bc({ trangThai: "BUOI_DA_HUY" }))).toBeNull();
    expect(nhanBangChung(bc({ trangThai: "KHONG_AP_DUNG" }))).toBeNull();
    expect(nhanBangChung(bc({ trangThai: "CHUA_DEN_GIO" }))).toBeNull();
  });

  it("[P4B-NHAN-03] cảnh báo thiết bị chỉ thêm vào câu chi tiết + hạ màu xuống 'info' — không thành 'không có bằng chứng'", () => {
    const n = nhanBangChung(bc({ canhBaoLuot: ["THIET_BI_CHUA_TIN_CAY"] }))!;
    expect(n.tone).toBe("info");
    expect(n.chiTiet).toContain("THIET_BI_CHUA_TIN_CAY");
    expect(n.nhan).toBe("Vào 17:46 · ra 19:35");
  });

  it("[P4B-CB-01] ngoại lệ cấp buổi P4 ⇒ cảnh báo có chữ trên dòng buổi", () => {
    expect(canhBaoTuBangChung([{ ma: "SESSION_COMPLETED_WITHOUT_CONFIRMED_MAIN" }, { ma: "TA_PRESENT_WITHOUT_ASSIGNMENT" }]).map((c) => [c.ma, c.muc])).toEqual([
      ["SESSION_COMPLETED_WITHOUT_CONFIRMED_MAIN", "danger"],
      ["TA_PRESENT_WITHOUT_ASSIGNMENT", "info"],
    ]);
  });
});

describe("[PT3B-TAB] chia tab Công việc của tôi", () => {
  const muc = (p: Partial<PhanCongCuaToi>): PhanCongCuaToi =>
    ({ ngay: "2026-11-02", status: "ACCEPTED", role: "MAIN_TEACHER", sourceType: "CLASS_SESSION", nguoiDungLop: null, ...p }) as PhanCongCuaToi;

  it("[PT3B-TAB-01] hôm nay / sắp tới / cần xác nhận / đã qua; 'đã qua' KHÔNG đòi COMPLETED (chưa đường nào đặt)", () => {
    const ds = [
      muc({ ngay: "2026-11-02", status: "WAITING_ACCEPTANCE" }),
      muc({ ngay: "2026-11-05", status: "ACCEPTED" }),
      muc({ ngay: "2026-11-06", status: "WAITING_ACCEPTANCE" }),
      muc({ ngay: "2026-10-30", status: "ACCEPTED" }),
    ];
    const t = chiaTab(ds, "2026-11-02", "me");
    expect(t["hom-nay"].length).toBe(1);
    expect(t["sap-toi"].map((x) => x.ngay)).toEqual(["2026-11-05"]);
    expect(t["can-xac-nhan"].map((x) => x.ngay)).toEqual(["2026-11-02", "2026-11-06"]);
    expect(t["da-qua"].map((x) => x.ngay)).toEqual(["2026-10-30"]);
  });

  it("[PT3B-TAB-02] đối soát: buổi lớp đã qua, mình đứng chính, người được quy công là người KHÁC", () => {
    const ds = [
      muc({ ngay: "2026-10-30", nguoiDungLop: { id: "khac", ten: "Khác" } }),
      muc({ ngay: "2026-10-29", nguoiDungLop: { id: "me", ten: "Bạn" } }),
      muc({ ngay: "2026-10-28", role: "TEACHING_ASSISTANT", nguoiDungLop: { id: "khac", ten: "Khác" } }),
      muc({ ngay: "2026-11-03", nguoiDungLop: { id: "khac", ten: "Khác" } }),
    ];
    expect(chiaTab(ds, "2026-11-02", "me")["doi-soat"].map((x) => x.ngay)).toEqual(["2026-10-30"]);
  });
});

describe("[PT3B-MD] mặc định + tình trạng buổi — MỘT hàm cho đồng bộ và màn hình", () => {
  const lop = (p: Partial<{ teacherId: string | null; assistantId: string | null; status: string; deletedAt: Date | null }> = {}) => ({
    teacherId: "gv",
    assistantId: "ta",
    status: "ACTIVE",
    deletedAt: null,
    ...p,
  });

  it("[PT3B-MD-01] buổi có người dạy thay ⇒ MAIN mặc định là người thay, kiểu SUBSTITUTE", () => {
    expect(macDinhCuaBuoi({ sourceType: "CLASS_SESSION", trangThai: "SCHEDULED", substituteTeacherId: "thay", lop: lop() })).toMatchObject({
      macDinhMainId: "thay",
      macDinhMainKieu: "SUBSTITUTE",
      macDinhTaId: "ta",
      tinhTrang: "MO",
    });
  });

  it("[PT3B-MD-02] lớp đã huỷ / xoá mềm ⇒ buổi SCHEDULED vẫn là ĐÃ ĐÓNG; buổi đã chốt thì đóng băng", () => {
    expect(macDinhCuaBuoi({ sourceType: "CLASS_SESSION", trangThai: "SCHEDULED", substituteTeacherId: null, lop: lop({ status: "CANCELLED" }) })).toMatchObject({ tinhTrang: "DA_DONG", lyDoDong: "Lớp đã huỷ" });
    expect(macDinhCuaBuoi({ sourceType: "CLASS_SESSION", trangThai: "SCHEDULED", substituteTeacherId: null, lop: lop({ deletedAt: new Date(0) }) })).toMatchObject({ tinhTrang: "DA_DONG", lyDoDong: "Lớp đã bị xoá" });
    expect(macDinhCuaBuoi({ sourceType: "CLASS_SESSION", trangThai: "COMPLETED", substituteTeacherId: null, lop: lop({ status: "CANCELLED" }) }).tinhTrang).toBe("DA_CHOT");
  });

  it("[PT3B-MD-03] học bù: không TA mặc định; trial: lớp huỷ + buổi SCHEDULED ⇒ đóng", () => {
    expect(macDinhCuaBuoi({ sourceType: "MAKEUP_CASE", trangThai: "SCHEDULED", teacherId: "gv" })).toMatchObject({ macDinhMainId: "gv", macDinhTaId: null, tinhTrang: "MO" });
    const lopTrial = { teacherId: "gv", assistantId: "ta", status: "CANCELLED" };
    expect(macDinhCuaBuoi({ sourceType: "TRIAL_SESSION", trangThai: "SCHEDULED", teacherId: null, lopTrial })).toMatchObject({ macDinhMainId: "gv", tinhTrang: "DA_DONG" });
    expect(macDinhCuaBuoi({ sourceType: "TRIAL_SESSION", trangThai: "COMPLETED", teacherId: "x", lopTrial }).tinhTrang).toBe("DA_CHOT");
  });
});

describe("[P4B-PREP] nhãn khi chỉ có mặt giờ chuẩn bị (chốt 24/10/2026)", () => {
  const vn = (h: string) => new Date(`2026-11-02T${h}:00+07:00`);
  const bc = (p: Partial<BangChungPhanCong>) =>
    ({ trangThai: "DU_BANG_CHUNG", checkInAt: vn("17:03"), checkOutAt: vn("19:20"), treVaoPhut: 0, raSomPhut: null, ngoaiLe: [], canhBaoLuot: [], ...p }) as BangChungPhanCong;

  it("[P4B-PREP-01] CHI_CHUAN_BI ⇒ chữ riêng, tone danger, nói rõ CHƯA đủ bằng chứng đã dạy — không phải 'Ra sớm', không phải 'Chưa chấm'", () => {
    const n = nhanBangChung(bc({ trangThai: "CHI_CHUAN_BI", ngoaiLe: ["INSUFFICIENT_TEACHING_ATTENDANCE"] }))!;
    expect(n).toMatchObject({ nhan: "Chỉ có mặt giờ chuẩn bị", tone: "danger" });
    expect(n.chiTiet).toContain("17:03");
    expect(n.chiTiet).toContain("19:20");
    expect(n.chiTiet).toContain("chưa đủ bằng chứng đã dạy");
    expect(n.chiTiet).toContain("chưa tính công");
  });
});
