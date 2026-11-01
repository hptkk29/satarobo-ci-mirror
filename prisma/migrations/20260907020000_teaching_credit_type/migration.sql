-- Danh mục LOẠI CÔNG DẠY (đợt 2, chốt 07/09/2026). Bảng MỚI, không đụng bảng nào đang có.
--
-- Yêu cầu chủ dự án: "vẫn phải dev thêm các mục linh hoạt công dạy khác để dự phòng BLĐ yêu cầu
-- có công dạy cho các loại trial, bù, vượt… cái này có thể tự tạo tự add được qua hệ thống chứ
-- không cần phải code."
--
-- Cơ chế: hệ số và công tắc nằm trong DỮ LIỆU, không trong mã. BLĐ muốn tính công cho buổi trải
-- nghiệm thì bật dòng đó lên và đặt hệ số — không cần deploy.
--
-- `@@unique(source, role)` cố ý: sáu tổ hợp là toàn bộ những gì hệ thống tự nhận ra được từ dữ
-- liệu buổi hiện có, và khoá lại thì mỗi buổi ứng đúng một loại — không bao giờ đếm hai lần.

CREATE TYPE "TeachingCreditBasis" AS ENUM ('PER_SESSION', 'PER_HOUR');
CREATE TYPE "TeachingCreditSource" AS ENUM ('CLASS', 'TRIAL');
CREATE TYPE "TeachingRole" AS ENUM ('MAIN', 'SUBSTITUTE', 'ASSISTANT');

CREATE TABLE "TeachingCreditType" (
  "id"             TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "source"         "TeachingCreditSource" NOT NULL,
  "role"           "TeachingRole" NOT NULL,
  "basis"          "TeachingCreditBasis" NOT NULL DEFAULT 'PER_SESSION',
  "factor"         DOUBLE PRECISION NOT NULL DEFAULT 1,
  "countsInPeriod" BOOLEAN NOT NULL DEFAULT true,
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "displayOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "TeachingCreditType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeachingCreditType_code_key" ON "TeachingCreditType"("code");
CREATE UNIQUE INDEX "TeachingCreditType_source_role_key" ON "TeachingCreditType"("source", "role");
