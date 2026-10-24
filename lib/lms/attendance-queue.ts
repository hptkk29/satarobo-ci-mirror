// lib/lms/attendance-queue.ts — HÀNG ĐỢI ĐIỂM DANH: một buổi đang ở bậc việc nào,
// và danh sách buổi phải xếp theo thứ tự nào.
//
// Yêu cầu 21/08 (màn /attendance của admin): mở trang ra phải thấy NGAY việc còn nợ,
// buổi đã xong đẩy xuống đáy. Thứ tự chủ dự án chốt:
//
//   chưa hoàn tất  →  sắp tới (hôm nay)  →  chưa tới giờ  →  đã hoàn tất
//
// Hai bậc CUỐI là phần THÊM (chủ dự án không nêu), cùng một lý do: chúng là buổi
// KHÔNG CÒN VIỆC ĐỂ LÀM, mà nếu để chung nhóm "chưa hoàn tất" thì chúng ghim vĩnh viễn
// ở đầu bảng và đẩy việc thật xuống dưới —
//   • "lớp không còn học viên" (khoá đã kết thúc: mọi enrollment sang COMPLETED, hoặc
//     lớp mới chưa xếp học viên) — không có ai để điểm danh nữa;
//   • "đã huỷ" — buổi CANCELLED. Cũng không lọc chúng khỏi truy vấn: một màn dùng hằng
//     ngày thì không được để dữ liệu biến mất không dấu vết.
//
// ⚠️ "Đã hoàn tất" ở đây KHÁC "có bản ghi điểm danh". Ba điều kiện, chủ dự án chốt
// 21/08, và cả ba đều xét theo TỪNG HỌC VIÊN chứ không theo số lượng:
//   1. điểm danh ĐỦ CẢ LỚP;
//   2. mọi em ĐI HỌC đều có phiếu nhận xét;
//   3. mọi em ĐI HỌC đều có ảnh/video (ảnh riêng, hoặc một ảnh chung cả lớp).
// Em VẮNG thì miễn cả (2) lẫn (3). Thiếu một trong ba thì buổi vẫn nằm ở nhóm trên
// cùng, kèm chip chỉ đúng việc còn thiếu.
//
// File này KHÔNG tự định nghĩa lại "đủ" — nó chỉ RÁP ba câu trả lời có sẵn:
//   • điểm danh đủ  → `attendanceCoversRoster`      (lib/lms/session-order)
//   • nhận xét đủ   → `summarizeSessionFeedback`    (lib/lms/session-feedback-roster)
//   • ảnh đủ        → `mediaCoversAttendees`        (lib/lms/session-order)
//   • đủ cả ba      → `isSessionWorkComplete`       (lib/lms/session-order)
// rồi thêm bậc theo THỜI GIAN. Sửa định nghĩa thì sửa ở các file trên, không sửa hai nơi.
//
// PURE (không DB, không "use server") — dùng được ở RSC, client và test.
import {
  attendanceCoversRoster,
  isSessionWorkComplete,
  mediaCoversAttendees,
  type SessionWorkState,
} from "@/lib/lms/session-order";
import {
  FEEDBACK_ATTENDED_STATUSES,
  summarizeSessionFeedback,
} from "@/lib/lms/session-feedback-roster";
import { vnYmd } from "@/lib/time/vn";

export type AttendanceQueuePhase =
  | "PENDING" // đã tới giờ mà chưa xong đủ 3 việc
  | "TODAY" // hôm nay, chưa tới giờ học
  | "UPCOMING" // từ mai trở đi
  | "DONE" // đủ 3 việc
  | "NO_ROSTER" // lớp không còn học viên đang học — không còn việc để làm
  | "CANCELLED"; // buổi đã huỷ

/** Thứ tự hiển thị của từng bậc (nhỏ = lên trước). */
export const ATTENDANCE_QUEUE_ORDER: Record<AttendanceQueuePhase, number> = {
  PENDING: 0,
  TODAY: 1,
  UPCOMING: 2,
  DONE: 3,
  NO_ROSTER: 4,
  CANCELLED: 5,
};

