-- 18/11/2026 — P6 (D1): THÊM 5 giá trị vào enum TrnQuestionType. Migration RIÊNG — không dùng giá trị mới ở đây (PostgreSQL không cho dùng giá trị enum vừa ADD trong cùng giao dịch).
-- ADD-only: 9 giá trị cũ giữ nguyên thứ tự và nghĩa. Thêm giá trị KHÔNG mở loại câu nào cho người dùng: `LOAI_CHUA_MO` + `duocVaoDe` vẫn quyết định loại nào vào đề/chấm được.
ALTER TYPE "TrnQuestionType" ADD VALUE IF NOT EXISTS 'CLASSIFY';
ALTER TYPE "TrnQuestionType" ADD VALUE IF NOT EXISTS 'IMAGE_HOTSPOT';
ALTER TYPE "TrnQuestionType" ADD VALUE IF NOT EXISTS 'NUMERIC';
ALTER TYPE "TrnQuestionType" ADD VALUE IF NOT EXISTS 'PRODUCT';
ALTER TYPE "TrnQuestionType" ADD VALUE IF NOT EXISTS 'BLOCK_SEQUENCE';
