-- CreateTable
CREATE TABLE "ZMRoboKit" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'ZMROBO',
    "series" TEXT NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceDisplay" TEXT NOT NULL DEFAULT 'Liên hệ tư vấn',
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "specs" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "highlights" JSONB NOT NULL,
    "mainImage" TEXT NOT NULL DEFAULT '',
    "galleryImages" TEXT[],
    "sourceUrl" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZMRoboKit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZMRoboKit_slug_key" ON "ZMRoboKit"("slug");

-- CreateIndex
CREATE INDEX "ZMRoboKit_slug_idx" ON "ZMRoboKit"("slug");

-- CreateIndex
CREATE INDEX "ZMRoboKit_isPublished_displayOrder_idx" ON "ZMRoboKit"("isPublished", "displayOrder");
