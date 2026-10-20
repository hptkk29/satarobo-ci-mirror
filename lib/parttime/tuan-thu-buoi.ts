// lib/parttime/tuan-thu-buoi.ts — TUÂN THỦ BUỔI DẠY (TeachingSessionCompliance) cho MỘT phân công. THUẦN: không `@/lib/db`, không đồng hồ.
//
// Ghép, KHÔNG tính lại: phân công + xác nhận nhận lớp (P2/P3) · bằng chứng chấm công GV (P4 — vào / ra / muộn / sớm / sai người đứng
// lớp, đọc từ `BangChungPhanCong`) · điểm danh học viên · nhận xét học viên (hạn = `danhGiaNhanXet` của P5c, bọc lại, không chép).
// Tài liệu: docs/cham-cong/parttime/21-TEACHING-SESSION-COMPLIANCE.md.
//
// Bất biến:
//   · GV chấm vào KHÔNG có nghĩa học viên có mặt — đầu vào điểm danh chỉ là dòng `Attendance` / điểm danh bé ở case bù đã GHI.
//   · Độ ĐẦY ĐỦ điểm danh ≠ tỉ lệ có mặt: 8 có mặt + 1 vắng + 1 vắng có phép = 10/10 ĐỦ.
//   · Tuân thủ là SỰ THẬT, không phải tiền: không đổi / xoá WorkUnit, không đặt số lượng 0, không khoản trừ nào (Q15 mở).
//   · Nghĩa vụ đi theo PHÂN CÔNG còn sống (GV dạy thay chịu); vai chịu nghĩa vụ là hằng số MỘT chỗ dưới đây.
import type { StaffAssignmentStatus, WorkRole } from "@prisma/client";
import type { BangChungPhanCong, MaNgoaiLe } from "./bang-chung-cong";
import { danhGiaNhanXet } from "./nhan-xet-han";

/**
 * Vai CHỊU nghĩa vụ điểm danh / nhận xét học viên. Chỉ GV đứng chính: cổng ghi `loiKhongPhaiNguoiDay` CHẶN trợ giảng ghi cả điểm danh
 * lẫn nhận xét, nên đặt nghĩa vụ lên TA là một nghĩa vụ không thể hoàn thành. Mở rộng cho TA = quyết định nghiệp vụ (Q14) — sửa ở đây.
 */
export const VAI_CHIU_DIEM_DANH: readonly WorkRole[] = ["MAIN_TEACHER"];
export const VAI_CHIU_NHAN_XET: readonly WorkRole[] = ["MAIN_TEACHER"];

export type TrangThaiPhanCongTT = "VALID" | "CANCELLED" | "REPLACED" | "MISSING";
export type TrangThaiNhanLopTT = "ACCEPTED" | "CUTOVER_GRACE_PENDING" | "PENDING" | "DECLINED" | "VERSION_STALE";
export type TrangThaiCongGvTT =
  | "NOT_STARTED"
  | "CHECKED_IN"
  | "TEACHER_ATTENDANCE_OK"
  | "LATE"
  | "EARLY_LEAVE"
  | "MISSING_CHECKOUT"
  | "NO_ATTENDANCE"
  | "ACTUAL_TEACHER_MISMATCH"
  | "NOT_APPLICABLE";
export type TrangThaiChamRaTT = "NOT_YET" | "DONE" | "MISSING" | "NOT_REQUIRED";
export type TrangThaiNguoiDungLopTT = "MATCH" | "MISMATCH" | "NOT_CHECKED";
export type TrangThaiDiemDanhHvTT = "NOT_STARTED" | "PARTIAL" | "COMPLETE" | "NOT_REQUIRED";
export type TrangThaiNhanXetHvTT = "NOT_STARTED" | "PARTIAL" | "COMPLETE" | "LATE_COMPLETE" | "OVERDUE" | "WAITING_ATTENDANCE" | "NOT_REQUIRED";
export type TrangThaiTongTT = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "NEEDS_REVIEW" | "CANCELLED" | "POLICY_NOT_APPLICABLE";

/** Mã vấn đề của RIÊNG tuân thủ học viên. Vấn đề phía GV dùng LẠI mã P4 (`MA_NGOAI_LE_GV`) — không đặt tên thứ hai cho cùng một việc. */
export type MaVanDeHocVien =
  | "STUDENT_ATTENDANCE_NOT_STARTED"
  | "STUDENT_ATTENDANCE_PARTIAL"
  | "STUDENT_COMMENTS_NOT_STARTED"
  | "STUDENT_COMMENTS_PARTIAL"
  | "STUDENT_COMMENTS_OVERDUE"
  | "STUDENT_COMMENTS_LATE"
  | "STUDENT_COMMENT_AUTHOR_MISMATCH";
