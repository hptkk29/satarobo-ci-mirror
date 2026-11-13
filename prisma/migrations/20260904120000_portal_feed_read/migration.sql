-- Phụ huynh ĐÃ ĐỌC một mục trên bảng tin portal.
--
-- `itemId` = id MỤC BẢNG TIN (v2 tổng hợp 7 nhóm, phần lớn không phải dòng
-- Notification), nên KHÔNG khai khoá ngoại.
--
-- THUẦN THÊM: tạo một bảng mới, KHÔNG đụng cột nào của bảng đang có dữ liệu
-- (luật cứng #4 Nền Hệ thống). Chạy lại nhiều lần không sao nhờ IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS "PortalFeedRead" (
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalFeedRead_pkey" PRIMARY KEY ("itemId","userId")
);

-- Badge đếm "chưa đọc" theo TỪNG phụ huynh trên mọi lượt mở portal ⇒ phải có index
-- theo userId, không thì mỗi lần tính badge là quét cả bảng.
CREATE INDEX IF NOT EXISTS "PortalFeedRead_userId_idx" ON "PortalFeedRead"("userId");
