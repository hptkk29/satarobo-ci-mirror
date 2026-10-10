-- G2 — Lead: sản phẩm/khoá học DỰ KIẾN theo loại đơn (additive, nullable, an toàn 2-phase).
-- orderKind=COURSE → expectedCourseId; orderKind=PRODUCT → expectedProductId. Tách khỏi
-- Lead.courseId ("Khoá quan tâm") để không lẫn "quan tâm" với "dự kiến đặt đơn".

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "expectedCourseId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "expectedProductId" TEXT;

-- CreateIndex
CREATE INDEX "Lead_expectedCourseId_idx" ON "Lead"("expectedCourseId");
CREATE INDEX "Lead_expectedProductId_idx" ON "Lead"("expectedProductId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_expectedCourseId_fkey" FOREIGN KEY ("expectedCourseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_expectedProductId_fkey" FOREIGN KEY ("expectedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
