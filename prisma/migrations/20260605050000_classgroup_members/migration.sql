-- P2 — nhóm lớp (cohort): thành viên cố định. 1 HV thuộc tối đa 1 nhóm.
ALTER TABLE "Student" ADD COLUMN "classGroupId" TEXT;
CREATE INDEX "Student_classGroupId_idx" ON "Student"("classGroupId");
ALTER TABLE "Student" ADD CONSTRAINT "Student_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
