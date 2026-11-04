// lib/parttime/nhan-tuan-thu.ts — NHÃN của tuân thủ buổi dạy (thuần, dùng chung QLCS · GV · thẻ Chấm công). Một chỗ quyết chữ ⇒ ba màn
// không thể nói khác nhau về cùng một tiết (luật 12b). Không bao giờ nói tiền / phạt — tuân thủ là hồ sơ buổi, không phải lương.
import type { TuanThuBuoi } from "./tuan-thu-buoi";

export type ToneTuanThu = "success" | "warning" | "danger" | "muted" | "info";
export type BuocTuanThu = {
  ma: "NHAN_LOP" | "CHAM_VAO" | "DIEM_DANH" | "CHAM_RA" | "NHAN_XET";
  nhan: string;
  xong: boolean;
  tone: ToneTuanThu;
  chiTiet: string;
  /** Chưa làm được bước này (nhận xét khi chưa điểm danh ai) — màn KHÔNG vẽ lối tắt (luật 12: nút chắc chắn vô ích là lời hứa suông). */
  choBuocTruoc?: boolean;
  /** Số học viên còn thiếu (điểm danh / nhận xét) — null khi chưa biết hoặc không áp. */
  conThieu?: number | null;
};
export type NhanTuanThu = { buoc: BuocTuanThu[]; tong: { nhan: string; tone: ToneTuanThu }; vanDe: string[] };

const gio = (d: Date) => d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
const ngayGio = (d: Date) =>
  d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });

const VAN_DE: Record<TuanThuBuoi["issues"][number], string> = {
  ASSIGNED_NO_ATTENDANCE: "Không có lượt chấm vào",
  INSUFFICIENT_TEACHING_ATTENDANCE: "Chỉ có mặt giờ chuẩn bị — chưa đủ bằng chứng đã dạy",
  MISSING_CHECKOUT: "Thiếu lượt chấm ra",
  MAIN_ACTUAL_MISMATCH: "Người đứng lớp khác người được phân",
  LATE: "Chấm vào muộn",
  EARLY_LEAVE: "Chấm ra sớm",
  ASSIGNMENT_NOT_ACCEPTED: "Chưa nhận lớp",
  STUDENT_ATTENDANCE_NOT_STARTED: "Chưa điểm danh học viên",
  STUDENT_ATTENDANCE_PARTIAL: "Điểm danh học viên chưa đủ",
  STUDENT_COMMENTS_NOT_STARTED: "Chưa nhận xét học viên",
  STUDENT_COMMENTS_PARTIAL: "Nhận xét học viên chưa đủ",
  STUDENT_COMMENTS_OVERDUE: "Quá hạn nhận xét (10:00 hôm sau)",
  STUDENT_COMMENTS_LATE: "Nhận xét hoàn tất sau hạn",
  STUDENT_COMMENT_AUTHOR_MISMATCH: "Có nhận xét do người khác viết",
};

