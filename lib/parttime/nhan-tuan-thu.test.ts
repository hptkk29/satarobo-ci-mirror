// [NTT-*] — nhãn hồ sơ buổi + lối tắt tới màn điểm danh / nhận xét đã có (thuần). Mốc tuyệt đối (luật 19).
import { describe, expect, it } from "vitest";
import type { BangChungPhanCong } from "./bang-chung-cong";
import { canhBaoTuTuanThu } from "./control-tower";
import { duongHoSo, nhanTuanThu } from "./nhan-tuan-thu";
import { danhGiaTuanThu, type DauVaoTuanThu } from "./tuan-thu-buoi";

const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const NGAY = "2026-11-02";
const HV = ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9"];
const bc = (p: Partial<BangChungPhanCong> = {}): BangChungPhanCong => ({
  assignmentId: "pc-1", assignmentVersion: 1, userId: "gv", role: "MAIN_TEACHER", activity: "REGULAR_CLASS", sourceType: "CLASS_SESSION", sourceId: "s-1",
  centerId: "cs2", workDate: NGAY, requiredFrom: vn(NGAY, "17:50"), requiredTo: vn(NGAY, "19:30"), trangThai: "DU_BANG_CHUNG", coMat: "DU", treVaoPhut: 0,
  diMuon: false, raSomPhut: 0, raSom: false, khopNguoiDay: "KHOP", daNhan: true, graceCutover: false, checkInAt: vn(NGAY, "17:48"), checkOutAt: vn(NGAY, "19:35"),
  canhBaoLuot: [], ngoaiLe: [], dongDoi: { attendanceInId: "i", attendanceOutId: "o", nguoiDayId: "gv", nguonNguoiDay: "class.teacherId", tinhTrangBuoi: "DA_CHOT", chinhSach: "SR_QD_238" },
  dauVan: "x", ...p,
});
const tt = (p: Partial<DauVaoTuanThu> = {}) =>
  danhGiaTuanThu({
    bc: bc(), trangThaiPhanCong: "ACCEPTED", daNhanPhienBanCu: false, batDau: vn(NGAY, "18:00"), ketThuc: vn(NGAY, "19:30"),
    hocVien: { siSo: HV, daDiemDanh: HV, coMat: HV, nhanXet: HV.slice(0, 7).map((studentId) => ({ studentId, createdAt: vn(NGAY, "20:30"), tacGia: "gv" })) },
    now: vn(NGAY, "19:40"), ...p,
  });

describe("[NTT] hồ sơ buổi — nhãn + lối tắt", () => {
  it("[NTT-01] đủ 5 bước theo đúng thứ tự BLĐ; 9/9 điểm danh ✓, nhận xét 7/9 còn thiếu 2, tổng 'đang làm' (còn trong hạn)", () => {
    const n = nhanTuanThu(tt());
    expect(n.buoc.map((b) => b.ma)).toEqual(["NHAN_LOP", "CHAM_VAO", "DIEM_DANH", "CHAM_RA", "NHAN_XET"]);
    expect(n.buoc.map((b) => b.nhan)).toEqual(["Đã gán lớp", "Chấm vào 17:48", "Điểm danh 9/9", "Chấm ra 19:35", "Nhận xét 7/9"]);
    expect(n.buoc.find((b) => b.ma === "DIEM_DANH")).toMatchObject({ xong: true, tone: "success" });
    expect(n.buoc.find((b) => b.ma === "NHAN_XET")).toMatchObject({ xong: false, conThieu: 2 });
    expect(n.tong).toEqual({ nhan: "Hồ sơ buổi đang làm", tone: "warning" });
  });

  it("[NTT-02] chưa điểm danh ai: nhận xét 'chờ điểm danh' và KHÔNG có lối tắt nhận xét (choBuocTruoc)", () => {
    const n = nhanTuanThu(tt({ hocVien: { siSo: HV, daDiemDanh: [], coMat: [], nhanXet: [] }, now: vn(NGAY, "18:30"), bc: bc({ trangThai: "DA_VAO", checkOutAt: null }) }));
    expect(n.buoc.find((b) => b.ma === "DIEM_DANH")).toMatchObject({ nhan: "Điểm danh 0/9", xong: false, conThieu: 9 });
    expect(n.buoc.find((b) => b.ma === "NHAN_XET")).toMatchObject({ choBuocTruoc: true, xong: false });
  });

  it("[NTT-03] quá hạn ⇒ 'Hồ sơ buổi chưa hoàn tất' + câu vấn đề; KHÔNG chữ nào nói tiền / phạt / trừ", () => {
    const n = nhanTuanThu(tt({ now: vn("2026-11-03", "11:00") }));
    expect(n.tong).toEqual({ nhan: "Hồ sơ buổi chưa hoàn tất", tone: "danger" });
    expect(n.vanDe).toContain("Quá hạn nhận xét (10:00 hôm sau)");
    expect(JSON.stringify(n)).not.toMatch(/tiền|phạt|trừ|\d{1,3}\.\d{3}\s?đ/i);
  });

  it("[NTT-04] lối tắt: lớp mình ⇒ hub lớp; DẠY THAY ⇒ màn Dạy thay theo buổi; học bù ⇒ case; admin ⇒ màn điểm danh admin", () => {
    const lop = { loai: "LOP" as const, sessionId: "s 1", classId: "c1", dayThay: false };
    expect(duongHoSo(lop, "GIAO_VIEN", "diem-danh")).toBe("/teacher/lop?classId=c1&sessionId=s%201");
    expect(duongHoSo(lop, "GIAO_VIEN", "nhan-xet")).toBe("/teacher/lop?classId=c1&tab=nhan-xet&rvSession=s%201");
    expect(duongHoSo({ ...lop, dayThay: true }, "GIAO_VIEN", "diem-danh")).toBe("/teacher/day-thay/s%201?tab=diem-danh");
    expect(duongHoSo({ loai: "BU", caseId: "k1" }, "GIAO_VIEN", "nhan-xet")).toBe("/teacher/hoc-bu/k1");
    expect(duongHoSo(lop, "ADMIN", "diem-danh")).toBe("/attendance?sessionId=s%201");
    expect(duongHoSo({ loai: "BU", caseId: "k1" }, "ADMIN", "diem-danh")).toBe("/hoc-bu/case/k1");
  });

  it("[NTT-05] Control Tower: vấn đề HỌC VIÊN thành cảnh báo; vấn đề phía GV (đã có chip chấm công P4) KHÔNG lặp lại", () => {
    const quaHan = canhBaoTuTuanThu(tt({ now: vn("2026-11-03", "11:00"), bc: bc({ ngoaiLe: ["MISSING_CHECKOUT"] }) }));
    expect(quaHan.map((c) => c.ma)).toEqual(["STUDENT_COMMENTS_OVERDUE"]);
    expect(quaHan[0]).toMatchObject({ nhan: "Quá hạn nhận xét học viên", muc: "danger" });
    const chuaDiem = canhBaoTuTuanThu(tt({ hocVien: { siSo: HV, daDiemDanh: [], coMat: [], nhanXet: [] } }));
    expect(chuaDiem.map((c) => c.ma)).toEqual(["STUDENT_ATTENDANCE_NOT_STARTED"]);
    expect(canhBaoTuTuanThu(null)).toEqual([]);
  });
});
