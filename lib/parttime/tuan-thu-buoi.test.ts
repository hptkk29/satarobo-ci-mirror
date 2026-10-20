// [TT-*] — tuân thủ buổi dạy (thuần). Mốc thời gian tuyệt đối, `now` luôn truyền (luật 19).
import { describe, expect, it } from "vitest";
import type { BangChungPhanCong } from "./bang-chung-cong";
import { danhGiaTuanThu, doDayDuDiemDanh, tiLeTuanThu, type DauVaoTuanThu, type HocVienCuaBuoi } from "./tuan-thu-buoi";

const vn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const NGAY = "2026-11-02";
const GV = "gv-a";
const HV = ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h9"];

function bc(p: Partial<BangChungPhanCong> = {}): BangChungPhanCong {
  return {
    assignmentId: "pc-1",
    assignmentVersion: 1,
    userId: GV,
    role: "MAIN_TEACHER",
    activity: "REGULAR_CLASS",
    sourceType: "CLASS_SESSION",
    sourceId: "s-1",
    centerId: "cs2",
    workDate: NGAY,
    requiredFrom: vn(NGAY, "17:50"),
    requiredTo: vn(NGAY, "19:30"),
    trangThai: "DU_BANG_CHUNG",
    coMat: "DU",
    treVaoPhut: 0,
    diMuon: false,
    raSomPhut: 0,
    raSom: false,
    khopNguoiDay: "KHOP",
    daNhan: true,
    graceCutover: false,
    checkInAt: vn(NGAY, "17:48"),
    checkOutAt: vn(NGAY, "19:35"),
    canhBaoLuot: [],
    ngoaiLe: [],
    dongDoi: { attendanceInId: "i", attendanceOutId: "o", nguoiDayId: GV, nguonNguoiDay: "class.teacherId", tinhTrangBuoi: "DA_CHOT", chinhSach: "SR_QD_238" },
    dauVan: "x",
    ...p,
  };
}

const nx = (ids: readonly string[], luc: Date, tacGia: string | null = GV) => ids.map((studentId) => ({ studentId, createdAt: luc, tacGia }));
function hv(p: Partial<HocVienCuaBuoi> = {}): HocVienCuaBuoi {
  return { siSo: HV, daDiemDanh: HV, coMat: HV, nhanXet: nx(HV, vn(NGAY, "20:30")), ...p };
}
function vao(p: Partial<DauVaoTuanThu> = {}): DauVaoTuanThu {
  return { bc: bc(), trangThaiPhanCong: "ACCEPTED", daNhanPhienBanCu: false, batDau: vn(NGAY, "18:00"), ketThuc: vn(NGAY, "19:30"), hocVien: hv(), now: vn("2026-11-03", "11:00"), ...p };
}

