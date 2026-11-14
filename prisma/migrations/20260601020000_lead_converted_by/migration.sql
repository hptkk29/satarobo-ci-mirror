-- Cụm A3 — ai/khi nào chuyển lead sang ĐÃ ĐĂNG KÝ
ALTER TABLE "Lead" ADD COLUMN "convertedById" TEXT;
ALTER TABLE "Lead" ADD COLUMN "convertedAt" TIMESTAMP(3);