export function nhanTuanThu(t: TuanThuBuoi): NhanTuanThu {
  const buoc: BuocTuanThu[] = [];
  const nhan = t.acceptanceStatus;
  buoc.push(
    nhan === "ACCEPTED"
      ? { ma: "NHAN_LOP", nhan: "Đã gán lớp", xong: true, tone: "success", chiTiet: "Phân công đã có hiệu lực (quản lý gán thẳng từ 20/10/2026)." }
      : nhan === "CUTOVER_GRACE_PENDING"
        ? { ma: "NHAN_LOP", nhan: "Nhập lúc chuyển đổi", xong: true, tone: "info", chiTiet: "Phân công nhập lúc chuyển đổi, còn trong thời gian ân hạn." }
        : nhan === "VERSION_STALE"
          ? { ma: "NHAN_LOP", nhan: "Lịch đổi — chờ nhận lại", xong: false, tone: "warning", chiTiet: "Đã nhận phiên bản cũ; lịch đã đổi nên phải nhận lại." }
          : nhan === "DECLINED"
            ? { ma: "NHAN_LOP", nhan: "Đã từ chối", xong: false, tone: "muted", chiTiet: "Đã từ chối phân công." }
            : { ma: "NHAN_LOP", nhan: "Chưa nhận lớp", xong: false, tone: "warning", chiTiet: "Chưa xác nhận nhận lớp." },
  );
  const cg = t.teacherAttendanceStatus;
  buoc.push(
    t.checkInAt
      ? { ma: "CHAM_VAO", nhan: `Chấm vào ${gio(t.checkInAt)}`, xong: true, tone: cg === "LATE" ? "warning" : "success", chiTiet: cg === "LATE" ? "Chấm vào muộn so với giờ phải có mặt." : "Đã chấm vào." }
      : { ma: "CHAM_VAO", nhan: "Chấm vào", xong: false, tone: cg === "NO_ATTENDANCE" ? "danger" : "muted", chiTiet: cg === "NO_ATTENDANCE" ? "Không có lượt chấm vào trong khung giờ." : "Chưa chấm vào." },
  );
  const dd = t.studentAttendanceStatus;
  buoc.push(
    dd === "NOT_REQUIRED"
      ? { ma: "DIEM_DANH", nhan: "Điểm danh học viên — không áp dụng", xong: true, tone: "muted", chiTiet: "Vai này / buổi này không phải điểm danh học viên." }
      : {
          ma: "DIEM_DANH",
          nhan: `Điểm danh ${t.studentAttendanceRecorded}/${t.studentAttendanceExpected}`,
          xong: dd === "COMPLETE",
          conThieu: t.studentAttendanceExpected - t.studentAttendanceRecorded,
          tone: dd === "COMPLETE" ? "success" : t.sessionEnded ? "danger" : dd === "PARTIAL" ? "warning" : "muted",
          chiTiet:
            dd === "COMPLETE"
              ? "Mọi học viên của buổi đã có trạng thái điểm danh (có mặt, vắng hay vắng có phép đều tính là đã điểm danh)."
              : `Còn ${t.studentAttendanceExpected - t.studentAttendanceRecorded} học viên chưa có trạng thái điểm danh.`,
        },
  );
  buoc.push(
    t.checkoutStatus === "DONE" && t.checkOutAt
      ? { ma: "CHAM_RA", nhan: `Chấm ra ${gio(t.checkOutAt)}`, xong: true, tone: t.teacherAttendanceStatus === "INSUFFICIENT_TEACHING_ATTENDANCE" ? "danger" : t.teacherAttendanceStatus === "EARLY_LEAVE" ? "warning" : "success", chiTiet: t.teacherAttendanceStatus === "INSUFFICIENT_TEACHING_ATTENDANCE" ? "Đã chấm ra TRƯỚC giờ bắt đầu dạy — chưa đủ bằng chứng đã dạy." : "Đã chấm ra." }
      : t.checkoutStatus === "NOT_REQUIRED"
        ? { ma: "CHAM_RA", nhan: "Chấm ra — không áp dụng", xong: true, tone: "muted", chiTiet: "Buổi không còn nghĩa vụ." }
        : { ma: "CHAM_RA", nhan: "Chấm ra", xong: false, tone: t.checkoutStatus === "MISSING" ? "danger" : "muted", chiTiet: t.checkoutStatus === "MISSING" ? "Buổi đã kết thúc mà chưa có lượt chấm ra." : "Chưa chấm ra." },
  );
  const nx = t.studentCommentStatus;
  const xy = t.studentCommentsExpected == null ? `${t.studentCommentsCompleted}/?` : `${t.studentCommentsCompleted}/${t.studentCommentsExpected}`;
  const han = t.commentDeadline ? ` Hạn: ${ngayGio(t.commentDeadline)}.` : "";
  buoc.push(
    nx === "NOT_REQUIRED"
      ? { ma: "NHAN_XET", nhan: "Nhận xét — không áp dụng", xong: true, tone: "muted", chiTiet: "Không có học viên nào phải nhận xét (vắng hết, hoặc vai này không nhận xét)." }
      : nx === "WAITING_ATTENDANCE"
        ? { ma: "NHAN_XET", nhan: "Nhận xét — chờ điểm danh", xong: false, tone: "muted", choBuocTruoc: true, chiTiet: `Điểm danh trước để biết học viên nào có mặt cần nhận xét.${han}` }
        : nx === "COMPLETE"
          ? { ma: "NHAN_XET", nhan: `Nhận xét ${xy}`, xong: true, tone: "success", chiTiet: `Đủ nhận xét cho học viên có mặt, đúng hạn.${han}` }
          : nx === "LATE_COMPLETE"
            ? { ma: "NHAN_XET", nhan: `Nhận xét ${xy} — trễ`, xong: true, tone: "warning", chiTiet: `Đủ nhận xét nhưng hoàn tất sau hạn ${t.commentsLateByMinutes ?? 0} phút.${han}` }
            : {
                ma: "NHAN_XET",
                nhan: `Nhận xét ${xy}${nx === "OVERDUE" ? " — quá hạn" : ""}`,
                xong: false,
                conThieu: t.studentCommentsExpected == null ? null : t.studentCommentsExpected - t.studentCommentsCompleted,
                tone: nx === "OVERDUE" ? "danger" : t.sessionEnded ? "warning" : "muted",
                chiTiet: `${t.studentCommentsExpected == null ? "Chưa biết số học viên cần nhận xét." : `Còn thiếu ${t.studentCommentsExpected - t.studentCommentsCompleted}.`}${t.studentCommentsOtherAuthor ? ` ${t.studentCommentsOtherAuthor} nhận xét do người khác viết — không tính.` : ""}${han}`,
              },
  );
  const tong: NhanTuanThu["tong"] =
    t.overallStatus === "COMPLETE"
      ? { nhan: "Hồ sơ buổi hoàn tất", tone: "success" }
      : t.overallStatus === "NEEDS_REVIEW"
        ? { nhan: "Hồ sơ buổi chưa hoàn tất", tone: "danger" }
        : t.overallStatus === "IN_PROGRESS"
          ? { nhan: "Hồ sơ buổi đang làm", tone: "warning" }
          : t.overallStatus === "CANCELLED"
            ? { nhan: "Không còn nghĩa vụ", tone: "muted" }
            : t.overallStatus === "POLICY_NOT_APPLICABLE"
              ? { nhan: "Ngoài SR.QD.238", tone: "muted" }
              : { nhan: "Chưa tới giờ", tone: "muted" };
  return { buoc, tong, vanDe: t.issues.map((m) => VAN_DE[m]) };
}

