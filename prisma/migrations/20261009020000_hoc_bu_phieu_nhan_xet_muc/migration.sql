-- T16b (Học bù · phiếu nhận xét theo bài) — CHỈ THÊM một cột, không đổi / xoá gì đang có.
--
-- Nhận xét của giáo viên cho MỘT bài của bé ở buổi bù nay là PHIẾU (đánh giá chung + bảng năng lực 9 tiêu chí, xuất PDF) như
-- phiếu nhận xét buổi học ở site giáo viên, không còn là một ô chữ. Đánh giá chung vẫn nằm ở `teacherEvaluation` (mọi nơi đang đọc cột đó —
-- màn buổi gốc, cổng phụ huynh, thông báo — chạy tiếp không đổi); bảng năng lực là cột MỚI này.
--
-- NULLABLE, không default, không backfill: mục cũ chỉ có chữ ⇒ NULL ("chưa chấm bảng"). Chạy lại được.
ALTER TABLE "MakeupCaseStudent" ADD COLUMN IF NOT EXISTS "evaluationRubric" JSONB;
