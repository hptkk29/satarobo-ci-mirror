// A2 — Nguồn chân lý DUY NHẤT cho "học viên đang thuộc lớp" (hiển thị/đếm).
//
// Hai hệ status từng lẫn lộn: legacy ACTIVE và D5 (CONFIRMED/STUDYING/PAUSED).
// Chốt deal + đăng ký tạo enrollment status = CONFIRMED → phải nằm trong bộ này
// thì điểm danh / sĩ số mới thấy. PAUSED = tạm dừng nhưng VẪN thuộc lớp (giữ
// hiển thị). File THƯỜNG (không "use server") để được export const an toàn.
import type { EnrollmentStatus } from "@prisma/client";

export const ENROLLMENT_ACTIVE_STATUSES = [
  "ACTIVE",
  "CONFIRMED",
  "STUDYING",
  "PAUSED",
] as const satisfies readonly EnrollmentStatus[];

// Dạng mutable để dùng trực tiếp trong Prisma `{ in: [...] }` không cần spread.
export const ENROLLMENT_ACTIVE_STATUS_LIST: EnrollmentStatus[] = [
  ...ENROLLMENT_ACTIVE_STATUSES,
];

/**
 * Ghi danh đang HỌC THẬT (khác `ENROLLMENT_ACTIVE_STATUSES`: bộ kia còn gồm CONFIRMED
 * "đã xếp chưa bắt đầu" và PAUSED "bảo lưu nhưng vẫn thuộc lớp").
 *
 * ⚠️ PHẢI CÓ `ACTIVE`: đó là giá trị MẶC ĐỊNH của `Enrollment.status` trong schema và là
 * thứ hai đường convert lead (`lib/crm/convert-lead.ts`, `convert-lead-v2.ts`, kể cả
 * bulk-convert) sinh ra vì chúng KHÔNG truyền `status` ⇒ phần lớn học viên THẬT mang
 * `ACTIVE`, không phải `STUDYING`. Chốt cứng vào riêng `STUDYING` là nguồn của bug
 * 21/08/2026 (nghỉ học không gỡ khỏi lớp; bảo lưu không bấm được).
 *
 * File này KHÔNG import `@/lib/db` nên client component dùng được — đừng chuyển hằng số
 * này sang `lib/students/lifecycle.ts` (bên đó kéo Prisma vào bundle).
 */
export const STUDYING_ENROLLMENT_STATUSES: EnrollmentStatus[] = ["STUDYING", "ACTIVE"];
