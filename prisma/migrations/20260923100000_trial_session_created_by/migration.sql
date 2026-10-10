-- Case trial: AI TẠO ra buổi này.
--
-- Chốt 23/09/2026 — trong một lớp trải nghiệm (một ngày × một khung giờ), nhiều Sale
-- cùng xếp "case" của mình. Không có cột này thì màn hình không trả lời được câu
-- "case này của ai", và luật "Sale chỉ sửa/xoá case của chính mình" không có gì để tựa.
--
-- NULLABLE và KHÔNG backfill: buổi tạo trước hôm nay không có nguồn nào đáng tin để
-- đoán người tạo. Đoán sai thì màn hình khoá nhầm nút sửa của đúng người cần sửa.
-- Đường đọc phải chịu được NULL và tự khai là "không rõ" (xem lib/trial/quyen-case.ts).
--
-- KHÔNG ràng FK sang "User" — cùng nếp với teacherId/assistantId của chính bảng này và
-- với TrialClassV2.createdById (migration 20260918120000): xoá một tài khoản cũ không
-- được phép kéo sập bản ghi buổi học.
ALTER TABLE "TrialClassSession" ADD COLUMN "createdById" TEXT;

CREATE INDEX "TrialClassSession_createdById_idx" ON "TrialClassSession"("createdById");
