-- V8.34 — COMMERCE v2: GIỎ HÀNG ĐÃ LƯU (vòng 1: ONLINE_COURSE; khung PHYSICAL_GOOD). CHỈ THÊM: 2 bảng mới + 1 cột `Product.sellOnline` (mặc định FALSE). Không đổi/xoá cột nào, không backfill.
-- CHẠY LẠI ĐƯỢC (luật [MIG-01]): mọi câu IF NOT EXISTS / khối DO bắt duplicate_object. Không phụ thuộc migration V8.29 (20261211).

CREATE TABLE IF NOT EXISTS "Cart" (
    "id"                   TEXT NOT NULL,
    "parentUserId"         TEXT NOT NULL,
    "revision"             INTEGER NOT NULL DEFAULT 0,
    "lastCheckoutRevision" INTEGER,
    "lastCheckoutOrderId"  TEXT,
    "createdAt"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Cart_parentUserId_key" ON "Cart"("parentUserId");

CREATE TABLE IF NOT EXISTS "CartItem" (
    "id"             TEXT NOT NULL,
    "cartId"         TEXT NOT NULL,
    "itemType"       TEXT NOT NULL,
    "onlineCourseId" TEXT,
    "productId"      TEXT,
    "studentId"      TEXT,
    "quantity"       INTEGER NOT NULL DEFAULT 1,
    "maGiamGia"      TEXT,
    "donGiaLucThem"  INTEGER,
    "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id"),
    -- LOẠI TRỪ OFFLINE LÀ CẤU TRÚC: chỉ hai loại Online; không có FK tới Course/CoursePackage/Exam ở bảng này.
    CONSTRAINT "CartItem_itemType_check" CHECK ("itemType" IN ('ONLINE_COURSE', 'PHYSICAL_GOOD')),
    -- đúng MỘT FK theo loại; khoá Online: học viên bắt buộc + số lượng 1; hàng vật lý: số lượng >= 1
    CONSTRAINT "CartItem_theo_loai_check" CHECK (
      ("itemType" = 'ONLINE_COURSE' AND "onlineCourseId" IS NOT NULL AND "productId" IS NULL AND "studentId" IS NOT NULL AND "quantity" = 1)
      OR ("itemType" = 'PHYSICAL_GOOD' AND "productId" IS NOT NULL AND "onlineCourseId" IS NULL AND "quantity" >= 1)
    )
);
CREATE INDEX IF NOT EXISTS "CartItem_cartId_idx" ON "CartItem"("cartId");
CREATE INDEX IF NOT EXISTS "CartItem_onlineCourseId_idx" ON "CartItem"("onlineCourseId");
CREATE INDEX IF NOT EXISTS "CartItem_studentId_idx" ON "CartItem"("studentId");
-- Chỉ mục TỪNG PHẦN (Prisma không biểu diễn được WHERE): một (khoá × con) một lần/giỏ; một sản phẩm một dòng/giỏ.
CREATE UNIQUE INDEX IF NOT EXISTS "CartItem_online_cap_key" ON "CartItem"("cartId", "onlineCourseId", "studentId") WHERE "itemType" = 'ONLINE_COURSE';
CREATE UNIQUE INDEX IF NOT EXISTS "CartItem_product_key" ON "CartItem"("cartId", "productId") WHERE "itemType" = 'PHYSICAL_GOOD';

DO $$ BEGIN
  ALTER TABLE "Cart" ADD CONSTRAINT "Cart_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_onlineCourseId_fkey" FOREIGN KEY ("onlineCourseId") REFERENCES "OnlCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Cart" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CartItem" ENABLE ROW LEVEL SECURITY;

-- Cờ «được bán Online» cho hàng vật lý (mặc định TẮT; chưa có đường nào bật ở vòng này).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sellOnline" BOOLEAN NOT NULL DEFAULT false;
