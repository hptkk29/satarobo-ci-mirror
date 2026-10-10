/**
 * EL-04 — KHOÁ GHI TIẾN ĐỘ SAU HẠN (QĐ-CDA-05).
 *
 * Hàm thuần, `now` phải tiêm từ ngoài. Không `new Date()` trong hàm: biên của luật
 * này là một mốc thời gian, và một hàm tự đọc giờ máy thì không viết nổi test biên.
 *
 * ─── Hạn chót "có hiệu lực" nghĩa là gì ở giai đoạn này ──────────────────────
 * Giờ học tự chọn + hạn chót cứng + CHƯA gắn chế tài ⇒ "hiệu lực" trên thực tế là
 * NGƯNG GHI TIẾN ĐỘ + ghi nhận trễ trong báo cáo gửi quản lý trực tiếp, KHÔNG phải
 * hệ quả nhân sự. Đây là trạng thái có chủ đích, và phải nói rõ với người học ngay
 * từ thông báo đầu tiên — không nói thì hạn chót mất uy tín sau đợt trễ đầu mà
 * chẳng ai bị gì.
 */

/**
 * MÃ LỖI DUY NHẤT cho tình huống này.
 *
 * Đặc tả dùng hai tên ở hai chỗ — `OVERDUE_LOCKED` và `DUE_PASSED`. Hai tên cho
 * một tình huống nghĩa là client bắt một mã còn server trả mã kia, và nhánh xử lý
 * lỗi chết câm. Chọn một, khai ở đây, mọi nơi import từ đây.
 */
export const OVERDUE_LOCKED = "OVERDUE_LOCKED";

/**
 * Câu chữ hiện cho người học — NGUYÊN VĂN, không biến thể.
 *
 * Cấm các biến thể kiểu "bạn sẽ bị nhắc nhở" hay "ảnh hưởng đánh giá": ở giai đoạn
 * này chưa có chế tài nào, và doạ một hệ quả không tồn tại là cách nhanh nhất làm
 * người ta hết tin mọi thông báo khác của hệ thống.
 */
export const OVERDUE_LOCKED_MESSAGE =
  "Đã quá hạn — liên hệ Đào tạo để được gia hạn";

/**
 * Có khoá đường ghi tiến độ không.
 *
 * Ba điểm dễ sai, cả ba đều làm test đỏ:
 *
 * 1. Biên là `now > dueAt`, KHÔNG phải `>=`. Đúng mốc `dueAt` vẫn còn được ghi —
 *    hạn chót là "hết ngày đó", không phải "trước ngày đó".
 * 2. Đọc `dueAt` (gia hạn được), KHÔNG phải `dueAtOriginal` (bất biến, chỉ dùng
 *    cho chỉ số đúng-hạn). Đọc nhầm cột thì gia hạn xong vẫn bị khoá, và người
 *    vận hành sẽ nghĩ nút gia hạn hỏng.
 * 3. Khoá theo `dueAt`, TUYỆT ĐỐI KHÔNG theo `status = 'OVERDUE'`. Flip sang
 *    OVERDUE là việc của cron; khoá theo trạng thái nghĩa là hạn chót chỉ có hiệu
 *    lực sau khi cron chạy — trễ tới 24 giờ, và trong 24 giờ đó luật không tồn tại.
 */
export function isProgressWriteLocked(input: {
  /** Hạn HIỆN HÀNH của lượt ghi danh. null = không có hạn ⇒ không khoá. */
  dueAt: Date | null;
  /** Hiệu dụng — dùng `effectiveAllowLate()` để suy, đừng đọc thẳng từ lượt giao. */
  allowLate: boolean;
  now: Date;
}): boolean {
  if (input.dueAt == null) return false;
  if (input.allowLate) return false;
  return input.now.getTime() > input.dueAt.getTime();
}

/**
 * `allowLate` HIỆU DỤNG của một lượt ghi danh.
 *
 * 🔴 FAIL-CLOSED: lượt KHÔNG sinh từ lượt giao (`assignmentId == null` — công nhận
 * tương đương, auto từ yêu cầu đào tạo, tự ghi danh) thì `allowLate = false`.
 *
 * Viết `assignment?.allowLate ?? true` là ĐẢO NGƯỢC cả quyết định: mọi lượt không
 * gắn lượt giao sẽ được học vô hạn sau hạn, và đó lại đúng là nhóm lượt sinh tự
 * động — tức nhóm đông nhất.
 */
export function effectiveAllowLate(input: {
  assignmentId: string | null;
  /** Cờ trên lượt giao. Không có lượt giao thì giá trị này vô nghĩa. */
  assignmentAllowLate: boolean | null | undefined;
}): boolean {
  if (input.assignmentId == null) return false;
  return input.assignmentAllowLate === true;
}
