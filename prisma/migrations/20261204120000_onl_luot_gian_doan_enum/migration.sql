-- P0 Mobile (Agent E) — lượt làm bài bị GIÁN ĐOẠN bởi Admin thu hồi quyền. Chỉ THÊM giá trị enum (additive); tách riêng khỏi migration có bảng mới.
ALTER TYPE "OnlAttemptStatus" ADD VALUE IF NOT EXISTS 'INTERRUPTED';
