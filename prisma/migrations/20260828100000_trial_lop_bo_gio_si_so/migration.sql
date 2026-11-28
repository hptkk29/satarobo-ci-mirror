-- Lớp trải nghiệm BỎ giờ / sĩ số / giáo viên ở CẤP LỚP; ba thứ đó chuyển xuống BUỔI.
--
-- Chủ dự án 28/08: form tạo lớp chỉ còn "tên lớp (tự sinh) · cơ sở · khoá trải nghiệm";
-- giờ, phòng, giáo viên chọn khi THÊM BUỔI. `TrialClassSession` vốn đã có đủ ba cột
-- `startTime` / `endTime` / `roomId` / `teacherId` nên không phải thêm gì bên buổi.
--
-- NỚI RÀNG BUỘC, KHÔNG BỎ CỘT — nếp 2 pha của repo:
--   Pha A (bản này): cho phép NULL, thôi ghi giá trị mới. Lớp cũ giữ nguyên số liệu,
--                    code cũ đọc vẫn chạy ⇒ lùi được bằng cách revert code.
--   Pha B (sau, khi prod chạy ổn): mới DROP COLUMN.
-- Nới NOT NULL là thao tác mở rộng: không khoá bảng lâu, không mất dòng nào.
ALTER TABLE "TrialClassV2" ALTER COLUMN "startTime" DROP NOT NULL;
ALTER TABLE "TrialClassV2" ALTER COLUMN "endTime" DROP NOT NULL;
ALTER TABLE "TrialClassV2" ALTER COLUMN "capacity" DROP NOT NULL;

-- KHOÁ TRẢI NGHIỆM của lớp (= "khoá quan tâm" của khách). Cột TRẦN, không FK: cùng
-- nếp với `LeadChild.interestedCourseId`, và để xoá một khoá học cũ không kéo theo
-- việc phải dọn mọi lớp trải nghiệm đã đóng.
ALTER TABLE "TrialClassV2" ADD COLUMN "courseId" TEXT;
