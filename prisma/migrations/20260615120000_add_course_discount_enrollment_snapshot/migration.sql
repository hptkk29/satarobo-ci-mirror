-- CreateEnum
CREATE TYPE "CourseDiscountType" AS ENUM ('AMOUNT', 'PERCENT', 'SCHOLARSHIP', 'PROGRAM');

-- AlterTable Course — tuổi/trình độ
ALTER TABLE "Course" ADD COLUMN "ageRange" TEXT;
ALTER TABLE "Course" ADD COLUMN "level" TEXT;

-- AlterTable Enrollment — snapshot giá 4 thành phần (additive; tuition cũ giữ)
ALTER TABLE "Enrollment" ADD COLUMN "listPrice" INTEGER;
ALTER TABLE "Enrollment" ADD COLUMN "discountType" TEXT;
ALTER TABLE "Enrollment" ADD COLUMN "discountAmount" INTEGER;
ALTER TABLE "Enrollment" ADD COLUMN "finalPrice" INTEGER;

-- CreateTable
CREATE TABLE "CourseDiscount" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "type" "CourseDiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "note" TEXT,
    "conditions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseDiscount_courseId_active_idx" ON "CourseDiscount"("courseId", "active");

-- AddForeignKey
ALTER TABLE "CourseDiscount" ADD CONSTRAINT "CourseDiscount_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
