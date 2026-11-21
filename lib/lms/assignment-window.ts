// lib/lms/assignment-window.ts — CỬA NỘP BÀI của một Assignment (site GV 25/08).
//
// NGUỒN SỰ THẬT DUY NHẤT cho câu hỏi "bài này lúc này còn nộp được không". Cổng phụ
// huynh (chặn nộp), màn GV (nhãn trạng thái) và mọi màn sau đều phải hỏi qua đây —
// hai chỗ tự suy lấy là hai chỗ sẽ lệch nhau, và cái lệch đó rơi đúng vào lúc phụ
// huynh không nộp được trong khi màn GV vẫn ghi "Đang mở".
//
// ⚠️ TRẠNG THÁI SUY LÚC ĐỌC, KHÔNG GHI XUỐNG DB. Không cron nào đổi `Assignment.status`
// khi quá hạn (cron `assignment-due-soon` đọc model KHÁC — HomeworkAssignment). Suy lúc
// đọc thì luật có hiệu lực NGAY tại mốc hạn; ghi bằng cron thì luật chỉ có hiệu lực sau
// khi cron chạy — trễ tới 24 giờ, và trong 24 giờ đó luật coi như không tồn tại.
//
// THUẦN: `now` tiêm từ ngoài, không đọc đồng hồ máy bên trong — biên của luật này là
// một mốc thời gian, hàm tự đọc giờ thì không viết nổi test biên.
//
// ⚠️ TIMEZONE: chỉ so sánh Date tuyệt đối (`getTime()`). Vercel chạy UTC, máy dev +07 —
// mọi phép `new Date(y,m,d)`/`getDay()` ở đây là bug "chạy máy tôi thì được". Phần đổi
// sang ĐỒNG HỒ VN chỉ để HIỂN THỊ và đi qua `vnParts()` của lib/time/vn.ts.
import type { AssignmentStatus } from "@prisma/client";
import { vnParts } from "@/lib/time/vn";

export type AssignmentWindowState =
  | "draft" // chưa giao — HV chưa thấy bài
  | "open" // trong hạn
  | "late-open" // quá hạn nhưng GV đã mở cửa nộp bù
  | "closed" // hết hạn (tự đóng) hoặc bị đóng tay
  | "archived";

export interface AssignmentWindow {
  state: AssignmentWindowState;
  /** Cổng phụ huynh có được nhận bài lúc `now` không. */
  acceptsSubmission: boolean;
  /** Nộp NGAY LÚC NÀY thì có tính trễ không (luôn đối chiếu `dueAt`, không phải `lateUntil`). */
  countsAsLate: boolean;
  /** Nhãn ngắn, KHÔNG kèm giờ — kèm giờ thì dùng `assignmentWindowLabel()`. */
  label: string;
  /**
   * Mốc kết thúc của trạng thái hiện tại, để câu thông báo nói được "đến/lúc mấy giờ":
   * open → hạn nộp · late-open → hạn nộp bù · closed → cái hạn đã đóng nó
   * (`lateUntil` nếu từng gia hạn, không thì `dueAt`). null = không có mốc nào.
   */
  until: Date | null;
}

export interface AssignmentWindowInput {
  status: AssignmentStatus;
  dueAt: Date | null;
  /** Cửa nộp bù GV mở (`Assignment.lateUntil`). null = chưa gia hạn / đã thu hồi. */
  lateUntil: Date | null;
}

/**
 * Hạn nộp trước mốc này coi như KHÔNG CÓ HẠN.
 *
 * Một số bài seed để `dueAt` = epoch 1970 và màn GV vốn đã lọc bằng `getFullYear() >= 2000`
 * để không in ra "01/01/1970". Nếu ở đây không lọc y hệt thì toàn bộ đám bài đó chuyển
 * "Đã đóng" ngay ngày tính năng này lên — GV mất quyền nhận bài mà không hiểu vì sao.
 */
const MIN_REAL_DUE_MS = Date.UTC(2000, 0, 1);

