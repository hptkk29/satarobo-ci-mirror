-- Phase T2.2 — liên kết tài khoản phụ huynh (PARENT User) với Student (site con).
ALTER TABLE "Student" ADD COLUMN "parentUserId" TEXT;

CREATE INDEX "Student_parentUserId_idx" ON "Student"("parentUserId");

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_parentUserId_fkey"
  FOREIGN KEY ("parentUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
