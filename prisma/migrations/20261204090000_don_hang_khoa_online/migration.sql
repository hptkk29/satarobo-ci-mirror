-- WORKSTREAM A — ĐƠN HÀNG KHOÁ E-LEARNING ONLINE (20/11/2026). CHỈ CỘNG THÊM, không đụng dữ liệu đang có.
-- Chạy lại được (luật [MIG-01]): ADD VALUE IF NOT EXISTS, CREATE TYPE bọc pg_type, bảng/chỉ mục IF NOT EXISTS, FK bọc pg_constraint.
--
--  1. OrderType.ONLINE + OrderItemType.ONLINE_COURSE — đơn/dòng đơn của khoá Online. Quyền học KHÔNG sinh từ Enrollment/lớp mà từ
--     `capQuyenHoc` (E-learning Online sở hữu); các đường offline lọc theo `type` nên bỏ qua dòng này.
--     ⚠️ Giá trị enum mới KHÔNG được dùng trong cùng giao dịch với ALTER TYPE — file này không dùng nó.
--  2. OrderItem.onlineCourseId — khoá Online của dòng (đơn vị mua = cặp onlineCourseId × studentId). Cột trần + chỉ mục, KHÔNG khoá ngoại (lý do bên dưới).
--  3. OrderOnlineGrant — HÀNG ĐỢI + SỔ ĐỐI SOÁT cấp quyền: một dòng cho MỖI dòng đơn Online. PENDING → GRANTED (đã gọi capQuyenHoc ok)
--     / REJECTED (lỗi luật, KHÔNG thử lại, kế toán/CSKH xử lý tiền) / NEEDS_REVIEW (thử quá số lần). Cron + hook sau thu đủ đều đọc bảng này.
-- Không backfill. Bảng mới bật RLS (chỉ ENABLE, không policy — như mọi bảng mới của repo).
-- Rollback (chỉ khi chưa có dữ liệu thật): gỡ bảng OrderOnlineGrant, gỡ cột OrderItem.onlineCourseId. Giá trị enum không gỡ được — vô hại.

ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'ONLINE';
ALTER TYPE "OrderItemType" ADD VALUE IF NOT EXISTS 'ONLINE_COURSE';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlineGrantStatus') THEN CREATE TYPE "OnlineGrantStatus" AS ENUM ('PENDING', 'GRANTED', 'REJECTED', 'NEEDS_REVIEW'); END IF;
END $$;

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "onlineCourseId" TEXT;
CREATE INDEX IF NOT EXISTS "OrderItem_onlineCourseId_idx" ON "OrderItem"("onlineCourseId");
-- CỐ Ý không có khoá ngoại từ "OrderItem"."onlineCourseId" tới "OnlCourse": bộ dọn test của E-learning Online chạy TRUNCATE "OnlCourse" ... CASCADE, và FK này sẽ
-- kéo "OrderItem" (rồi "Payment"…) vào đợt dọn. Toàn vẹn do dịch vụ giữ; "OrderOnlineGrant"."courseId" CÓ khoá ngoại.

CREATE TABLE IF NOT EXISTS "OrderOnlineGrant" (
  "id" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "status" "OnlineGrantStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "lastError" TEXT,
  "entitlementId" TEXT,
  "nextRetryAt" TIMESTAMPTZ(6),
  "grantedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "OrderOnlineGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderOnlineGrant_attempts_chk" CHECK ("attempts" >= 0),
  CONSTRAINT "OrderOnlineGrant_granted_chk" CHECK ("status" <> 'GRANTED' OR ("entitlementId" IS NOT NULL AND "grantedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrderOnlineGrant_orderItemId_key" ON "OrderOnlineGrant"("orderItemId");
CREATE INDEX IF NOT EXISTS "OrderOnlineGrant_status_nextRetryAt_idx" ON "OrderOnlineGrant"("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "OrderOnlineGrant_orderId_idx" ON "OrderOnlineGrant"("orderId");
CREATE INDEX IF NOT EXISTS "OrderOnlineGrant_studentId_courseId_idx" ON "OrderOnlineGrant"("studentId", "courseId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderOnlineGrant_orderItemId_fkey') THEN ALTER TABLE "OrderOnlineGrant" ADD CONSTRAINT "OrderOnlineGrant_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderOnlineGrant_studentId_fkey') THEN ALTER TABLE "OrderOnlineGrant" ADD CONSTRAINT "OrderOnlineGrant_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderOnlineGrant_courseId_fkey') THEN ALTER TABLE "OrderOnlineGrant" ADD CONSTRAINT "OrderOnlineGrant_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "OnlCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

ALTER TABLE "OrderOnlineGrant" ENABLE ROW LEVEL SECURITY;