describe("[TT] tuân thủ buổi dạy", () => {
  it("[TT-01] chấm vào → điểm danh 9/9 → chấm ra → nhận xét 9/9 trước hạn ⇒ COMPLETE, không vấn đề", () => {
    const t = danhGiaTuanThu(vao());
    expect(t).toMatchObject({
      assignmentStatus: "VALID",
      acceptanceStatus: "ACCEPTED",
      teacherAttendanceStatus: "TEACHER_ATTENDANCE_OK",
      checkoutStatus: "DONE",
      actualTeacherStatus: "MATCH",
      studentAttendanceStatus: "COMPLETE",
      studentAttendanceExpected: 9,
      studentAttendanceRecorded: 9,
      studentAttendanceCompletionPercent: 100,
      studentCommentStatus: "COMPLETE",
      studentCommentsExpected: 9,
      studentCommentsCompleted: 9,
      overallStatus: "COMPLETE",
      issues: [],
    });
  });

  it("[TT-02] điểm danh 8/9 ⇒ PARTIAL (KHÔNG phải COMPLETE), 88 %, tổng NEEDS_REVIEW sau giờ", () => {
    const t = danhGiaTuanThu(vao({ hocVien: hv({ daDiemDanh: HV.slice(0, 8), coMat: HV.slice(0, 8), nhanXet: nx(HV.slice(0, 8), vn(NGAY, "20:30")) }) }));
    expect(t.studentAttendanceStatus).toBe("PARTIAL");
    expect(t.studentAttendanceRecorded).toBe(8);
    expect(t.studentAttendanceCompletionPercent).toBe(88);
    expect(t.overallStatus).toBe("NEEDS_REVIEW");
    expect(t.issues).toContain("STUDENT_ATTENDANCE_PARTIAL");
  });

  it("[TT-03] vắng / vắng có phép đã GHI vẫn là đã điểm danh: 7 có mặt + 1 vắng + 1 có phép = 9/9 ĐỦ; nhận xét chỉ cần 7", () => {
    const t = danhGiaTuanThu(vao({ hocVien: hv({ coMat: HV.slice(0, 7), nhanXet: nx(HV.slice(0, 7), vn(NGAY, "20:30")) }) }));
    expect(t.studentAttendanceStatus).toBe("COMPLETE");
    expect(t.studentAttendanceExpected).toBe(9);
    expect(t.studentCommentsExpected).toBe(7);
    expect(t.overallStatus).toBe("COMPLETE");
  });

  it("[TT-04] dòng trùng / người ngoài sĩ số KHÔNG cộng: 8 người + dòng trùng + 1 người lạ ≠ đủ", () => {
    const r = doDayDuDiemDanh(HV, [...HV.slice(0, 8), "h1", "nguoi-la"]);
    expect(r).toEqual({ trangThai: "PARTIAL", can: 9, daCo: 8 });
    expect(doDayDuDiemDanh(HV, [])).toEqual({ trangThai: "NOT_STARTED", can: 9, daCo: 0 });
    expect(doDayDuDiemDanh([], ["h1"])).toEqual({ trangThai: "NOT_REQUIRED", can: 0, daCo: 0 });
  });

  it("[TT-05] buổi HUỶ ⇒ điểm danh + nhận xét NOT_REQUIRED, tổng CANCELLED, không vấn đề", () => {
    const t = danhGiaTuanThu(vao({ bc: bc({ trangThai: "BUOI_DA_HUY", ngoaiLe: [] }), hocVien: hv({ daDiemDanh: [], coMat: [], nhanXet: [] }) }));
    expect(t).toMatchObject({ assignmentStatus: "CANCELLED", studentAttendanceStatus: "NOT_REQUIRED", studentCommentStatus: "NOT_REQUIRED", checkoutStatus: "NOT_REQUIRED", overallStatus: "CANCELLED", issues: [] });
    // Phân công bị huỷ / bị thay (GV dạy thay đã nhận nghĩa vụ) — người cũ không còn nghĩa vụ.
    for (const s of ["CANCELLED", "REPLACED"] as const) {
      const x = danhGiaTuanThu(vao({ trangThaiPhanCong: s, hocVien: hv({ daDiemDanh: [], coMat: [], nhanXet: [] }) }));
      expect(x.overallStatus).toBe("CANCELLED");
      expect(x.studentAttendanceStatus).toBe("NOT_REQUIRED");
    }
  });

  it("[TT-06] nhận xét 7/9 trước hạn ⇒ PARTIAL; sau giờ dạy tổng IN_PROGRESS (chưa tới hạn), có vấn đề PARTIAL", () => {
    const t = danhGiaTuanThu(vao({ hocVien: hv({ nhanXet: nx(HV.slice(0, 7), vn(NGAY, "20:30")) }), now: vn("2026-11-03", "08:00") }));
    expect(t.studentCommentStatus).toBe("PARTIAL");
    expect(t.studentCommentsCompleted).toBe(7);
    expect(t.studentCommentCompletionPercent).toBe(77);
    expect(t.overallStatus).toBe("IN_PROGRESS");
    expect(t.issues).toEqual(["STUDENT_COMMENTS_PARTIAL"]);
  });

  it("[TT-07] hạn 10:00:00 hôm sau là ĐÚNG HẠN; 10:01 là TRỄ (LATE_COMPLETE, 1 phút) — không bao giờ coi như đúng hạn", () => {
    const dung = danhGiaTuanThu(vao({ hocVien: hv({ nhanXet: nx(HV, vn("2026-11-03", "10:00")) }) }));
    expect(dung.studentCommentStatus).toBe("COMPLETE");
    expect(dung.commentDeadline?.toISOString()).toBe(vn("2026-11-03", "10:00").toISOString());
    const tre = danhGiaTuanThu(vao({ hocVien: hv({ nhanXet: nx(HV, vn("2026-11-03", "10:01")) }) }));
    expect(tre.studentCommentStatus).toBe("LATE_COMPLETE");
    expect(tre.commentsLateByMinutes).toBe(1);
    expect(tre.overallStatus).toBe("NEEDS_REVIEW");
    expect(tre.issues).toContain("STUDENT_COMMENTS_LATE");
  });

  it("[TT-08] 0/9 nhận xét sau hạn ⇒ OVERDUE; 9/9 trước hạn khác 0/9 trước hạn (NOT_STARTED)", () => {
    expect(danhGiaTuanThu(vao({ hocVien: hv({ nhanXet: [] }) })).studentCommentStatus).toBe("OVERDUE");
    const truoc = danhGiaTuanThu(vao({ hocVien: hv({ nhanXet: [] }), now: vn(NGAY, "20:00") }));
    expect(truoc.studentCommentStatus).toBe("NOT_STARTED");
    expect(truoc.issues).toEqual(["STUDENT_COMMENTS_NOT_STARTED"]);
  });

  it("[TT-09] trợ giảng KHÔNG chịu điểm danh / nhận xét (cổng ghi chặn TA) — tổng COMPLETE khi chấm công đủ", () => {
    // Buổi có ĐỦ điểm danh (GV chính ghi), 9 học viên có mặt, CHƯA ai nhận xét, đã quá hạn — nếu TA chịu nghĩa vụ thì phải ra OVERDUE.
    const t = danhGiaTuanThu(vao({ bc: bc({ role: "TEACHING_ASSISTANT", userId: "ta" }), hocVien: hv({ nhanXet: [] }) }));
    expect(t.studentAttendanceStatus).toBe("NOT_REQUIRED");
    expect(t.studentCommentStatus).toBe("NOT_REQUIRED");
    expect(t.overallStatus).toBe("COMPLETE");
  });

  it("[TT-10] nhận xét do NGƯỜI KHÁC viết không tính; báo vấn đề, tổng NEEDS_REVIEW", () => {
    const t = danhGiaTuanThu(vao({ hocVien: hv({ nhanXet: [...nx(HV.slice(0, 8), vn(NGAY, "20:30")), ...nx(["h9"], vn(NGAY, "20:30"), "gv-khac")] }) }));
    expect(t.studentCommentsCompleted).toBe(8);
    expect(t.studentCommentsOtherAuthor).toBe(1);
    expect(t.studentCommentStatus).toBe("OVERDUE");
    expect(t.issues).toContain("STUDENT_COMMENT_AUTHOR_MISMATCH");
  });

  it("[TT-11] một nhận xét CHUNG không phải nhận xét từng học viên: không có dòng học viên ⇒ không hoàn thành", () => {
    // Nguồn nhận xét chung (`ClassSession.classComment`) KHÔNG đi vào `nhanXet` — đầu vào chỉ có dòng theo học viên.
    const t = danhGiaTuanThu(vao({ hocVien: hv({ nhanXet: [] }), now: vn("2026-11-03", "08:00") }));
    expect(t.studentCommentsCompleted).toBe(0);
    expect(t.overallStatus).toBe("IN_PROGRESS");
  });

  it("[TT-12] chấm vào KHÔNG điểm danh hộ: GV đã vào lớp, 0 dòng điểm danh ⇒ NOT_STARTED; nhận xét CHỜ điểm danh", () => {
    const t = danhGiaTuanThu(vao({ bc: bc({ trangThai: "DA_VAO", checkOutAt: null }), hocVien: hv({ daDiemDanh: [], coMat: [], nhanXet: [] }), now: vn(NGAY, "18:30") }));
    expect(t.teacherAttendanceStatus).toBe("CHECKED_IN");
    expect(t.studentAttendanceStatus).toBe("NOT_STARTED");
    expect(t.studentAttendanceRecorded).toBe(0);
    expect(t.studentCommentStatus).toBe("WAITING_ATTENDANCE");
    expect(t.studentCommentsExpected).toBeNull();
    expect(t.checkoutStatus).toBe("NOT_YET");
    expect(t.overallStatus).toBe("IN_PROGRESS");
    expect(t.issues).toEqual([]); // trong giờ dạy: chưa "thiếu"
  });

  it("[TT-13] chấm ra xong, nhận xét thiếu sau hạn ⇒ NEEDS_REVIEW (sự thật dạy giữ nguyên ở WorkUnit — xem DB)", () => {
    const t = danhGiaTuanThu(vao({ hocVien: hv({ nhanXet: nx(HV.slice(0, 7), vn(NGAY, "20:30")) }) }));
    expect(t.checkoutStatus).toBe("DONE");
    expect(t.overallStatus).toBe("NEEDS_REVIEW");
    expect(t.issues).toEqual(["STUDENT_COMMENTS_OVERDUE"]);
  });

  it("[TT-14] phía GV dùng LẠI mã P4: thiếu ra / không chấm / sai người đứng lớp / chưa nhận ⇒ NEEDS_REVIEW", () => {
    const thieuRa = danhGiaTuanThu(vao({ bc: bc({ trangThai: "THIEU_RA", checkOutAt: null, ngoaiLe: ["MISSING_CHECKOUT"] }) }));
    expect(thieuRa).toMatchObject({ teacherAttendanceStatus: "MISSING_CHECKOUT", checkoutStatus: "MISSING", overallStatus: "NEEDS_REVIEW" });
    expect(thieuRa.issues).toContain("MISSING_CHECKOUT");
    const khong = danhGiaTuanThu(vao({ bc: bc({ trangThai: "KHONG_BANG_CHUNG", checkInAt: null, checkOutAt: null, ngoaiLe: ["ASSIGNED_NO_ATTENDANCE"] }) }));
    expect(khong.issues).toContain("ASSIGNED_NO_ATTENDANCE");
    const lech = danhGiaTuanThu(vao({ bc: bc({ trangThai: "SAI_NGUOI_DUNG_LOP", khopNguoiDay: "LECH", ngoaiLe: ["MAIN_ACTUAL_MISMATCH"] }) }));
    expect(lech).toMatchObject({ actualTeacherStatus: "MISMATCH", overallStatus: "NEEDS_REVIEW" });
    const chua = danhGiaTuanThu(vao({ bc: bc({ daNhan: false }), trangThaiPhanCong: "WAITING_ACCEPTANCE" }));
    expect(chua).toMatchObject({ acceptanceStatus: "PENDING", overallStatus: "NEEDS_REVIEW" });
  });

  it("[TT-15] nhận lớp: grace cutover được phép; phiên bản cũ ≠ chờ nhận; từ chối ⇒ không còn nghĩa vụ", () => {
    expect(danhGiaTuanThu(vao({ bc: bc({ daNhan: false, graceCutover: true }), trangThaiPhanCong: "WAITING_ACCEPTANCE" })).overallStatus).toBe("COMPLETE");
    expect(danhGiaTuanThu(vao({ bc: bc({ daNhan: false, assignmentVersion: 2 }), daNhanPhienBanCu: true, trangThaiPhanCong: "WAITING_ACCEPTANCE" })).acceptanceStatus).toBe("VERSION_STALE");
    expect(danhGiaTuanThu(vao({ bc: bc({ daNhan: false }), trangThaiPhanCong: "DECLINED" })).overallStatus).toBe("CANCELLED");
  });

  it("[TT-16] trước giờ: NOT_STARTED; ngày LEGACY ⇒ POLICY_NOT_APPLICABLE; trial (không dữ liệu học viên GV ghi được) ⇒ học viên NOT_REQUIRED", () => {
    const truoc = danhGiaTuanThu(vao({ bc: bc({ trangThai: "CHUA_DEN_GIO", checkInAt: null, checkOutAt: null }), hocVien: hv({ daDiemDanh: [], coMat: [], nhanXet: [] }), now: vn(NGAY, "12:00") }));
    expect(truoc).toMatchObject({ overallStatus: "NOT_STARTED", issues: [] });
    expect(danhGiaTuanThu(vao({ bc: bc({ trangThai: "KHONG_AP_DUNG" }) })).overallStatus).toBe("POLICY_NOT_APPLICABLE");
    const trial = danhGiaTuanThu(vao({ bc: bc({ sourceType: "TRIAL_SESSION", activity: "TRIAL" }), hocVien: null }));
    expect(trial).toMatchObject({ studentAttendanceStatus: "NOT_REQUIRED", studentCommentStatus: "NOT_REQUIRED" });
  });

  it("[TT-17] tỉ lệ tuân thủ: mẫu số = tiết có nghĩa vụ ĐÃ dạy xong; tiết huỷ / còn trong hạn nhận xét không vào mẫu nhận xét", () => {
    const sau = vn("2026-11-03", "11:00");
    const ds = [
      danhGiaTuanThu(vao({ now: sau })), // đủ cả hai
      danhGiaTuanThu(vao({ now: sau, hocVien: hv({ daDiemDanh: HV.slice(0, 8), coMat: HV.slice(0, 8), nhanXet: nx(HV.slice(0, 8), vn(NGAY, "20:30")) }) })), // điểm danh thiếu, nhận xét đủ
      danhGiaTuanThu(vao({ now: sau, hocVien: hv({ nhanXet: [] }) })), // nhận xét quá hạn
      danhGiaTuanThu(vao({ now: sau, bc: bc({ trangThai: "BUOI_DA_HUY" }) })), // huỷ — ngoài mẫu
      danhGiaTuanThu(vao({ now: vn("2026-11-03", "08:00"), hocVien: hv({ nhanXet: [] }) })), // còn trong hạn — ngoài mẫu nhận xét
    ];
    const r = tiLeTuanThu(ds);
    expect(r.buoi).toBe(4);
    expect(r.diemDanh).toEqual({ du: 3, thieu: 1, mau: 4, tiLe: 75 });
    expect(r.nhanXet).toMatchObject({ du: 2, thieu: 1, quaHan: 1, tre: 0, mau: 3, tiLe: 66 });
  });
});

