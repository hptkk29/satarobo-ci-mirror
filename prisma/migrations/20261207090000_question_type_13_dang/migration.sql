-- 19/11/2026 — 4 dạng câu hỏi còn thiếu của thiết kế 13 dạng. CỘNG THÊM (giá trị enum), chạy lại được ([MIG-01]). Chạy TAY trên TEST/PROD (luật cứng #4).
-- Giá trị mới KHÔNG dùng được trong CHÍNH giao dịch này — vì vậy nằm trong migration RIÊNG, không kèm câu lệnh nào đọc/ghi chúng.
-- Không hoàn tác được từng giá trị (PostgreSQL không có DROP VALUE); chưa có dữ liệu nào dùng chúng thì vô hại.

ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'CLASSIFY';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'HOTSPOT';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'NUMERIC';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'BLOCK_PROGRAM';
