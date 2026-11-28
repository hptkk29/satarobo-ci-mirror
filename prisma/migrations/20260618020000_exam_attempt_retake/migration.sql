-- LMS-12 — thi lại: thêm attemptNo + đổi unique (examId, studentId) → (examId, studentId, attemptNo).
ALTER TABLE "ExamAttempt" ADD COLUMN "attemptNo" INTEGER NOT NULL DEFAULT 1;

-- Đổi ràng buộc duy nhất: cho phép nhiều lần làm/HV/đề (phân biệt bằng attemptNo).
DROP INDEX IF EXISTS "ExamAttempt_examId_studentId_key";
CREATE UNIQUE INDEX "ExamAttempt_examId_studentId_attemptNo_key"
  ON "ExamAttempt"("examId", "studentId", "attemptNo");
