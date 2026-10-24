// [NPC-*] — nhập phân công GV từ Excel: đọc sheet NHAP_PHAN_CONG + xét từng dòng (thuần). Mốc tuyệt đối (luật 19).
// Bất biến lấy từ sheet CHECKLIST của file mẫu chủ dự án (24/10/2026).
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { COT, docSheetNhap, xetDongNhap, xetFileNhap, type DongNhap, type NguCanhNhap } from "./nhap-phan-cong";

const HOM_NAY = "2026-11-02";
const ngu = (p: Partial<NguCanhNhap> = {}): NguCanhNhap => ({
  homNay: HOM_NAY,
  coSoTheoMa: new Map([["CS2", "cs2"], ["CS1", "cs1"]]),
  coSoDuocPhan: new Set(["cs2"]),
  coSoDaBat: new Set(["cs2", "cs1"]),
  gvTheoMa: new Map([["GV001", { userId: "u1", coSoCuaGv: ["cs1"] }], ["GV002", { userId: "u2", coSoCuaGv: ["cs2"] }]]),
  buoi: new Map([["S1", { centerId: "cs2", ngay: "2026-11-05", gioBatDau: "14:00", gioKetThuc: "15:30", sourceType: "CLASS_SESSION" }]]),
  maCa: new Set(["S", "C", "T"]),
  trucSong: new Map(),
  taSong: new Set(),
  kyDaKhoa: new Set(),
  ...p,
});
const dong = (p: Record<string, string>): DongNhap => ({ soDong: 5, ...Object.fromEntries(COT.map((c) => [c, ""])), ...p }) as DongNhap;

describe("[NPC-DOC] đọc sheet NHAP_PHAN_CONG", () => {
  const wb = (rows: (string | number)[][], ten = "NHAP_PHAN_CONG") => {
    const w = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([["tiêu đề"], ["ghi chú"], [], [...COT], ...rows]), ten);
    return XLSX.write(w, { type: "buffer", bookType: "xlsx" }) as Buffer;
  };
  it("[NPC-DOC-01] tiêu đề ở hàng 4, dữ liệu từ hàng 5; bỏ dòng trống; ngày Excel (số) ⇒ YYYY-MM-DD", () => {
    const r = docSheetNhap(wb([["K1", "GAN_TRUC", "CS2", 46331, "S", "GV002"], [], ["K2", "HUY_TRUC", "CS2", "2026-11-06", "C", "GV002"]]));
    expect(r.ok && r.dong.map((d) => [d.soDong, d.ImportKey, d.Ngay])).toEqual([
      [5, "K1", "2026-11-05"],
      [7, "K2", "2026-11-06"],
    ]);
  });
  it("[NPC-DOC-02] thiếu sheet NHAP_PHAN_CONG / sai cột tiêu đề ⇒ báo lỗi, không đoán", () => {
    expect(docSheetNhap(wb([], "Sheet1"))).toMatchObject({ ok: false });
    const w = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([[], [], [], ["ImportKey", "SaiCot"]]), "NHAP_PHAN_CONG");
    expect(docSheetNhap(XLSX.write(w, { type: "buffer", bookType: "xlsx" }) as Buffer)).toMatchObject({ ok: false });
  });
});