/** TEACHER_CHECKIN_MISSING = ASSIGNED_NO_ATTENDANCE · TEACHER_CHECKOUT_MISSING = MISSING_CHECKOUT · ACTUAL_TEACHER_MISMATCH = MAIN_ACTUAL_MISMATCH. */
export const MA_NGOAI_LE_GV = ["ASSIGNED_NO_ATTENDANCE", "MISSING_CHECKOUT", "MAIN_ACTUAL_MISMATCH", "LATE", "EARLY_LEAVE", "ASSIGNMENT_NOT_ACCEPTED"] as const satisfies readonly MaNgoaiLe[];
export type MaVanDeTT = MaVanDeHocVien | (typeof MA_NGOAI_LE_GV)[number];

/** Dữ liệu học viên của nguồn buổi (đã đọc theo lô). `null` = nguồn không có điểm danh / nhận xét GV ghi được (trial). */
export type HocVienCuaBuoi = {
  /** Sĩ số PHẢI điểm danh (lớp: tập ghi được của `getSessionRosterStudentIds`; học bù: bé của case trừ REMOVED). */
  siSo: readonly string[];
  /** Học viên ĐÃ có trạng thái điểm danh hợp lệ (mọi giá trị — có mặt, vắng, vắng có phép...). Người ngoài sĩ số bị bỏ. */
  daDiemDanh: readonly string[];
  /** Trong số đã điểm danh: ai CÓ MẶT (lớp: PRESENT/LATE; học bù: bé có mục đã có kết quả) — người phải được nhận xét. */
  coMat: readonly string[];
  /** Nhận xét đã có, mỗi học viên một dòng; `tacGia` = người viết (null = không quy được về một người). */
  nhanXet: readonly { studentId: string; createdAt: Date; tacGia: string | null }[];
};

export type DauVaoTuanThu = {
  bc: BangChungPhanCong;
  trangThaiPhanCong: StaffAssignmentStatus;
  /** Có xác nhận ACCEPTED cho một PHIÊN BẢN CŨ của phân công (lịch đổi sau khi đã nhận). */
  daNhanPhienBanCu: boolean;
  /** Giờ bắt đầu / kết thúc phần DẠY (không gồm 10' chuẩn bị). */
  batDau: Date;
  ketThuc: Date;
  hocVien: HocVienCuaBuoi | null;
  now: Date;
};

export type TuanThuBuoi = {
  assignmentId: string;
  assignmentVersion: number;
  sessionSource: { type: BangChungPhanCong["sourceType"]; id: string };
  teacherId: string;
  centerId: string;
  workDate: string;
  role: WorkRole;
  activityType: BangChungPhanCong["activity"];
  /** Đã qua giờ kết thúc phần dạy (mốc để các nghĩa vụ "phải xong trong buổi" bắt đầu bị tính thiếu). */
  sessionEnded: boolean;

  assignmentStatus: TrangThaiPhanCongTT;
  acceptanceStatus: TrangThaiNhanLopTT;
  teacherAttendanceStatus: TrangThaiCongGvTT;
  checkInAt: Date | null;
  checkoutStatus: TrangThaiChamRaTT;
  checkOutAt: Date | null;
  actualTeacherStatus: TrangThaiNguoiDungLopTT;

  studentAttendanceStatus: TrangThaiDiemDanhHvTT;
  studentAttendanceExpected: number;
  studentAttendanceRecorded: number;
  studentAttendanceCompletionPercent: number | null;

  studentCommentStatus: TrangThaiNhanXetHvTT;
  /** null = chưa biết ai phải được nhận xét (chưa điểm danh ai). */
  studentCommentsExpected: number | null;
  studentCommentsCompleted: number;
  studentCommentCompletionPercent: number | null;
  /** Nhận xét cho học viên phải nhận xét nhưng do NGƯỜI KHÁC viết — không tính là hoàn thành. */
  studentCommentsOtherAuthor: number;
  commentDeadline: Date | null;
  commentsCompletedAt: Date | null;
  /** > 0 khi hoàn tất SAU hạn (sự thật cho Q15 — không phải mức phạt). */
  commentsLateByMinutes: number | null;

  overallStatus: TrangThaiTongTT;
  issues: MaVanDeTT[];
};

const phanTram = (a: number, b: number) => (b > 0 ? Math.floor((a * 100) / b) : null);

