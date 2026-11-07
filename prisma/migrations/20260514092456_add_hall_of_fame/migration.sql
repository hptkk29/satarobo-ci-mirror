-- CreateEnum
CREATE TYPE "HonorCategory" AS ENUM ('SPARK', 'GROWTH', 'IMPACT', 'GRAND_CHAMPION');

-- CreateTable
CREATE TABLE "Honor" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "yearsAtCompany" INTEGER,
    "category" "HonorCategory" NOT NULL,
    "awardName" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL,
    "awardQuarter" TEXT,
    "story" TEXT NOT NULL,
    "shortBio" VARCHAR(280),
    "pullQuote" VARCHAR(500),
    "achievements" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Honor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineItem" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "relatedHonorIds" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePageContent" (
    "id" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "contentKey" TEXT NOT NULL,
    "contentValue" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SitePageContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Honor_slug_key" ON "Honor"("slug");

-- CreateIndex
CREATE INDEX "Honor_category_idx" ON "Honor"("category");

-- CreateIndex
CREATE INDEX "Honor_isFeatured_idx" ON "Honor"("isFeatured");

-- CreateIndex
CREATE INDEX "Honor_isPublished_displayOrder_idx" ON "Honor"("isPublished", "displayOrder");

-- CreateIndex
CREATE INDEX "TimelineItem_isPublished_occurredAt_idx" ON "TimelineItem"("isPublished", "occurredAt");

-- CreateIndex
CREATE INDEX "SitePageContent_pageKey_idx" ON "SitePageContent"("pageKey");

-- CreateIndex
CREATE UNIQUE INDEX "SitePageContent_pageKey_contentKey_key" ON "SitePageContent"("pageKey", "contentKey");

-- AddForeignKey
ALTER TABLE "Honor" ADD CONSTRAINT "Honor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePageContent" ADD CONSTRAINT "SitePageContent_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
