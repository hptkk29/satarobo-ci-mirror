-- FIX 10 — TeacherProfile + TeacherCourse + TeacherReview
CREATE TYPE "TeacherRank" AS ENUM ('TRAINEE', 'JUNIOR', 'ADVANCED', 'SENIOR', 'EXPERT');
CREATE TYPE "EmploymentType" AS ENUM ('FULLTIME', 'PARTTIME');
CREATE TYPE "TeacherStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'INACTIVE');

CREATE TABLE "TeacherProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rank" "TeacherRank" NOT NULL DEFAULT 'TRAINEE',
    "employmentType" "EmploymentType" NOT NULL DEFAULT 'PARTTIME',
    "status" "TeacherStatus" NOT NULL DEFAULT 'ACTIVE',
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeacherProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeacherProfile_userId_key" ON "TeacherProfile"("userId");

CREATE TABLE "TeacherCourse" (
    "teacherProfileId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    CONSTRAINT "TeacherCourse_pkey" PRIMARY KEY ("teacherProfileId", "courseId")
);
CREATE INDEX "TeacherCourse_courseId_idx" ON "TeacherCourse"("courseId");

CREATE TABLE "TeacherReview" (
    "id" TEXT NOT NULL,
    "teacherProfileId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewerName" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeacherReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TeacherReview_teacherProfileId_createdAt_idx" ON "TeacherReview"("teacherProfileId", "createdAt");

ALTER TABLE "TeacherProfile" ADD CONSTRAINT "TeacherProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherCourse" ADD CONSTRAINT "TeacherCourse_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherCourse" ADD CONSTRAINT "TeacherCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherReview" ADD CONSTRAINT "TeacherReview_teacherProfileId_fkey" FOREIGN KEY ("teacherProfileId") REFERENCES "TeacherProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherReview" ADD CONSTRAINT "TeacherReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
