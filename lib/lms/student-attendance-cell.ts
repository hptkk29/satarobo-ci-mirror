// lib/lms/student-attendance-cell.ts — ô trạng thái điểm danh của MỘT học viên ở MỘT buổi.
//
// Vì sao file này tồn tại (QA site GV vòng 1, BUG-001):
// hồ sơ học viên suy nhãn từ SỰ TỒN TẠI của bản ghi Attendance:
//     att ? ATT_BADGE[att] : session.status === "CANCELLED" ? "Đã huỷ" : "Chưa diễn ra"
// Không một nhánh nào hỏi NGÀY. Hệ quả đo được trên UAT: buổi 28/06/2026 đã dạy
// (lớp báo "Đã dạy") vẫn in "Chưa diễn ra" ở hồ sơ của em chưa được chấm — hai tháng
// sau ngày học. QA chứng minh bằng cách chấm điểm danh cho buổi trước đó: nhãn đổi từ
// "Chưa diễn ra" thành "Có mặt" mà không có gì khác thay đổi.
//
// Bốn câu trả lời KHÁC NHAU từng bị gộp thành một chữ "Chưa diễn ra":
//   • buổi ở tương lai                    → chưa tới lượt, không ai nợ gì;
//   • buổi đã qua mà chưa chấm            → GIÁO VIÊN CÒN NỢ;
//   • buổi đã huỷ                         → không tính vào đâu cả;
//   • em không còn học lớp lúc đó         → không áp dụng, đừng tính vào chuyên cần.
// Gộp bốn thứ đó lại là lý do học bạ đọc ra "0% · 0/9" cho em đã nghỉ giữa khoá.
//
// PURE — không DB, không "use server". Người gọi truyền mốc thời gian vào (dùng
// `vnTodayEnd()` của @/lib/time/vn, ĐỪNG tự dựng Date ở đây: Vercel chạy UTC còn máy
// dev +07, tự tính là đẻ bug "chạy máy tôi thì được").
import type { AttendanceStatus } from "@prisma/client";

import { ENROLLMENT_ACTIVE_STATUSES } from "@/lib/enrollment-status";

export type StudentAttendanceCell =
  | { kind: "MARKED"; status: AttendanceStatus }
  | { kind: "CANCELLED" }
  | { kind: "NOT_YET" }
  | { kind: "NOT_MARKED" }
  | { kind: "NOT_APPLICABLE" };

export function studentAttendanceCell(args: {
  /** Trạng thái điểm danh ĐÃ CHẤM của em ở buổi này; không có bản ghi thì null. */
  attendanceStatus?: AttendanceStatus | null;
  /** `ClassSession.status` — chỉ dùng để nhận buổi đã huỷ. */
  sessionStatus: string;
  sessionDateMs: number;
  /** Mốc hết ngày hôm nay theo giờ VN — `vnTodayEnd().getTime()`. */
  todayEndMs: number;
  /** `Enrollment.status` của em Ở CHÍNH LỚP NÀY. Không truyền = coi như còn học. */
  enrollmentStatus?: string | null;
}): StudentAttendanceCell {
  // Đã chấm là SỰ THẬT — thắng mọi suy luận khác. Kể cả buổi sau bị huỷ, hay em sau
  // đó nghỉ học: bản ghi nói em đã có mặt hôm đó thì vẫn in đúng như vậy.
  if (args.attendanceStatus) {
    return { kind: "MARKED", status: args.attendanceStatus };
  }
  if (args.sessionStatus === "CANCELLED") return { kind: "CANCELLED" };
  if (args.sessionDateMs > args.todayEndMs) return { kind: "NOT_YET" };

  // Buổi đã qua, chưa chấm. Nếu em KHÔNG còn học lớp này thì đây không phải việc còn
  // nợ của giáo viên và cũng không được tính vào mẫu số chuyên cần của em.
  const enr = args.enrollmentStatus;
  if (enr && !(ENROLLMENT_ACTIVE_STATUSES as readonly string[]).includes(enr)) {
    return { kind: "NOT_APPLICABLE" };
  }
  return { kind: "NOT_MARKED" };
}

/** Nhãn tiếng Việt cho từng ca — một nguồn duy nhất, đừng chép tay ở màn hình. */
export const STUDENT_ATTENDANCE_CELL_LABEL: Record<
  Exclude<StudentAttendanceCell["kind"], "MARKED">,
  string
> = {
  CANCELLED: "Đã huỷ",
  NOT_YET: "Chưa diễn ra",
  NOT_MARKED: "Chưa điểm danh",
  NOT_APPLICABLE: "Không áp dụng",
};