function trangThaiPhanCong(s: StaffAssignmentStatus, buoiHuy: boolean): TrangThaiPhanCongTT {
  if (s === "REPLACED") return "REPLACED";
  if (s === "CANCELLED" || buoiHuy) return "CANCELLED";
  return "VALID";
}

function trangThaiNhanLop(v: DauVaoTuanThu): TrangThaiNhanLopTT {
  if (v.bc.daNhan) return "ACCEPTED";
  if (v.trangThaiPhanCong === "DECLINED") return "DECLINED";
  if (v.bc.graceCutover) return "CUTOVER_GRACE_PENDING";
  if (v.daNhanPhienBanCu) return "VERSION_STALE";
  return "PENDING";
}

const CONG_GV: Record<BangChungPhanCong["trangThai"], TrangThaiCongGvTT> = {
  KHONG_AP_DUNG: "NOT_APPLICABLE",
  BUOI_DA_HUY: "NOT_APPLICABLE",
  CHUA_DEN_GIO: "NOT_STARTED",
  DA_VAO: "CHECKED_IN",
  DU_BANG_CHUNG: "TEACHER_ATTENDANCE_OK",
  DI_MUON: "LATE",
  RA_SOM: "EARLY_LEAVE",
  THIEU_RA: "MISSING_CHECKOUT",
  KHONG_BANG_CHUNG: "NO_ATTENDANCE",
  SAI_NGUOI_DUNG_LOP: "ACTUAL_TEACHER_MISMATCH",
};

/** Độ ĐẦY ĐỦ điểm danh: |đã ghi ∩ sĩ số| / |sĩ số| — tập, không đếm dòng (dòng trùng / người ngoài sĩ số không cộng). */
export function doDayDuDiemDanh(siSo: readonly string[], daDiemDanh: readonly string[]): { trangThai: TrangThaiDiemDanhHvTT; can: number; daCo: number } {
  const can = new Set(siSo);
  const daCo = new Set(daDiemDanh.filter((id) => can.has(id))).size;
  if (can.size === 0) return { trangThai: "NOT_REQUIRED", can: 0, daCo: 0 };
  return { trangThai: daCo === can.size ? "COMPLETE" : daCo === 0 ? "NOT_STARTED" : "PARTIAL", can: can.size, daCo };
}

