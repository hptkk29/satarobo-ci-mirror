-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "departmentId" TEXT;

-- CreateTable
CREATE TABLE "DepartmentDef" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isTeaching" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentDef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentDef_code_key" ON "DepartmentDef"("code");

-- CreateIndex
CREATE INDEX "DepartmentDef_isActive_displayOrder_idx" ON "DepartmentDef"("isActive", "displayOrder");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "DepartmentDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Track Department: seed 10 phòng ban (code khớp enum cũ) — idempotent qua ON CONFLICT.
INSERT INTO "DepartmentDef" ("id","code","name","displayOrder","isTeaching","isActive","createdAt","updatedAt") VALUES
  ('dept-ban-giam-doc','BAN_GIAM_DOC','Ban Giám đốc',0,false,true,now(),now()),
  ('dept-dao-tao','DAO_TAO','Phòng Đào tạo',1,true,true,now(),now()),
  ('dept-marketing','MARKETING','Phòng Marketing',2,false,true,now(),now()),
  ('dept-kinh-doanh','KINH_DOANH','Phòng Kinh doanh / Sale',3,false,true,now(),now()),
  ('dept-it','IT','Phòng IT / Công nghệ',4,false,true,now(),now()),
  ('dept-hcns','HANH_CHANH_NHAN_SU','Hành chính - Nhân sự',5,false,true,now(),now()),
  ('dept-ke-toan','KE_TOAN','Phòng Kế toán',6,false,true,now(),now()),
  ('dept-tuyen-sinh','TUYEN_SINH','Phòng Tuyển sinh',7,false,true,now(),now()),
  ('dept-giao-vu','GIAO_VU','Giáo vụ',8,false,true,now(),now()),
  ('dept-giang-day','GIANG_DAY','Giảng dạy',9,true,true,now(),now())
ON CONFLICT ("code") DO NOTHING;

-- Backfill Employee.departmentId từ enum department (dual-write phase).
UPDATE "Employee" t SET "departmentId" = d."id"
FROM "DepartmentDef" d WHERE d."code" = t."department"::text AND t."departmentId" IS NULL;
