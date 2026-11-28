-- EL-16 — CHỨNG NHẬN hoàn thành khoá đào tạo.
--
-- ⚠️ CHỈ ADD. Không một dòng DROP / ALTER COLUMN nào chạm bảng đang có dữ liệu prod
-- (luật cứng Nền Hệ thống #4). `prisma migrate diff` sinh kèm ~14 dòng trôi dạt có
-- sẵn của kho — một `DROP INDEX "OrgUnit_path_idx"` và một loạt `ALTER COLUMN ...
-- TIMESTAMP(3)` trên bảng prod — TOÀN BỘ đã bị lọc bỏ khỏi tệp này. Đó là nợ cũ,
-- không phải việc của EL-16, và để nó lọt vào đây là đổi kiểu cột trên prod bằng
-- một migration mang tên khác.

-- CreateEnum
CREATE TYPE "TrnCertStatus" AS ENUM ('VALID', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "TrnCertificate" (
    "id" TEXT NOT NULL,
    "certCode" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "courseVersionId" TEXT NOT NULL,
    "programId" TEXT,
    "enrollmentId" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMPTZ(6),
    "status" "TrnCertStatus" NOT NULL DEFAULT 'VALID',
    "revokedAt" TIMESTAMPTZ(6),
    "revokedByUserId" TEXT,
    "revokeReason" TEXT,
    "recertAssignedAt" TIMESTAMPTZ(6),
    "pdfKey" TEXT,
    "snapFullName" TEXT NOT NULL,
    "snapEmployeeCode" TEXT NOT NULL,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrnCertificate_certCode_key" ON "TrnCertificate"("certCode");

-- CreateIndex
CREATE UNIQUE INDEX "TrnCertificate_verifyToken_key" ON "TrnCertificate"("verifyToken");

-- CreateIndex
CREATE UNIQUE INDEX "TrnCertificate_enrollmentId_key" ON "TrnCertificate"("enrollmentId");

-- CreateIndex
CREATE INDEX "TrnCertificate_userId_status_idx" ON "TrnCertificate"("userId", "status");

-- CreateIndex
CREATE INDEX "TrnCertificate_validUntil_idx" ON "TrnCertificate"("validUntil");

-- CreateIndex
CREATE INDEX "TrnCertificate_status_recertAssignedAt_idx" ON "TrnCertificate"("status", "recertAssignedAt");

-- CreateIndex
CREATE INDEX "TrnCertificate_courseId_status_idx" ON "TrnCertificate"("courseId", "status");

-- CreateIndex
CREATE INDEX "TrnCertificate_centerId_idx" ON "TrnCertificate"("centerId");

-- CreateIndex
CREATE INDEX "TrnCertificate_orgUnitId_idx" ON "TrnCertificate"("orgUnitId");

-- AddForeignKey (EL-16·C, gộp vào đây vì bảng chưa tồn tại ở môi trường nào)
-- onDelete RESTRICT: xoá lượt ghi danh đã sinh chứng nhận là làm mồ côi chứng từ đã phát.
ALTER TABLE "TrnCertificate" ADD CONSTRAINT "TrnCertificate_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "TrnEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bảng MỚI tự bật RLS (luật .claude/rules/prisma-db.md; sự cố 09/08/2026 và đợt bù 20260921090000).
-- Chỉ ENABLE, không FORCE, không policy: ứng dụng nối bằng vai chủ bảng nên không đổi hành vi.
ALTER TABLE "TrnCertificate" ENABLE ROW LEVEL SECURITY;
