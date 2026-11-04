-- R7-06 — truy vết Enrollment ⇽ LeadChild khi convert per-child.
-- Additive, nullable; FK SetNull để không chặn xoá lead/con. Enrollment cũ → NULL.

ALTER TABLE "Enrollment" ADD COLUMN "leadChildId" TEXT;

CREATE INDEX "Enrollment_leadChildId_idx" ON "Enrollment"("leadChildId");

ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_leadChildId_fkey"
  FOREIGN KEY ("leadChildId") REFERENCES "LeadChild"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