export function danhGiaTuanThu(v: DauVaoTuanThu): TuanThuBuoi {
  const { bc, now } = v;
  const buoiHuy = bc.trangThai === "BUOI_DA_HUY";
  const phanCong = trangThaiPhanCong(v.trangThaiPhanCong, buoiHuy);
  const nhanLop = trangThaiNhanLop(v);
  const huy = phanCong !== "VALID" || nhanLop === "DECLINED";
  const congGv = CONG_GV[bc.trangThai];
  const daBatDau = now.getTime() >= v.batDau.getTime();
  const daKetThuc = now.getTime() >= v.ketThuc.getTime();
  const chamRa: TrangThaiChamRaTT = huy || congGv === "NOT_APPLICABLE" ? "NOT_REQUIRED" : bc.checkOutAt ? "DONE" : daKetThuc ? "MISSING" : "NOT_YET";
  const nguoiDung: TrangThaiNguoiDungLopTT = bc.khopNguoiDay === "KHOP" ? "MATCH" : bc.khopNguoiDay === "LECH" ? "MISMATCH" : "NOT_CHECKED";

  const hv = v.hocVien;
  const chiuDiemDanh = !huy && hv != null && VAI_CHIU_DIEM_DANH.includes(bc.role);
  const chiuNhanXet = !huy && hv != null && VAI_CHIU_NHAN_XET.includes(bc.role);

  // ── Điểm danh học viên ──
  const dd = chiuDiemDanh ? doDayDuDiemDanh(hv.siSo, hv.daDiemDanh) : { trangThai: "NOT_REQUIRED" as const, can: 0, daCo: 0 };

  // ── Nhận xét học viên ── (người phải nhận xét = có mặt ∩ sĩ số; chỉ nhận xét của CHÍNH người chịu nghĩa vụ mới tính)
  let nx: { trangThai: TrangThaiNhanXetHvTT; can: number | null; daCo: number; khacTacGia: number; han: Date | null; xongLuc: Date | null; trePhut: number | null } = {
    trangThai: "NOT_REQUIRED",
    can: 0,
    daCo: 0,
    khacTacGia: 0,
    han: null,
    xongLuc: null,
    trePhut: null,
  };
  if (chiuNhanXet) {
    const siSo = new Set(hv.siSo);
    const daDiem = new Set(hv.daDiemDanh.filter((id) => siSo.has(id)));
    const phai = [...new Set(hv.coMat.filter((id) => daDiem.has(id)))];
    const phaiSet = new Set(phai);
    const cuaPhai = hv.nhanXet.filter((n) => phaiSet.has(n.studentId));
    const dung = cuaPhai.filter((n) => n.tacGia === bc.userId);
    const khacTacGia = new Set(cuaPhai.filter((n) => n.tacGia !== bc.userId).map((n) => n.studentId)).size;
    const kq = danhGiaNhanXet({ ngayBuoi: bc.workDate, hocVienCoMat: phai, nhanXet: dung, now });
    const ddXong = dd.trangThai === "COMPLETE" || dd.trangThai === "NOT_REQUIRED";
    let tt: TrangThaiNhanXetHvTT;
    if (dd.daCo === 0 && dd.trangThai !== "NOT_REQUIRED") tt = "WAITING_ATTENDANCE";
    else if (kq.trangThai === "KHONG_YEU_CAU") tt = ddXong ? "NOT_REQUIRED" : "WAITING_ATTENDANCE";
    else if (kq.trangThai === "ON_TIME") tt = "COMPLETE";
    else if (kq.trangThai === "LATE") tt = "LATE_COMPLETE";
    else if (kq.trangThai === "MISSING") tt = "OVERDUE";
    else tt = kq.daCo === 0 ? "NOT_STARTED" : "PARTIAL";
    // Quá hạn mà vẫn chưa điểm danh ai: không biết ai phải được nhận xét, nhưng hạn đã qua — QUÁ HẠN (không đoán số).
    if (tt === "WAITING_ATTENDANCE" && now.getTime() > kq.han.getTime()) tt = "OVERDUE";
    const daCo = new Set(dung.map((n) => n.studentId)).size;
    nx = {
      trangThai: tt,
      can: tt === "WAITING_ATTENDANCE" || (tt === "OVERDUE" && dd.daCo === 0) ? null : phai.length,
      daCo,
      khacTacGia,
      han: kq.han,
      xongLuc: kq.hoanTatLuc,
      trePhut: kq.hoanTatLuc && kq.hoanTatLuc.getTime() > kq.han.getTime() ? Math.ceil((kq.hoanTatLuc.getTime() - kq.han.getTime()) / 60_000) : null,
    };
  }

  // ── Vấn đề ──
  const issues: MaVanDeTT[] = [];
  if (!huy) {
    for (const m of MA_NGOAI_LE_GV) if (bc.ngoaiLe.includes(m)) issues.push(m);
    if (daKetThuc && dd.trangThai === "NOT_STARTED") issues.push("STUDENT_ATTENDANCE_NOT_STARTED");
    if (daKetThuc && dd.trangThai === "PARTIAL") issues.push("STUDENT_ATTENDANCE_PARTIAL");
    if (nx.trangThai === "OVERDUE") issues.push("STUDENT_COMMENTS_OVERDUE");
    else if (nx.trangThai === "LATE_COMPLETE") issues.push("STUDENT_COMMENTS_LATE");
    else if (daKetThuc && nx.trangThai === "NOT_STARTED") issues.push("STUDENT_COMMENTS_NOT_STARTED");
    else if (daKetThuc && nx.trangThai === "PARTIAL") issues.push("STUDENT_COMMENTS_PARTIAL");
    if (nx.khacTacGia > 0) issues.push("STUDENT_COMMENT_AUTHOR_MISMATCH");
  }

  // ── Tổng ──
  let tong: TrangThaiTongTT;
  if (huy) tong = "CANCELLED";
  else if (bc.trangThai === "KHONG_AP_DUNG") tong = "POLICY_NOT_APPLICABLE";
  else if (!daBatDau && !bc.checkInAt && dd.daCo === 0) tong = "NOT_STARTED";
  else if (!daKetThuc) tong = "IN_PROGRESS";
  else {
    const nhanHopLe = nhanLop === "ACCEPTED" || nhanLop === "CUTOVER_GRACE_PENDING";
    const loi =
      !nhanHopLe ||
      congGv !== "TEACHER_ATTENDANCE_OK" ||
      (bc.role === "MAIN_TEACHER" && nguoiDung !== "MATCH") ||
      chamRa !== "DONE" ||
      !(dd.trangThai === "COMPLETE" || dd.trangThai === "NOT_REQUIRED") ||
      nx.trangThai === "OVERDUE" ||
      nx.trangThai === "LATE_COMPLETE" ||
      nx.khacTacGia > 0;
    if (loi) tong = "NEEDS_REVIEW";
    else if (nx.trangThai === "COMPLETE" || nx.trangThai === "NOT_REQUIRED") tong = "COMPLETE";
    else tong = "IN_PROGRESS"; // nhận xét còn trong hạn (tới 10:00 hôm sau)
  }

  return {
    assignmentId: bc.assignmentId,
    assignmentVersion: bc.assignmentVersion,
    sessionSource: { type: bc.sourceType, id: bc.sourceId },
    teacherId: bc.userId,
    centerId: bc.centerId,
    workDate: bc.workDate,
    role: bc.role,
    activityType: bc.activity,
    sessionEnded: daKetThuc,
    assignmentStatus: phanCong,
    acceptanceStatus: nhanLop,
    teacherAttendanceStatus: congGv,
    checkInAt: bc.checkInAt,
    checkoutStatus: chamRa,
    checkOutAt: bc.checkOutAt,
    actualTeacherStatus: nguoiDung,
    studentAttendanceStatus: dd.trangThai,
    studentAttendanceExpected: dd.can,
    studentAttendanceRecorded: dd.daCo,
    studentAttendanceCompletionPercent: phanTram(dd.daCo, dd.can),
    studentCommentStatus: nx.trangThai,
    studentCommentsExpected: nx.can,
    studentCommentsCompleted: nx.daCo,
    studentCommentCompletionPercent: nx.can == null ? null : phanTram(nx.daCo, nx.can),
    studentCommentsOtherAuthor: nx.khacTacGia,
    commentDeadline: nx.han,
    commentsCompletedAt: nx.xongLuc,
    commentsLateByMinutes: nx.trePhut,
    overallStatus: tong,
    issues,
  };
}

