-- 20261219090000_yeu_cau_xoa_tai_khoan — YÊU CẦU XOÁ TÀI KHOẢN từ app di động (W-CONTRACT CRITICAL-1; NĐ 13/2023, App Store 5.1.1(v)).
-- CHỈ THÊM một bảng mới, chạy lại được (IF NOT EXISTS). Không sửa bảng nào đang có dữ liệu. Không backfill. Bảng chỉ GHI NHẬN yêu cầu — không xoá/ẩn danh gì;
-- pháp chế xử lý ngoài luồng này. Không khoá ngoại tới "User" và không centerId/orgUnitId: bản ghi gắn với MỘT người dùng (cùng nếp "MobileSession").
-- Hoàn tác (chỉ khi bảng còn rỗng): xoá bảng "AccountDeletionRequest".

CREATE TABLE IF NOT EXISTS "AccountDeletionRequest" (
    "id"          TEXT           NOT NULL,
    "userId"      TEXT           NOT NULL,
    "lyDo"        TEXT,
    "status"      TEXT           NOT NULL DEFAULT 'RECEIVED',
    "nguon"       TEXT           NOT NULL DEFAULT 'MOBILE_APP',
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt"   TIMESTAMPTZ(6),
    "handledById" TEXT,
    "handledNote" TEXT,
    "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountDeletionRequest_status_check" CHECK ("status" IN ('RECEIVED', 'IN_REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT "AccountDeletionRequest_ly_do_check" CHECK ("lyDo" IS NULL OR char_length("lyDo") <= 500)
);

CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_userId_status_idx" ON "AccountDeletionRequest"("userId", "status");
CREATE INDEX IF NOT EXISTS "AccountDeletionRequest_status_requestedAt_idx" ON "AccountDeletionRequest"("status", "requestedAt");

ALTER TABLE "AccountDeletionRequest" ENABLE ROW LEVEL SECURITY;
