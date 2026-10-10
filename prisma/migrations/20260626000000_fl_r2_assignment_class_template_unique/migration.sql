-- FL-R2 W5 (R2-LMS-4) — idempotent tự sinh Assignment từ AssignmentTemplate:
-- 1 template → tối đa 1 Assignment/lớp. templateId nullable → bài tạo tay
-- (templateId NULL) KHÔNG bị ràng (Postgres coi NULL là phân biệt). An toàn:
-- hiện 0 Assignment có templateId nên không xung đột khi tạo unique index.
CREATE UNIQUE INDEX "Assignment_classId_templateId_key" ON "Assignment"("classId", "templateId");
