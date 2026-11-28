-- V10.0 (Q5) — 8 dạng câu hỏi Online mở rộng. Chỉ THÊM giá trị enum (additive; không đổi dữ liệu có sẵn).
-- Tách riêng khỏi migration có bảng mới: giá trị enum mới không dùng được trong cùng giao dịch đã thêm nó.
ALTER TYPE "OnlQuestionType" ADD VALUE IF NOT EXISTS 'FILL_BLANK';
ALTER TYPE "OnlQuestionType" ADD VALUE IF NOT EXISTS 'MATCHING';
ALTER TYPE "OnlQuestionType" ADD VALUE IF NOT EXISTS 'ORDERING';
ALTER TYPE "OnlQuestionType" ADD VALUE IF NOT EXISTS 'CLASSIFY';
ALTER TYPE "OnlQuestionType" ADD VALUE IF NOT EXISTS 'IMAGE_HOTSPOT';
ALTER TYPE "OnlQuestionType" ADD VALUE IF NOT EXISTS 'NUMERIC';
ALTER TYPE "OnlQuestionType" ADD VALUE IF NOT EXISTS 'PRODUCT';
ALTER TYPE "OnlQuestionType" ADD VALUE IF NOT EXISTS 'BLOCK_SEQUENCE';
