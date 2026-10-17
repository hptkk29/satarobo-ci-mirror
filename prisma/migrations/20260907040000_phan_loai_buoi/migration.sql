-- PHÂN LOẠI BUỔI + gỡ trần 6 dòng của danh mục công dạy (07/09/2026).
-- Căn cứ: SR.QD.230 PL03 §4 (Coach 100% · ≤3 HV 75% · Workshop/Sự kiện 120%) và BA-CC-CD-001.
-- Toàn bộ ADDITIVE: 1 bảng mới, 2 cột nullable, 1 khoá nới rộng. Không cột nào bị bỏ.
--
-- VÌ SAO PHẢI NỚI KHOÁ: migration 20260907020000 đặt `unique(source, role)`. Nhìn thì là "mỗi
-- buổi ứng đúng một loại", nhưng hệ quả thật là TRẦN CỨNG 6 DÒNG (2 nguồn × 3 vai) — nên yêu cầu
-- "tự tạo tự add được qua hệ thống chứ không cần code" mới chỉ SỬA được hệ số, chưa THÊM được
-- dòng nào. Không có `categoryId` thì Workshop/Coach/bù/vượt vĩnh viễn không có chỗ đứng.

-- ── 1. Danh mục phân loại buổi ────────────────────────────────────────────────────────
CREATE TABLE "SessionCategory" (
  "id"                TEXT NOT NULL,
  "code"              TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "isDefault"         BOOLEAN NOT NULL DEFAULT false,
  "countsTowardQuota" BOOLEAN NOT NULL DEFAULT false,
  "isActive"          BOOLEAN NOT NULL DEFAULT true,
  "displayOrder"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "SessionCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SessionCategory_code_key" ON "SessionCategory"("code");

-- Đúng MỘT dòng mặc định. Ép ở DB chứ không ở action: dòng mặc định quyết định buổi chưa phân
-- loại được tính theo hệ số nào, hai dòng bật cùng lúc là số công dạy đổi theo thứ tự đọc.
CREATE UNIQUE INDEX "SessionCategory_one_default" ON "SessionCategory"(("isDefault")) WHERE "isDefault";

-- ── 2. Buổi học mang phân loại ────────────────────────────────────────────────────────
-- NULLABLE có chủ đích: mọi buổi đã có trên hệ thống không ai đi gán lại được, và ép NOT NULL là
-- chặn cứng mọi đường tạo buổi đang chạy (xếp lịch lớp, dời buổi, tạo bù). null ⇒ dùng dòng mặc định.
ALTER TABLE "ClassSession" ADD COLUMN "sessionCategoryId" TEXT;
CREATE INDEX "ClassSession_sessionCategoryId_idx" ON "ClassSession"("sessionCategoryId");
ALTER TABLE "ClassSession"
  ADD CONSTRAINT "ClassSession_sessionCategoryId_fkey"
  FOREIGN KEY ("sessionCategoryId") REFERENCES "SessionCategory"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. Danh mục công dạy nhận chiều thứ ba ────────────────────────────────────────────
ALTER TABLE "TeachingCreditType" ADD COLUMN "categoryId" TEXT;
CREATE INDEX "TeachingCreditType_categoryId_idx" ON "TeachingCreditType"("categoryId");
ALTER TABLE "TeachingCreditType"
  ADD CONSTRAINT "TeachingCreditType_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "SessionCategory"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "TeachingCreditType_source_role_key";
CREATE UNIQUE INDEX "TeachingCreditType_source_role_categoryId_key"
  ON "TeachingCreditType"("source", "role", "categoryId");

-- Postgres coi hai NULL là KHÁC NHAU, nên khoá ba cột ở trên KHÔNG chặn được hai dòng "bao sân"
-- cùng (source, role). Mà đó đúng là ca cần chặn: hai dòng bao sân thì `loaiCua` khớp dòng nào
-- cũng hợp lệ ⇒ tổng công dạy đổi theo thứ tự đọc của Postgres. Chặn bằng partial index.
CREATE UNIQUE INDEX "TeachingCreditType_bao_san_key"
  ON "TeachingCreditType"("source", "role") WHERE "categoryId" IS NULL;