describe("[TT-18] báo cáo theo người", () => {
  it("[TT-18] MỘT dòng mỗi GV, cùng công thức tiLeTuanThu; dạy thay tính cho người DẠY THAY; người chỉ có tiết huỷ không có dòng", async () => {
    const { tuanThuTheoNguoi } = await import("./tuan-thu-buoi");
    const sau = vn("2026-11-03", "11:00");
    const ds = [
      danhGiaTuanThu(vao({ now: sau })),
      danhGiaTuanThu(vao({ now: sau, hocVien: hv({ nhanXet: [] }) })),
      danhGiaTuanThu(vao({ now: sau, bc: bc({ userId: "gv-b", assignmentId: "pc-b" }), hocVien: hv({ nhanXet: nx(HV, vn(NGAY, "20:30"), "gv-b") }) })),
      danhGiaTuanThu(vao({ now: sau, bc: bc({ userId: "gv-c", assignmentId: "pc-c", trangThai: "BUOI_DA_HUY" }) })),
    ];
    const r = tuanThuTheoNguoi(ds);
    expect(r.map((x) => x.userId).sort()).toEqual([GV, "gv-b"]);
    expect(r.find((x) => x.userId === GV)).toMatchObject({ buoi: 2, diemDanh: { du: 2, mau: 2, tiLe: 100 }, nhanXet: { du: 1, quaHan: 1, mau: 2, tiLe: 50 } });
    expect(r.find((x) => x.userId === "gv-b")).toMatchObject({ buoi: 1, nhanXet: { du: 1, mau: 1, tiLe: 100 } });
  });
});