/** Nhãn tiêu đề nhóm trên màn hình. */
export const ATTENDANCE_QUEUE_LABEL: Record<AttendanceQueuePhase, string> = {
  PENDING: "Chưa hoàn tất",
  TODAY: "Sắp tới hôm nay",
  UPCOMING: "Chưa tới giờ",
  DONE: "Đã hoàn tất",
  NO_ROSTER: "Lớp không còn học viên",
  CANCELLED: "Đã huỷ",
};

/** Dữ liệu thô của một buổi — đủ để suy ra cả 3 việc. */
export interface SessionWorkInput {
  /**
   * Học viên ĐANG HỌC của lớp (enrollment còn hiệu lực, chưa xoá mềm).
   *
   * ⚠️ Phải là DANH SÁCH ID, không phải con số. So `số bản ghi >= sĩ số` sai cả hai
   * chiều: học viên HỌC BÙ từ lớp khác cũng sinh bản ghi Attendance nên tổng phồng lên
   * và một buổi chấm thiếu người vẫn được coi là xong.
   */
  rosterStudentIds: Iterable<string>;
  /** Bản ghi điểm danh của buổi (kể cả học viên học bù). */
  attendanceRows: { studentId: string; status: string }[];
  /** Học viên đã có phiếu nhận xét ở buổi này. */
  feedbackStudentIds: string[];
  /**
   * Ảnh/video của buổi, đã gom bằng `buildSessionMediaCoverage`.
   *
   * ⚠️ KHÔNG phải "số tệp". Chủ dự án chốt 21/08: mọi học viên ĐI HỌC đều phải có ảnh
   * (ảnh riêng hoặc ảnh chung cả lớp); em vắng thì miễn. Một tấm ảnh chụp một em không
   * nói được gì về chín em còn lại — nên truy vấn nguồn phải lấy `isClassWide` +
   * `tags.studentId` (SESSION_MEDIA_SELECT), tuyệt đối không `groupBy`/`distinct` theo
   * buổi vì gộp là mất sạch thẻ học viên.
   */
  media: { taggedStudentIds: Iterable<string>; hasClassWide: boolean };
}

/**
 * Ba việc sau buổi.
 *
 * `feedbackDone` đi qua `summarizeSessionFeedback` — nó khớp theo ID chứ không so số
 * lượng, nên 9 phiếu viết cho 9 em KHÁC không còn được tính là đủ cho 9 em đi học. Kèm
 * theo đó là quy ước của hàm ấy: buổi chưa điểm danh, hoặc buổi cả lớp vắng, KHÔNG bao
 * giờ `complete` — cùng một luật với site GV và badge "đã nhận xét x/y" ở admin.
 */
export function sessionWorkState(input: SessionWorkInput): SessionWorkState {
  const marked = new Set(input.attendanceRows.map((r) => r.studentId));
  return {
    attendanceDone: attendanceCoversRoster(marked, input.rosterStudentIds),
    feedbackDone: summarizeSessionFeedback(input.attendanceRows, input.feedbackStudentIds)
      .complete,
    photoDone: mediaCoversAttendees({
      attendedStudentIds: attendedStudentIds(input.attendanceRows),
      taggedStudentIds: input.media.taggedStudentIds,
      hasClassWide: input.media.hasClassWide,
    }),
  };
}

const ATTENDED = new Set<string>(FEEDBACK_ATTENDED_STATUSES);

/** Học viên thực sự ĐI HỌC buổi này (PRESENT/LATE) — mẫu số của nhận xét và của ảnh. */
export function attendedStudentIds(
  attendanceRows: { studentId: string; status: string }[],
): Set<string> {
  return new Set(
    attendanceRows.filter((r) => ATTENDED.has(r.status)).map((r) => r.studentId),
  );
}

