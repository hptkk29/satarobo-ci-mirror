-- Add new columns (slug nullable initially so existing rows can be backfilled)
ALTER TABLE "Center"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "ward" TEXT,
  ADD COLUMN "district" TEXT,
  ADD COLUMN "city" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "googleMapUrl" TEXT,
  ADD COLUMN "workingHours" TEXT,
  ADD COLUMN "managerName" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "bannerUrl" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill slug for existing rows. Use full id to guarantee uniqueness —
-- earlier attempt with SUBSTRING(id, 1, 8) collided. User renames via admin form.
UPDATE "Center"
SET "slug" = 'center-' || id
WHERE "slug" IS NULL;

-- Enforce NOT NULL + unique on slug
ALTER TABLE "Center" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Center_slug_key" ON "Center"("slug");

-- Index on displayOrder for list ordering
CREATE INDEX "Center_displayOrder_idx" ON "Center"("displayOrder");
