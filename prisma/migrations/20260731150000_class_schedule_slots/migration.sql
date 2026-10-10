-- BGĐ 31/07 — giờ học riêng theo từng thứ (lớp 2 ca khác giờ: 17h30-T2 & 08h-T6).
-- 2-phase: Class.startTime/endTime GIỮ NGUYÊN làm giờ chung + fallback cho lớp cũ.

CREATE TABLE "ClassScheduleSlot" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ClassScheduleSlot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClassScheduleSlot_classId_weekday_key" ON "ClassScheduleSlot"("classId", "weekday");
CREATE INDEX "ClassScheduleSlot_classId_idx" ON "ClassScheduleSlot"("classId");

ALTER TABLE "ClassScheduleSlot" ADD CONSTRAINT "ClassScheduleSlot_classId_fkey"
    FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