const LABEL: Record<AssignmentWindowState, string> = {
  draft: "Nháp",
  open: "Đang mở",
  "late-open": "Nộp trễ",
  closed: "Đã đóng",
  archived: "Lưu trữ",
};

/**
 * Hạn nộp THẬT, hoặc null nếu bài coi như không đặt hạn (chưa đặt / sentinel 1970).
 *
 * Export vì bộ lọc này phải giống nhau ở BA nơi: hàm dưới, cột "Hạn nộp" của màn GV
 * (`buildAssignmentWindowView`) và cờ "Quá hạn" của cổng PH. Mỗi nơi tự gõ lại
 * `Date.UTC(2000, 0, 1)` là nơi thứ tư sẽ quên, và lúc đó PH thấy "Hạn 01/01/1970".
 */
export function realDueAt(dueAt: Date | null): Date | null {
  if (dueAt == null) return null;
  return dueAt.getTime() >= MIN_REAL_DUE_MS ? dueAt : null;
}

/**
 * Cửa nộp bài lúc `now`.
 *
 * ─── QUYẾT ĐỊNH: `status = CLOSED` LƯU TRONG DB THẮNG, cửa gia hạn KHÔNG lấn qua ───
 * Yêu cầu của chủ dự án là "quá hạn thì tự đóng, nhưng có nút mở để GV cho nộp bù" —
 * cái tự đóng ấy là trạng thái SUY (`dueAt` trôi qua), nên nút gia hạn vẫn thắng nó
 * hoàn toàn. Còn CLOSED nằm trong cột là do NGƯỜI đóng tay (màn admin
 * `changeAssignmentStatus`), và người thì phải thắng.
 *
 * Vì vậy `grantLateWindowAction` lật CLOSED → PUBLISHED NGAY TRONG CÙNG lệnh ghi
 * `lateUntil` (một `update`, không có khoảng hở). Cách còn lại — để hàm này coi
 * `lateUntil` tương lai là đè được CLOSED — bị loại vì nó đẻ ra lỗ câm: admin đóng bài
 * bằng tay xong bài vẫn nhận bài nộp chỉ vì còn sót cửa gia hạn cũ, và admin không có
 * đường nào tắt được cửa ấy.
 *
 * Đối xứng ở đường THU HỒI: bài không có `dueAt` thì xoá `lateUntil` KHÔNG đóng được gì
 * (nhánh dưới cho ra "mở mãi"), nên `revokeLateWindowAction` phải ghi lại
 * `status = CLOSED` cho riêng nhóm bài đó — sửa một đầu mà quên đầu kia là nút "Thu hồi"
 * làm ngược đúng điều nó hứa.
 */
