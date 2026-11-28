-- V10.0 (Q2) — HỆ CHỨNG NHẬN ONLINE ĐỘC LẬP: phôi (mẫu) theo khoá, phiên bản BẤT BIẾN, ảnh chụp lúc cấp.
-- Không dùng chung bảng/engine với chứng nhận Nội bộ (Trn*) hay Offline. Bảng mới + hai cột NULL trên OnlCertificate (cộng thêm). CHẠY LẠI ĐƯỢC (luật MIG-01).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlCertTemplateStatus') THEN
    CREATE TYPE "OnlCertTemplateStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "OnlCertificateTemplate" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "OnlCertTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    -- Khoá đối tượng NỘI DUNG-ĐỊNH-DANH trong kho hiện có: online/cn/<courseId>/<sha256>.<ext> — ghi một lần, không đè.
    "backgroundKey" TEXT NOT NULL,
    "backgroundSha256" TEXT NOT NULL,
    "backgroundMime" TEXT NOT NULL,
    "widthPx" INTEGER NOT NULL,
    "heightPx" INTEGER NOT NULL,
    -- Bố cục bốn khung chữ (toạ độ theo % trang) — xem lib/elearning-online/cn-mau.ts.
    "fieldsJson" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "approvedAt" TIMESTAMPTZ(6),
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnlCertificateTemplate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "OnlCertificateTemplate_sha_check" CHECK ("backgroundSha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCertificateTemplate_courseId_version_key" ON "OnlCertificateTemplate"("courseId", "version");
-- MỖI khoá tối đa MỘT mẫu đang áp dụng.
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCertificateTemplate_courseId_approved_key" ON "OnlCertificateTemplate"("courseId") WHERE "status" = 'APPROVED';

ALTER TABLE "OnlCertificate" ADD COLUMN IF NOT EXISTS "templateId" TEXT;
-- Bản chụp mọi thứ cần để dựng lại ĐÚNG bản đã cấp: bố cục, mã băm phôi, các dòng chữ. NULL = chứng nhận cấp trước V10.0 (dựng bằng khuôn mặc định).
ALTER TABLE "OnlCertificate" ADD COLUMN IF NOT EXISTS "renderSnapshotJson" JSONB;
CREATE INDEX IF NOT EXISTS "OnlCertificate_templateId_idx" ON "OnlCertificate"("templateId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlCertificateTemplate_courseId_fkey') THEN
    ALTER TABLE "OnlCertificateTemplate" ADD CONSTRAINT "OnlCertificateTemplate_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "OnlCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlCertificate_templateId_fkey') THEN
    ALTER TABLE "OnlCertificate" ADD CONSTRAINT "OnlCertificate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OnlCertificateTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- BẤT BIẾN: nội dung mẫu không sửa được sau khi tạo (chỉ trạng thái + dấu duyệt đổi). Không xoá mẫu đã dùng: khoá ngoại từ OnlCertificate là RESTRICT.
CREATE OR REPLACE FUNCTION onl_cert_template_bat_bien() RETURNS trigger AS $$
  BEGIN
    IF NEW."courseId" <> OLD."courseId" OR NEW."version" <> OLD."version" OR NEW."backgroundKey" <> OLD."backgroundKey" OR NEW."backgroundSha256" <> OLD."backgroundSha256"
       OR NEW."backgroundMime" <> OLD."backgroundMime" OR NEW."widthPx" <> OLD."widthPx" OR NEW."heightPx" <> OLD."heightPx" OR NEW."fieldsJson"::text <> OLD."fieldsJson"::text THEN
      RAISE EXCEPTION 'OnlCertificateTemplate: nội dung mẫu bất biến (tạo phiên bản mới thay vì sửa)';
    END IF;
    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "OnlCertificateTemplate_bat_bien_upd" ON "OnlCertificateTemplate";
CREATE TRIGGER "OnlCertificateTemplate_bat_bien_upd" BEFORE UPDATE ON "OnlCertificateTemplate" FOR EACH ROW EXECUTE FUNCTION onl_cert_template_bat_bien();

ALTER TABLE "OnlCertificateTemplate" ENABLE ROW LEVEL SECURITY;