describe("[NPC-XET] xét từng dòng — bất biến CHECKLIST", () => {
  it("[NPC-01] GAN_TRUC hợp lệ ⇒ THEM, kèm kế hoạch giao trực đúng người · ngày · ca · cơ sở", () => {
    expect(xetDongNhap(dong({ ImportKey: "K1", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV002", VaiTro: "OPS", Truc_YN: "YES" }), ngu())).toEqual({
      soDong: 5,
      importKey: "K1",
      ketQua: "THEM",
      ma: null,
      thongDiep: expect.any(String),
      keHoach: { loai: "GAN_TRUC", userId: "u2", centerId: "cs2", ngay: "2026-11-05", shiftCode: "S" },
    });
  });
  it("[NPC-02] 01 CROSS_CENTER_RBAC — cơ sở không có quyền ⇒ LỖI", () => {
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS1", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV001" }), ngu())).toMatchObject({ ketQua: "LOI", ma: "CROSS_CENTER_RBAC" });
  });
  it("[NPC-03] GV mượn từ cơ sở khác (CS1 → trực ở CS2) ⇒ được, nhưng ghi rõ là mượn", () => {
    const r = xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "T", MaGV: "GV001" }), ngu());
    expect(r).toMatchObject({ ketQua: "THEM" });
    expect(r.thongDiep).toMatch(/mượn/);
  });
  it("[NPC-04] 06 chạy lại — trực đã có ⇒ KHONG_DOI; huỷ trực không có ⇒ KHONG_DOI", () => {
    const c = ngu({ trucSong: new Map([["u2|2026-11-05|S", { id: "d1", centerId: "cs2" }]]) });
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV002" }), c)).toMatchObject({ ketQua: "KHONG_DOI", ma: "DUPLICATE_ASSIGNMENT", keHoach: null });
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "HUY_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-06", Ca_SCT: "S", MaGV: "GV002", LyDo: "không trực nữa" }), c)).toMatchObject({ ketQua: "KHONG_DOI" });
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "HUY_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV002", LyDo: "không trực nữa" }), c)).toMatchObject({
      ketQua: "HUY",
      keHoach: { loai: "HUY_TRUC", dutyId: "d1" },
    });
  });
  it("[NPC-05] 03 SESSION_NOT_FOUND — PHAN_CONG_TA không có / sai buổi ⇒ LỖI; buổi khác cơ sở ⇒ LỖI", () => {
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "PHAN_CONG_TA", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "C", MaGV: "GV002", SessionId: "KHONG" }), ngu())).toMatchObject({ ma: "SESSION_NOT_FOUND" });
    const c = ngu({ buoi: new Map([["S1", { centerId: "cs1", ngay: "2026-11-05", gioBatDau: "14:00", gioKetThuc: "15:30", sourceType: "CLASS_SESSION" }]]) });
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "PHAN_CONG_TA", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "C", MaGV: "GV002", SessionId: "S1" }), c)).toMatchObject({ ma: "SESSION_NOT_FOUND" });
  });
  it("[NPC-06] PHAN_CONG_TA hợp lệ ⇒ THEM; đã là TA của buổi ⇒ KHONG_DOI", () => {
    const d0 = dong({ ImportKey: "K", ThaoTac: "PHAN_CONG_TA", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "C", MaGV: "GV002", SessionId: "S1" });
    expect(xetDongNhap(d0, ngu())).toMatchObject({ ketQua: "THEM", keHoach: { loai: "PHAN_CONG_TA", userId: "u2", sourceType: "CLASS_SESSION", sourceId: "S1" } });
    expect(xetDongNhap(d0, ngu({ taSong: new Set(["S1|u2"]) }))).toMatchObject({ ketQua: "KHONG_DOI" });
  });
  it("[NPC-07] 07 APPROVAL_REQUIRED — DE_NGHI_DAY_THAY không ghi gì, chuyển sang luồng đơn dạy thay", () => {
    const r = xetDongNhap(dong({ ImportKey: "K", ThaoTac: "DE_NGHI_DAY_THAY", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "C", MaGV: "GV002", SessionId: "S1", GVThayThe_Ma: "GV001", LyDo: "GV chính có đơn nghỉ" }), ngu());
    expect(r).toMatchObject({ ketQua: "CAN_DUYET", ma: "APPROVAL_REQUIRED", keHoach: null });
  });
  it("[NPC-08] 08 lịch quá khứ: thiếu lý do ⇒ LỖI; kỳ công khoá ⇒ CLOSED_PERIOD_MUTATION", () => {
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-10-30", Ca_SCT: "S", MaGV: "GV002" }), ngu())).toMatchObject({ ketQua: "LOI", ma: "PAST_REASON_REQUIRED" });
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-10-30", Ca_SCT: "S", MaGV: "GV002", LyDo: "bổ sung trực đã làm" }), ngu({ kyDaKhoa: new Set(["cs2|2026-10"]) }))).toMatchObject({
      ma: "CLOSED_PERIOD_MUTATION",
    });
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-10-30", Ca_SCT: "S", MaGV: "GV002", LyDo: "bổ sung trực đã làm" }), ngu())).toMatchObject({ ketQua: "THEM" });
  });
  it("[NPC-09] 04 NO_EXPLICIT_DUTY — GAN_TRUC mà Truc_YN = NO / vai không phải OPS ⇒ LỖI (không suy trực từ mã)", () => {
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV002", Truc_YN: "NO" }), ngu())).toMatchObject({ ma: "NO_EXPLICIT_DUTY" });
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV002", VaiTro: "MAIN" }), ngu())).toMatchObject({ ma: "NO_EXPLICIT_DUTY" });
  });
  it("[NPC-10] 02 / 05 / 11 — thao tác ngoài danh mục ⇒ LỖI đúng mã CHECKLIST (Trial/học bù · Rank/chứng nhận · tiền), không ghi", () => {
    const ma = (t: string) => xetDongNhap(dong({ ImportKey: "K", ThaoTac: t, CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV002" }), ngu());
    expect(ma("TAO_TRIAL")).toMatchObject({ ketQua: "LOI", ma: "DUPLICATE_SOURCE_OF_TRUTH", keHoach: null });
    expect(ma("BOOK_HOC_BU")).toMatchObject({ ketQua: "LOI", ma: "DUPLICATE_SOURCE_OF_TRUTH" });
    expect(ma("DOI_RANK")).toMatchObject({ ketQua: "LOI", ma: "FORBIDDEN_POLICY_WRITE" });
    expect(ma("CAP_CHUNG_NHAN_TRIAL")).toMatchObject({ ketQua: "LOI", ma: "FORBIDDEN_POLICY_WRITE" });
    expect(ma("NHAP_TIEN")).toMatchObject({ ketQua: "LOI", ma: "IMPORTED_PAY_AMOUNT" });
    expect(ma("LAM_GI_DO")).toMatchObject({ ketQua: "LOI", ma: "THAO_TAC_KHONG_HO_TRO" });
  });
  it("[NPC-11] mã GV lạ / mã ca lạ / ngày sai / thiếu ImportKey ⇒ LỖI có mã riêng", () => {
    const g = { ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV002" };
    expect(xetDongNhap(dong({ ...g, MaGV: "GV999" }), ngu())).toMatchObject({ ma: "EMPLOYEE_NOT_FOUND" });
    expect(xetDongNhap(dong({ ...g, Ca_SCT: "X" }), ngu())).toMatchObject({ ma: "INVALID_SHIFT" });
    expect(xetDongNhap(dong({ ...g, Ngay: "05/11" }), ngu())).toMatchObject({ ma: "INVALID_DATE" });
    expect(xetDongNhap(dong({ ...g, ImportKey: "" }), ngu())).toMatchObject({ ma: "IMPORT_KEY_REQUIRED" });
  });
  it("[NPC-12] DIEU_CHINH_QUA_KHU: ngày tương lai ⇒ LỖI; quá khứ có lý do ⇒ CAN_DUYET, không ghi", () => {
    const g = { ImportKey: "K", ThaoTac: "DIEU_CHINH_QUA_KHU", CoSoSuDung: "CS2", Ca_SCT: "S", MaGV: "GV002", LyDo: "trực thực tế khác lịch" };
    expect(xetDongNhap(dong({ ...g, Ngay: "2026-11-05" }), ngu())).toMatchObject({ ketQua: "LOI", ma: "NOT_PAST_DATE" });
    expect(xetDongNhap(dong({ ...g, Ngay: "2026-10-30" }), ngu())).toMatchObject({ ketQua: "CAN_DUYET", ma: "APPROVAL_REQUIRED", keHoach: null });
  });
  it("[NPC-13] HUY_TRUC thiếu lý do ⇒ LỖI REASON_REQUIRED", () => {
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "HUY_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV002" }), ngu())).toMatchObject({ ma: "REASON_REQUIRED" });
  });
  it("[NPC-14] tra GV theo email khi trống MaGV", () => {
    const c = ngu({ gvTheoMa: new Map([["gv2@x.vn", { userId: "u2", coSoCuaGv: ["cs2"] }]]) });
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", EmailThamChieu: "GV2@x.vn" }), c)).toMatchObject({ ketQua: "THEM" });
  });
  it("[NPC-15] 10 CROSS_CENTER_OVERLAP — GV đã trực cùng ca ở cơ sở khác ⇒ LỖI; huỷ trực của cơ sở khác ⇒ LỖI", () => {
    const c = ngu({ trucSong: new Map([["u1|2026-11-05|T", { id: "d9", centerId: "cs1" }]]) });
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "T", MaGV: "GV001" }), c)).toMatchObject({ ketQua: "LOI", ma: "CROSS_CENTER_OVERLAP" });
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "HUY_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "T", MaGV: "GV001", LyDo: "đổi người trực" }), c)).toMatchObject({ ketQua: "LOI", ma: "CROSS_CENTER_RBAC" });
  });
  it("[NPC-16] lý do dưới 5 ký tự coi như không có", () => {
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-10-30", Ca_SCT: "S", MaGV: "GV002", LyDo: " ok " }), ngu())).toMatchObject({ ma: "PAST_REASON_REQUIRED" });
  });
  it("[NPC-17] công tắc STAFFING tắt ở cơ sở ⇒ LỖI STAFFING_OFF", () => {
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV002" }), ngu({ coSoDaBat: new Set() }))).toMatchObject({ ma: "STAFFING_OFF" });
  });
  it("[NPC-18] PHAN_CONG_TA: buổi đã qua ⇒ PAST_SESSION; GV ngoài phạm vi ⇒ NOT_TEACHER_IN_SCOPE; GV cơ sở mình quản lý (mượn) ⇒ được", () => {
    const buoiCu = new Map([["S0", { centerId: "cs2", ngay: "2026-10-30", gioBatDau: "14:00", gioKetThuc: "15:30", sourceType: "CLASS_SESSION" }]]);
    expect(xetDongNhap(dong({ ImportKey: "K", ThaoTac: "PHAN_CONG_TA", CoSoSuDung: "CS2", Ngay: "2026-10-30", Ca_SCT: "C", MaGV: "GV002", SessionId: "S0", LyDo: "bổ sung trợ giảng" }), ngu({ buoi: buoiCu }))).toMatchObject({ ma: "PAST_SESSION" });
    const d0 = dong({ ImportKey: "K", ThaoTac: "PHAN_CONG_TA", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "C", MaGV: "GV001", SessionId: "S1" });
    expect(xetDongNhap(d0, ngu())).toMatchObject({ ketQua: "LOI", ma: "NOT_TEACHER_IN_SCOPE" });
    expect(xetDongNhap(d0, ngu({ coSoDuocPhan: new Set(["cs2", "cs1"]) }))).toMatchObject({ ketQua: "THEM" });
  });
});

