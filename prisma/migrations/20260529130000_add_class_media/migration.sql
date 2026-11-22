-- Phase NHÓM 3 — Ảnh lớp học (GV upload → manager duyệt → phụ huynh xem).
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "ClassSessionMedia" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "caption" TEXT,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "approvedById" TEXT,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassSessionMedia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClassSessionMedia_classId_status_idx" ON "ClassSessionMedia"("classId", "status");
CREATE INDEX "ClassSessionMedia_status_createdAt_idx" ON "ClassSessionMedia"("status", "createdAt");

CREATE TABLE "MediaStudentTag" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    CONSTRAINT "MediaStudentTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaStudentTag_mediaId_studentId_key" ON "MediaStudentTag"("mediaId", "studentId");
CREATE INDEX "MediaStudentTag_studentId_idx" ON "MediaStudentTag"("studentId");

ALTER TABLE "MediaStudentTag"
  ADD CONSTRAINT "MediaStudentTag_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "ClassSessionMedia"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
