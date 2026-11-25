-- CreateTable
CREATE TABLE "CoursePackage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "subtitle" TEXT,
    "shortDescription" TEXT,
    "description" TEXT,
    "ageGroup" TEXT,
    "level" TEXT,
    "lessons" INTEGER,
    "duration" TEXT,
    "priceOriginal" INTEGER,
    "priceEarlyBird" INTEGER,
    "priceMember" INTEGER,
    "features" JSONB,
    "highlights" JSONB,
    "curriculum" JSONB,
    "badge" TEXT,
    "color" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "thumbnail" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "parentCourseSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoursePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "News" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "coverImage" TEXT,
    "category" TEXT,
    "tags" TEXT[],
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "News_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recruitment" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "workingHours" TEXT,
    "salaryRange" TEXT,
    "jobType" TEXT NOT NULL,
    "experienceLevel" TEXT,
    "summary" TEXT NOT NULL,
    "responsibilities" JSONB NOT NULL,
    "requirements" JSONB NOT NULL,
    "benefits" JSONB NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recruitment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoursePackage_slug_key" ON "CoursePackage"("slug");

-- CreateIndex
CREATE INDEX "CoursePackage_slug_idx" ON "CoursePackage"("slug");

-- CreateIndex
CREATE INDEX "CoursePackage_parentCourseSlug_isPublished_displayOrder_idx" ON "CoursePackage"("parentCourseSlug", "isPublished", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "News_slug_key" ON "News"("slug");

-- CreateIndex
CREATE INDEX "News_slug_idx" ON "News"("slug");

-- CreateIndex
CREATE INDEX "News_isPublished_publishedAt_idx" ON "News"("isPublished", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recruitment_slug_key" ON "Recruitment"("slug");

-- CreateIndex
CREATE INDEX "Recruitment_slug_idx" ON "Recruitment"("slug");

-- CreateIndex
CREATE INDEX "Recruitment_isPublished_displayOrder_idx" ON "Recruitment"("isPublished", "displayOrder");
