// lib/classes/complete-class.ts — luật THUẦN cho việc ĐÓNG LỚP khi lớp dạy xong.
//
// Tách khỏi Server Action vì đây là phần duy nhất test được mà không cần DB, và vì
// cùng một phép chia phải cho ra CÙNG con số ở HAI nơi: hộp xác nhận trên màn lớp
// ("sẽ chuyển N em, bỏ qua M em") và chính lượt ghi. Hai nơi tự đếm lấy là cách chắc
// chắn nhất để người bấm thấy một số và hệ thống làm một số khác.
import type { EnrollmentStatus } from "@prisma/client";

/**
 * Các trạng thái ghi danh được COI LÀ "còn thuộc lớp" khi đóng lớp — cùng bộ mà
 * `cancelClassAction` dùng, để hai đường đóng lớp (Huỷ / Hoàn thành) nhìn thấy đúng
 * một tập học viên.
 */
export const CLASS_CLOSE_ENROLLMENT_STATUSES: EnrollmentStatus[] = [
  "CONFIRMED",
  "STUDYING",
  "ACTIVE",
  "PAUSED",
];

/**
 * Chỉ ghi danh ĐANG HỌC THẬT mới chuyển sang `COMPLETED`.
 *
 * ⚠️ `PAUSED` (bảo lưu) CỐ Ý nằm ngoài: `ENROLLMENT_TRANSITIONS` trong
 * `lib/enrollments/status.ts` không cho `PAUSED → COMPLETED` (em đang bảo lưu thì
 * chưa học xong), nên nhét vào đây sẽ bị `canTransition` chặn im lặng — người bấm
 * thấy "đã hoàn thành" mà số ghi danh đổi lại ít hơn. Bảo lưu phải kết thúc bảo lưu
 * trước, ở màn học viên.
 *
 * `CONFIRMED` (đã xếp lớp, chưa vào học) cũng nằm ngoài vì lý do nghiệp vụ: chưa học
 * buổi nào thì không có gì để hoàn thành.
 */
export const COMPLETABLE_ENROLLMENT_STATUSES: EnrollmentStatus[] = ["STUDYING", "ACTIVE"];

/** Nhãn tiếng Việt cho trạng thái bị bỏ qua — khớp nhãn ở /enrollments. */
const SKIPPED_LABEL: Partial<Record<EnrollmentStatus, string>> = {
  PENDING: "chờ xếp lớp",
  CONFIRMED: "đã xếp lớp, chưa vào học",
  PAUSED: "đang bảo lưu",
};

export type SkippedGroup = { status: EnrollmentStatus; label: string; count: number };

export type CompletionSplit<T> = {
  /** Ghi danh sẽ chuyển sang `COMPLETED` + được cấp chứng chỉ. */
  eligible: T[];
  /** Nhóm bị bỏ qua, gộp theo trạng thái, thứ tự ổn định để hiển thị. */
  skipped: SkippedGroup[];
};

/**
 * Chia danh sách ghi danh còn thuộc lớp thành "hoàn thành được" và "bỏ qua".
 *
 * Giữ nguyên thứ tự đầu vào cho `eligible`; `skipped` xếp theo thứ tự xuất hiện lần
 * đầu để hai lượt gọi trên cùng dữ liệu luôn in ra cùng một câu.
 */
export function splitEnrollmentsForCompletion<T extends { status: EnrollmentStatus }>(
  rows: readonly T[],
): CompletionSplit<T> {
  const eligible: T[] = [];
  const counts = new Map<EnrollmentStatus, number>();

  for (const row of rows) {
    if (COMPLETABLE_ENROLLMENT_STATUSES.includes(row.status)) {
      eligible.push(row);
      continue;
    }
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }

  const skipped: SkippedGroup[] = [...counts.entries()].map(([status, count]) => ({
    status,
    label: SKIPPED_LABEL[status] ?? status,
    count,
  }));

  return { eligible, skipped };
}

/** "2 em đang bảo lưu, 1 em đã xếp lớp, chưa vào học" — rỗng khi không bỏ qua ai. */
export function describeSkipped(skipped: readonly SkippedGroup[]): string {
  return skipped.map((g) => `${g.count} em ${g.label}`).join(", ");
}