// ─── Lối tắt tới màn điểm danh / nhận xét ĐÃ CÓ (không dựng màn thứ hai) ─────────────────────────────

/**
 * Đích của hồ sơ buổi. Đường dẫn chỉ là lối tắt — trang đích TỰ kiểm quyền trên buổi (site GV: `/teacher/lop` đòi lớp mình phụ trách
 * và `sess.classId === classId`; `/teacher/day-thay/[id]` qua `docChiTietDayThay`; `/teacher/hoc-bu/[id]` đòi đúng GV của case;
 * admin: `/attendance`, `/sessions/[id]`, `/hoc-bu/case/[id]` theo quyền + phạm vi cơ sở). Không tham số nào ở đây được tin.
 */
/** Site đang đứng — quyết đường dẫn của lối tắt (KHÔNG phải vai RBAC). */
export type SiteHoSo = "ADMIN" | "GIAO_VIEN";

export type DichHoSo = { loai: "LOP"; sessionId: string; classId: string; dayThay: boolean } | { loai: "BU"; caseId: string };

export function duongHoSo(d: DichHoSo, site: SiteHoSo, viec: "diem-danh" | "nhan-xet"): string {
  const q = encodeURIComponent;
  if (d.loai === "BU") return site === "GIAO_VIEN" ? `/teacher/hoc-bu/${q(d.caseId)}` : `/hoc-bu/case/${q(d.caseId)}`;
  if (site === "ADMIN") return viec === "diem-danh" ? `/attendance?sessionId=${q(d.sessionId)}` : `/sessions/${q(d.sessionId)}`;
  // Site GV — đúng hai lối mà trang chủ site GV đang dùng (buổi dạy thay không thuộc lớp mình ⇒ màn "Dạy thay" theo BUỔI).
  if (d.dayThay) return `/teacher/day-thay/${q(d.sessionId)}?tab=${viec}`;
  return viec === "diem-danh"
    ? `/teacher/lop?classId=${q(d.classId)}&sessionId=${q(d.sessionId)}`
    : `/teacher/lop?classId=${q(d.classId)}&tab=nhan-xet&rvSession=${q(d.sessionId)}`;
}
