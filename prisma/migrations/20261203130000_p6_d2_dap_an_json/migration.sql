-- 18/11/2026 — P6 (D2): câu trả lời có CẤU TRÚC (nhập số, ghép cặp, sắp xếp, phân loại, vùng chọn, khối lệnh) và tệp đính kèm (nộp sản phẩm).
-- CHỈ THÊM cột NULLABLE, không backfill, không đổi nghĩa cột cũ (`selectedChoiceIds`, `textAnswer`). NULL = câu trả lời kiểu cũ (lượt thi trước P6 đọc như cũ).
ALTER TABLE "TrnExamAnswer" ADD COLUMN IF NOT EXISTS "answerJson" JSONB;
ALTER TABLE "TrnExamAnswer" ADD COLUMN IF NOT EXISTS "attachmentsJson" JSONB;