/**
 * Bao nhiêu em đi học đã có ảnh — chỉ để HIỂN THỊ "Ảnh 7/9", quyết định vẫn là
 * `photoDone`. Ảnh chung cả lớp phủ hết, nên trả luôn tổng số em đi học.
 */
export function photoCoveredCount(input: SessionWorkInput): number {
  const attended = attendedStudentIds(input.attendanceRows);
  if (input.media.hasClassWide) return attended.size;
  const tagged =
    input.media.taggedStudentIds instanceof Set
      ? input.media.taggedStudentIds
      : new Set(input.media.taggedStudentIds);
  let n = 0;
  for (const id of attended) if (tagged.has(id)) n++;
  return n;
}

/**
 * Bậc của một buổi. Thời gian xét TRƯỚC: buổi chưa tới giờ không bao giờ được gắn
 * "đã hoàn tất" hay "lớp không còn học viên" — lớp mới mở chưa xếp học viên vẫn phải
 * hiện là buổi sắp tới.
 */
export function resolveAttendanceQueuePhase(input: {
  date: Date;
  /** ClassSession.status === "CANCELLED". */
  cancelled?: boolean;
  /** Lớp không còn học viên đang học (sĩ số = 0). */
  rosterEmpty?: boolean;
  work: SessionWorkState;
  now?: Date;
}): AttendanceQueuePhase {
  if (input.cancelled) return "CANCELLED";
  const now = input.now ?? new Date();
  if (input.date.getTime() > now.getTime()) {
    return vnYmd(input.date) === vnYmd(now) ? "TODAY" : "UPCOMING";
  }
  if (input.rosterEmpty) return "NO_ROSTER";
  return isSessionWorkComplete(input.work) ? "DONE" : "PENDING";
}

export interface AttendanceQueueRow {
  phase: AttendanceQueuePhase;
  /** Số buổi trong lớp (buildSessionNumberMap). Không tra được → xếp cuối nhóm. */
  number: number | null | undefined;
  /** Mốc thời gian buổi (ms) — phân giải khi hai buổi cùng số. */
  time: number;
}

/**
 * So 2 buổi: bậc trước, rồi SỐ BUỔI tăng dần (yêu cầu 21/08), rồi ngày tăng dần.
 *
 * ⚠️ Ở khung "tất cả lớp", số buổi tăng dần nghĩa là mọi "Buổi 1" đứng cạnh nhau —
 * đó là điều chủ dự án yêu cầu ("sắp xếp theo thứ tự buổi"), không phải lỗi. Muốn đọc
 * theo dòng thời gian thì lọc về MỘT lớp, khi đó số buổi và ngày trùng thứ tự.
 */
export function compareAttendanceQueueOrder(
  a: AttendanceQueueRow,
  b: AttendanceQueueRow,
): number {
  const pa = ATTENDANCE_QUEUE_ORDER[a.phase];
  const pb = ATTENDANCE_QUEUE_ORDER[b.phase];
  if (pa !== pb) return pa - pb;
  // 08/09 — THỜI GIAN thắng số buổi: nhãn nay là số LỘ TRÌNH, sắp theo nó thì buổi
  // dời sớm mang bài cuối bị đẩy xuống đáy hàng đợi. Xem `lib/lms/session-order.ts`.
  if (a.time !== b.time) return a.time - b.time;
  const an = a.number ?? Number.MAX_SAFE_INTEGER;
  const bn = b.number ?? Number.MAX_SAFE_INTEGER;
  if (an !== bn) return an - bn;
  return a.time - b.time;
}

/** `compareAttendanceQueueOrder` áp lên mảng bất kỳ (KHÔNG sửa mảng gốc). */
export function sortAttendanceQueue<T>(
  rows: T[],
  pick: (row: T) => AttendanceQueueRow,
): T[] {
  return [...rows].sort((a, b) => compareAttendanceQueueOrder(pick(a), pick(b)));
}
