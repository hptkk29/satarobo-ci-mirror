-- BGĐ 31/07 — TÁI TỤC: ghi danh mới nối về ghi danh khoá trước (cùng HV).
-- Additive, nullable; isRenewal cho hoa hồng suy từ field này.
ALTER TABLE "Enrollment" ADD COLUMN "renewedFromEnrollmentId" TEXT;

CREATE INDEX "Enrollment_renewedFromEnrollmentId_idx" ON "Enrollment"("renewedFromEnrollmentId");

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_renewedFromEnrollmentId_fkey"
    FOREIGN KEY ("renewedFromEnrollmentId") REFERENCES "Enrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
