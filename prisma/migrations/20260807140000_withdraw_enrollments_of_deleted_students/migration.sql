-- Vá dữ liệu 07/08/2026 — "học viên ma trong lớp".
--
-- Triệu chứng: xoá học viên ở /admin/students xong, lớp học VẪN còn tên học viên đó
-- (trang Học sinh của lớp, tab Học viên site GV, bảng điểm danh, sĩ số), thậm chí vẫn
-- gửi thông báo điểm danh cho phụ huynh.
--
-- Nguyên nhân: `deleteStudent` chỉ soft-delete bảng "Student" mà không đụng "Enrollment",
-- trong khi mọi màn "học viên của lớp" đọc TỪ Enrollment → student. Gốc đã vá ở
-- lib/students/remove-from-classes.ts (gỡ khỏi lớp trong cùng transaction). Migration này
-- dọn các bản ghi đã lỡ sinh ra trước bản vá.
--
-- ⚠️ CHỈ đổi "status", KHÔNG đụng "deletedAt": deletedAt của Enrollment là soft-delete
-- TÀI CHÍNH — lib/finance/debt.ts lọc `deletedAt: null` và KHÔNG lọc status, nên set
-- deletedAt sẽ rút khoản phải thu ra khỏi công nợ. Đổi status giữ nguyên sổ sách, chỉ gỡ
-- học viên khỏi các danh sách lớp.
--
-- PENDING (chưa từng xếp lớp) → CANCELLED; còn lại → WITHDREW, khớp state machine
-- ENROLLMENT_TRANSITIONS (lib/enrollments/status.ts). Idempotent: chạy lại không đổi gì.
UPDATE "Enrollment" e
SET    "status" = CASE WHEN e."status" = 'PENDING'
                       THEN 'CANCELLED'::"EnrollmentStatus"
                       ELSE 'WITHDREW'::"EnrollmentStatus" END,
       "updatedAt" = now()
FROM   "Student" s
WHERE  s."id" = e."studentId"
  AND  s."deletedAt" IS NOT NULL
  AND  e."deletedAt" IS NULL
  AND  e."status" IN ('PENDING', 'CONFIRMED', 'STUDYING', 'ACTIVE', 'PAUSED');
