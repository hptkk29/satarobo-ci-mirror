-- AlterTable
ALTER TABLE "BlogPost" ADD COLUMN     "category" TEXT,
ADD COLUMN     "ogImage" TEXT,
ADD COLUMN     "readingTime" INTEGER,
ADD COLUMN     "seoDesc" TEXT,
ADD COLUMN     "seoTitle" TEXT,
ADD COLUMN     "tags" TEXT[],
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "BlogPost_category_idx" ON "BlogPost"("category");
