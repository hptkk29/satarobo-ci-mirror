-- MEDIA-REVIEW (BA 26/08/2026) — ảnh/video buổi học + cổng duyệt của QLCS.
--
-- Chủ dự án 26/08 chốt LÀM MỚI thay vì mở rộng `ClassSessionMedia`.
-- ADDITIVE thuần: 3 enum + 2 bảng MỚI, KHÔNG đụng bảng nào đang có.
-- `ClassSessionMedia` giữ nguyên (đọc-only cho ảnh cũ) — dọn ở đợt sau, nếp 2-phase.
-- Rollback = DROP hai bảng + ba enum.

CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PURGED');

CREATE TYPE "SessionReviewStatus" AS ENUM ('OPEN', 'APPROVED', 'NO_MEDIA_DECLARED');

CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "classId" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "sessionDate" DATE NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedByName" TEXT,
    "type" "MediaType" NOT NULL,
    "r2Key" TEXT NOT NULL,
    "thumbKey" TEXT,
    "durationSec" INTEGER,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "rejectReason" TEXT,
    "approvedInBulk" BOOLEAN NOT NULL DEFAULT false,
    "watchedRatio" DOUBLE PRECISION,
    "purgeAfterAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SessionMediaReview" (
    "id" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "sessionDate" DATE NOT NULL,
    "status" "SessionReviewStatus" NOT NULL DEFAULT 'OPEN',
    "noMediaReason" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "deadlineAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SessionMediaReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MediaAsset_centerId_sessionDate_status_idx" ON "MediaAsset"("centerId", "sessionDate", "status");

CREATE INDEX "MediaAsset_classSessionId_status_idx" ON "MediaAsset"("classSessionId", "status");

CREATE INDEX "MediaAsset_status_purgeAfterAt_idx" ON "MediaAsset"("status", "purgeAfterAt");

CREATE INDEX "MediaAsset_orgUnitId_idx" ON "MediaAsset"("orgUnitId");

CREATE UNIQUE INDEX "SessionMediaReview_classSessionId_key" ON "SessionMediaReview"("classSessionId");

CREATE INDEX "SessionMediaReview_centerId_sessionDate_status_idx" ON "SessionMediaReview"("centerId", "sessionDate", "status");

CREATE INDEX "SessionMediaReview_status_deadlineAt_idx" ON "SessionMediaReview"("status", "deadlineAt");

CREATE INDEX "SessionMediaReview_orgUnitId_idx" ON "SessionMediaReview"("orgUnitId");