export function assignmentWindow(
  a: AssignmentWindowInput,
  now: Date = new Date(),
): AssignmentWindow {
  const due = realDueAt(a.dueAt);

  if (a.status === "DRAFT") {
    return { state: "draft", acceptsSubmission: false, countsAsLate: false, label: LABEL.draft, until: null };
  }
  if (a.status === "ARCHIVED") {
    return { state: "archived", acceptsSubmission: false, countsAsLate: false, label: LABEL.archived, until: null };
  }
  if (a.status === "CLOSED") {
    return {
      state: "closed",
      acceptsSubmission: false,
      countsAsLate: false,
      label: LABEL.closed,
      until: a.lateUntil ?? due,
    };
  }

  // ─── PUBLISHED, KHÔNG có hạn nộp thật ──────────────────────────────────────────
  // Chưa gia hạn → mở mãi. Giữ nguyên hành vi cũ: bài không đặt hạn nộp vốn vẫn nhận
  // bài, siết lại là âm thầm chặn một đống bài đang chạy.
  //
  // NHƯNG có `lateUntil` thì nó CHÍNH LÀ mốc đóng của bài. Đường duy nhất ghi được cột
  // này là nút "Mở nộp bù" của GV, mà nút đó chỉ hiện trên bài ĐANG ĐÓNG — với bài
  // không hạn thì "đang đóng" nghĩa là admin đã đóng tay (`status = CLOSED`), và
  // `grantLateWindowAction` lật nó về PUBLISHED trong cùng lệnh ghi. Bỏ qua `lateUntil`
  // ở đây (lỗi cũ) thì bài đó thành mở VĨNH VIỄN, lại rơi vào state "open" nên
  // `canExtend` tắt: nút gia hạn biến mất kèm luôn nút thu hồi, không còn đường nào
  // đóng bài lại ngoài màn admin.
  if (due == null) {
    if (a.lateUntil == null) {
      return { state: "open", acceptsSubmission: true, countsAsLate: false, label: LABEL.open, until: null };
    }
    if (now.getTime() <= a.lateUntil.getTime()) {
      return {
        state: "late-open",
        acceptsSubmission: true,
        // Không có `dueAt` thì không có mốc nào để trễ — bài nộp trong cửa này vào học
        // bạ là SUBMITTED chứ không phải LATE (`assignmentWindowLabel` cũng đổi chữ
        // theo cờ này để pill không nói "Nộp trễ" về một cái hạn không tồn tại).
        countsAsLate: false,
        label: LABEL["late-open"],
        until: a.lateUntil,
      };
    }
    return {
      state: "closed",
      acceptsSubmission: false,
      countsAsLate: false,
      label: LABEL.closed,
      until: a.lateUntil,
    };
  }

  // Biên là `>` chứ không phải `>=`: đúng phút hạn vẫn còn nộp được ("hết hạn LÚC 23:59"
  // nghĩa là 23:59 vẫn kịp). Khớp `isLateSubmission` và `isProgressWriteLocked`.
  if (now.getTime() <= due.getTime()) {
    return { state: "open", acceptsSubmission: true, countsAsLate: false, label: LABEL.open, until: due };
  }

  // Quá hạn: còn cửa nộp bù thì mở tiếp, nhưng bài nộp vẫn là LATE (đối chiếu `dueAt`)
  // — học bạ không được mất dấu nộp trễ chỉ vì GV gia hạn. Biên `<=` giống trên.
  if (a.lateUntil != null && now.getTime() <= a.lateUntil.getTime()) {
    return {
      state: "late-open",
      acceptsSubmission: true,
      countsAsLate: true,
      label: LABEL["late-open"],
      until: a.lateUntil,
    };
  }

  return {
    state: "closed",
    acceptsSubmission: false,
    countsAsLate: false,
    label: LABEL.closed,
    until: a.lateUntil ?? due,
  };
}

/** "dd/MM HH:mm" theo ĐỒNG HỒ VN — dùng cho nhãn/thông báo, không dùng để so sánh. */
export function formatVnShort(d: Date): string {
  const p = vnParts(d);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(p.day)}/${two(p.month + 1)} ${two(p.hour)}:${two(p.minute)}`;
}

/** Nhãn đầy đủ cho pill trạng thái: "Nộp trễ đến 26/08 17:00", còn lại giữ `label`. */
export function assignmentWindowLabel(w: AssignmentWindow): string {
  if (w.state === "late-open" && w.until) {
    // Bài không có hạn nộp gốc (`countsAsLate` tắt) mà gắn chữ "Nộp trễ" là nói sai với
    // GV: không có mốc nào để trễ, và bài nộp trong cửa này KHÔNG vào học bạ dạng LATE.
    return `${w.countsAsLate ? "Nộp trễ" : "Nhận bài"} đến ${formatVnShort(w.until)}`;
  }
  return w.label;
}

/**
 * Date → chuỗi cho `<input type="datetime-local">` THEO GIỜ VN ("YYYY-MM-DDTHH:mm").
 *
 * Phải dựng ở SERVER rồi truyền xuống client: `toISOString().slice(0,16)` là giờ UTC
 * (lệch 7 tiếng), còn để client tự đổi thì máy đặt lệch múi giờ sẽ ra một giờ khác với
 * giờ server đọc lại chuỗi đó (`parseDateTime` trong _actions.ts hiểu chuỗi là +07:00).
 */
export function toVnDateTimeInput(d: Date): string {
  const p = vnParts(d);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month + 1)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}