describe("[NPC-FILE] xét cả file", () => {
  const g = { ThaoTac: "GAN_TRUC", CoSoSuDung: "CS2", Ngay: "2026-11-05", Ca_SCT: "S", MaGV: "GV002" };
  it("[NPC-F01] ImportKey trùng trong file ⇒ mọi dòng mang khoá đó đều LỖI (không đoán dòng nào thắng)", () => {
    const r = xetFileNhap([dong({ ...g, ImportKey: "K1" }), { ...dong({ ...g, ImportKey: "K1", Ca_SCT: "C" }), soDong: 6 }], ngu());
    expect(r.map((x) => [x.soDong, x.ma])).toEqual([[5, "DUPLICATE_IMPORT_KEY"], [6, "DUPLICATE_IMPORT_KEY"]]);
  });
  it("[NPC-F02] hai khoá khác nhau cùng giao một ô trực ⇒ dòng sau KHONG_DOI (DUPLICATE_ASSIGNMENT), chỉ một lệnh ghi", () => {
    const r = xetFileNhap([dong({ ...g, ImportKey: "K1" }), { ...dong({ ...g, ImportKey: "K2" }), soDong: 6 }], ngu());
    expect(r.map((x) => [x.ketQua, x.ma])).toEqual([["THEM", null], ["KHONG_DOI", "DUPLICATE_ASSIGNMENT"]]);
  });
});
