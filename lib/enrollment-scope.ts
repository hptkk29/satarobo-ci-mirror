// lib/enrollment-scope.ts — MỘT chỗ duy nhất trả lời "ai đang trong lớp này".
//
// Vì sao file này tồn tại (QA site GV vòng 1, 28/08/2026 — nguyên nhân gốc RC-1):
// 22 truy vấn `enrollments: { where }` lồng trong app/(teacher) có tới NĂM hình dạng
// khác nhau — đủ 3 tầng lọc chỉ 5 chỗ, 2 tầng 3 chỗ, chỉ `status` 12 chỗ, chỉ
// `deletedAt` 2 chỗ. Hai chỗ trong CÙNG một file, cách nhau 9 dòng, đã lệch nhau
// (hub-sessions-tab.tsx). Hệ quả đo được trên UAT: "81 học viên" ở Tổng quan vs "103"
// ở trang Học viên, "Đã nộp 2/0" ở màn Chấm bài, và lớp đã kết khoá hiện
// "Lớp chưa có học viên đang học".
//
// ⚠️ GỐC SÂU, đừng quên khi thêm truy vấn mới: hook soft-delete của Prisma KHÔNG chạy
// cho nested include / _count (lib/db.ts). Nghĩa là mỗi chỗ đọc lồng phải TỰ nhớ đủ ba
// tầng; tỉ lệ nhớ đúng đo được là 23%. Đừng dựa vào hook — gọi hàm ở đây.
//
// BA TẦNG LỌC, luôn đi cùng nhau:
//   1. `status`             — ghi danh còn hiệu lực ở phạm vi đang hỏi;
//   2. `deletedAt: null`    — ghi danh chưa gỡ mềm (Enrollment.deletedAt là SỔ SÁCH:
//                             gỡ HV khỏi lớp phải đổi status, set deletedAt là tụt công nợ);
//   3. `student.deletedAt`  — hàng rào 2 (07/08): GV không được thấy HV đã xoá khỏi hệ thống.
//
// File THƯỜNG (không "use server"), chỉ `import type` từ @prisma/client ⇒ client
// component dùng được, không kéo Prisma vào bundle.
import type { EnrollmentStatus, Prisma } from "@prisma/client";

import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";

/**
 * Phạm vi ghi danh — đặt tên theo CÂU HỎI NGHIỆP VỤ, không theo tên status.
 *
 * • `dang-hoc`  — ai đang thuộc lớp lúc này. Mẫu số của sĩ số, điểm danh, nhận xét,
 *                 giao bài. Đây là phạm vi mặc định của gần như mọi màn.
 * • `ket-khoa`  — ai đã đi hết chặng: đang học CỘNG đã hoàn thành. Dùng cho màn
 *                 Hoàn thành khoá và bảng chấm bài của lớp đã kết thúc — hai chỗ mà
 *                 lọc `dang-hoc` làm dữ liệu biến mất đúng lúc cần nhất.
 *                 KHÔNG gồm WITHDREW: em nghỉ giữa chừng không phải "kết khoá".
 * • `lich-su`   — mọi ghi danh từng có hiệu lực, kể cả nghỉ học. Dùng cho hồ sơ học
 *                 viên và học bạ, nơi người dùng cần thấy cả quá khứ.
 *
 * KHÔNG phạm vi nào chứa `PENDING` (chờ xác nhận — chưa vào lớp), `CANCELLED`, hay
 * `TRANSFERRED` (đã chuyển đi nơi khác, thuộc về lớp mới chứ không phải lớp này).
 */
export type RosterScope = "dang-hoc" | "ket-khoa" | "lich-su";

const SCOPE_STATUSES: Record<RosterScope, EnrollmentStatus[]> = {
  "dang-hoc": ENROLLMENT_ACTIVE_STATUS_LIST,
  "ket-khoa": [...ENROLLMENT_ACTIVE_STATUS_LIST, "COMPLETED"],
  "lich-su": [...ENROLLMENT_ACTIVE_STATUS_LIST, "COMPLETED", "WITHDREW"],
};

/** Danh sách status của một phạm vi. Trả BẢN SAO — người gọi sửa cũng không hỏng nguồn. */
export function rosterStatuses(scope: RosterScope): EnrollmentStatus[] {
  return [...SCOPE_STATUSES[scope]];
}

/**
 * Mệnh đề `where` cho quan hệ `enrollments` — dùng ở MỌI chỗ đọc ghi danh.
 *
 * ⚠️ ĐỪNG viết lại ba tầng này tại chỗ, kể cả khi "chỉ cần status". Đó chính là cách
 * repo có 5 hình dạng khác nhau cho cùng một câu hỏi.
 *
 * @example
 *   const cls = await sdb.class.findUnique({
 *     where: { id },
 *     select: { enrollments: { where: rosterWhere("dang-hoc"), select: { ... } } },
 *   });
 */
export function rosterWhere(scope: RosterScope): Prisma.EnrollmentWhereInput {
  return {
    status: { in: rosterStatuses(scope) },
    deletedAt: null,
    student: { deletedAt: null },
  };
}

/**
 * Bản dùng cho DANH SÁCH ĐÃ NẠP SẴN (client component, mảng trong bộ nhớ) — cùng một
 * định nghĩa với `rosterWhere`, để màn hình lọc lại không lệch với truy vấn.
 *
 * Người gọi phải tự bảo đảm hàng đã kèm `deletedAt`; hàng thiếu trường đó được coi là
 * CHƯA xoá (đúng với `select` không lấy cột này), chứ không loại im lặng.
 */
export function inRosterScope(
  row: { status: EnrollmentStatus | string; deletedAt?: Date | string | null },
  scope: RosterScope,
): boolean {
  if (row.deletedAt) return false;
  return (rosterStatuses(scope) as string[]).includes(row.status);
}
