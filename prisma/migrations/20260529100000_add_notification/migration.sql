-- Phase NHÓM 3 — Thông báo phụ huynh.
CREATE TYPE "NotificationAudience" AS ENUM ('ALL_PARENTS', 'CENTER', 'CLASS');

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL DEFAULT 'ALL_PARENTS',
    "centerId" TEXT,
    "classId" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Notification_audience_isPublished_idx" ON "Notification"("audience", "isPublished");
CREATE INDEX "Notification_centerId_idx" ON "Notification"("centerId");
CREATE INDEX "Notification_classId_idx" ON "Notification"("classId");
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
