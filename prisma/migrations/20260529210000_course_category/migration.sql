-- Đợt 3D — Course category + isTeachable
CREATE TYPE "CourseCategory" AS ENUM ('LUYEN_THI_ROBOSIM', 'LAP_TRINH_ROBOT');

ALTER TABLE "Course" ADD COLUMN "category" "CourseCategory";
ALTER TABLE "Course" ADD COLUMN "isTeachable" BOOLEAN NOT NULL DEFAULT false;
