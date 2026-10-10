-- Phase T0.2 — Center.code (mã cơ sở CS1/CS2 cho codegen)
ALTER TABLE "Center" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "Center_code_key" ON "Center"("code");
