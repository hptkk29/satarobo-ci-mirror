// lib/lms/session-feedback-roster.ts — #06 (L6): màn "Nhận xét buổi học" site GV.
//
// Logic THUẦN (không DB) dựng danh sách HV được nhận xét cho 1 buổi:
//   - Buổi ĐÃ điểm danh → chỉ HV đi học (PRESENT/LATE) — HV vắng không nhận xét.
//   - Buổi CHƯA điểm danh (0 bản ghi Attendance) → fallback toàn bộ roster active
//     (caller hiện notice "Buổi chưa điểm danh — đang hiện toàn bộ lớp").
// Khớp PRESENT_STATUSES của admin sessions/_actions (deriveSteps) để tiến độ
// "đã nhận xét x/y" 2 nơi không lệch nhau.

/** Status điểm danh được tính là "đi học" (khớp PRESENT_STATUSES phía admin). */
export const FEEDBACK_ATTENDED_STATUSES = ["PRESENT", "LATE"] as const;

const ATTENDED = new Set<string>(FEEDBACK_ATTENDED_STATUSES);

export type FeedbackRosterStudent = { studentId: string; studentName: string };

export type FeedbackRosterAttendanceRow = FeedbackRosterStudent & {
  /** AttendanceStatus dạng string để helper thuần — không import @prisma/client. */
  status: string;
};

/** Dedupe theo studentId, giữ thứ tự đầu vào (Attendance unique theo buổi×HV nhưng vẫn phòng hờ). */
function dedupe(rows: FeedbackRosterStudent[]): FeedbackRosterStudent[] {
  const seen = new Set<string>();
  const out: FeedbackRosterStudent[] = [];
  for (const r of rows) {
    if (seen.has(r.studentId)) continue;
    seen.add(r.studentId);
    out.push({ studentId: r.studentId, studentName: r.studentName });
  }
  return out;
}

/**
 * Danh sách HV hiển thị trên phiếu nhận xét của 1 buổi.
 * - Có điểm danh → chỉ HV PRESENT/LATE (HV vắng không vào danh sách).
 * - Chưa điểm danh → fallback toàn bộ roster active của lớp (attendanceTaken=false).
 */
export function deriveFeedbackRoster(
  attendanceRows: FeedbackRosterAttendanceRow[],
  enrollmentRows: FeedbackRosterStudent[],
): { attendanceTaken: boolean; students: FeedbackRosterStudent[] } {
  if (attendanceRows.length === 0) {
    return { attendanceTaken: false, students: dedupe(enrollmentRows) };
  }
  const students = dedupe(
    attendanceRows
      .filter((r) => ATTENDED.has(r.status))
      .map((r) => ({ studentId: r.studentId, studentName: r.studentName })),
  );
  return { attendanceTaken: true, students };
}

/**
 * Tình trạng nhận xét của 1 buổi cho badge "đã nhận xét x/y HV" (mức b của page).
 * reviewed = feedback ∩ HV đi học (nhận xét lỡ lưu cho HV vắng KHÔNG tính tiến độ —
 * khớp deriveSteps admin). Chưa điểm danh → attended=0, không bao giờ complete.
 */
export function summarizeSessionFeedback(
  attendanceRows: { studentId: string; status: string }[],
  feedbackStudentIds: string[],
): { attendanceTaken: boolean; attended: number; reviewed: number; complete: boolean } {
  const attendanceTaken = attendanceRows.length > 0;
  const attendedIds = new Set(
    attendanceRows.filter((r) => ATTENDED.has(r.status)).map((r) => r.studentId),
  );
  const fbIds = new Set(feedbackStudentIds);
  const reviewed = attendanceTaken
    ? [...attendedIds].filter((id) => fbIds.has(id)).length
    : fbIds.size;
  return {
    attendanceTaken,
    attended: attendedIds.size,
    reviewed,
    complete: attendanceTaken && attendedIds.size > 0 && reviewed >= attendedIds.size,
  };
}
