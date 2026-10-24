-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "PromotionKind" NOT NULL DEFAULT 'PRIMARY',
    "title" TEXT NOT NULL,
    "highlight" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "details" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cta" TEXT,
    "target" TEXT,
    "condition" TEXT,
    "note" TEXT,
    "icon" TEXT NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "courseSlug" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Testimonial" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT 'Đà Nẵng',
    "rating" INTEGER NOT NULL DEFAULT 5,
    "avatar" TEXT NOT NULL,
    "avatarColor" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "videoId" TEXT,
    "courseSlug" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_slug_key" ON "Promotion"("slug");

-- CreateIndex
CREATE INDEX "Promotion_kind_isActive_displayOrder_idx" ON "Promotion"("kind", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "Promotion_courseSlug_isActive_idx" ON "Promotion"("courseSlug", "isActive");

-- CreateIndex
CREATE INDEX "Testimonial_courseSlug_isPublished_displayOrder_idx" ON "Testimonial"("courseSlug", "isPublished", "displayOrder");
