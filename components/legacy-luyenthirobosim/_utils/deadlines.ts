/**
 * Hạn ưu đãi hiển thị trên landing = hạn của chương trình hợp nhất
 * "Ưu đãi Khai giảng Sata Robo 2026" — nguồn duy nhất là lib/uu-dai.ts.
 *
 * Trước 18/08/2026 chỗ này đếm tới mốc tự reset mỗi Chủ nhật, nên thanh
 * countdown và câu "ưu đãi kết thúc hết ngày ..." trong popup nói hai mốc
 * khác nhau. Nay cả hai cùng trỏ về PROGRAM_END (31/12/2026).
 */
import { PROGRAM_END } from "@/lib/uu-dai";

export function getNextDeadline(): Date {
  return PROGRAM_END;
}

/**
 * Ngày diễn ra vòng loại RBT2026 — cố định 26/7.
 * Nếu đã qua 26/7 năm hiện tại → đếm tới 20/7 năm sau.
 */
export function getExamDate(): Date {
  const now = new Date();
  const year = now.getFullYear();
  const examThisYear = new Date(year, 6, 26, 0, 0, 0);
  return now > examThisYear
    ? new Date(year + 1, 6, 20, 0, 0, 0)
    : examThisYear;
}