/** Tỉ lệ tuân thủ cho báo cáo — mẫu số = số tiết CÓ nghĩa vụ (NOT_REQUIRED / huỷ / chưa tới lượt KHÔNG vào mẫu). */
export function tiLeTuanThu(ds: readonly TuanThuBuoi[]): {
  buoi: number;
  diemDanh: { du: number; thieu: number; mau: number; tiLe: number | null };
  nhanXet: { du: number; thieu: number; quaHan: number; tre: number; mau: number; tiLe: number | null };
  thieuChamRa: number;
} {
  // Chỉ tiết ĐÃ DẠY XONG giờ (tiết đang diễn ra / chưa tới chưa thể "thiếu"), không huỷ, thuộc SR.QD.238.
  const xet = ds.filter((t) => t.sessionEnded && t.overallStatus !== "CANCELLED" && t.overallStatus !== "POLICY_NOT_APPLICABLE");
  const ddMau = xet.filter((t) => t.studentAttendanceStatus !== "NOT_REQUIRED");
  const ddDu = ddMau.filter((t) => t.studentAttendanceStatus === "COMPLETE").length;
  // Nhận xét: chỉ tiết đã QUA HẠN hoặc đã xong mới vào mẫu (tiết còn trong hạn chưa thể "thiếu").
  const nxMau = xet.filter((t) => t.studentCommentStatus === "COMPLETE" || t.studentCommentStatus === "LATE_COMPLETE" || t.studentCommentStatus === "OVERDUE");
  const nxDu = nxMau.filter((t) => t.studentCommentStatus === "COMPLETE").length;
  return {
    buoi: xet.length,
    diemDanh: { du: ddDu, thieu: ddMau.length - ddDu, mau: ddMau.length, tiLe: phanTram(ddDu, ddMau.length) },
    nhanXet: {
      du: nxDu,
      thieu: nxMau.length - nxDu,
      quaHan: nxMau.filter((t) => t.studentCommentStatus === "OVERDUE").length,
      tre: nxMau.filter((t) => t.studentCommentStatus === "LATE_COMPLETE").length,
      mau: nxMau.length,
      tiLe: phanTram(nxDu, nxMau.length),
    },
    thieuChamRa: xet.filter((t) => t.checkoutStatus === "MISSING").length,
  };
}

export type TuanThuTheoNguoi = { userId: string } & ReturnType<typeof tiLeTuanThu>;

/** Báo cáo tuân thủ tuần / tháng của QLCS: MỘT dòng mỗi người, cùng công thức `tiLeTuanThu` (không tính lại ở màn). */
export function tuanThuTheoNguoi(ds: readonly TuanThuBuoi[]): TuanThuTheoNguoi[] {
  const theo = new Map<string, TuanThuBuoi[]>();
  for (const t of ds) theo.set(t.teacherId, [...(theo.get(t.teacherId) ?? []), t]);
  return [...theo.entries()].map(([userId, x]) => ({ userId, ...tiLeTuanThu(x) })).filter((r) => r.buoi > 0);
}
