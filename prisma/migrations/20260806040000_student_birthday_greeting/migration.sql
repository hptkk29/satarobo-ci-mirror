-- Sinh nhật học viên — sổ cái 1 dòng / 1 học viên / 1 năm.
--
-- Thuần THÊM BẢNG: không đụng bảng nào đang chạy, rollback = DROP TABLE.
-- Khoá @@unique([studentId, year]) là thứ chặn cron (chạy mỗi sáng) đẻ trùng việc
-- và gửi lại tin ZNS mất tiền.

CREATE TABLE "StudentBirthdayGreeting" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "birthdayDate" TIMESTAMPTZ(6) NOT NULL,
    "centerId" TEXT,
    "celebrationSessionId" TEXT,
    "celebrationDate" TIMESTAMPTZ(6),
    "staffNotifiedAt" TIMESTAMPTZ(6),
    "celebratedAt" TIMESTAMPTZ(6),
    "celebratedById" TEXT,
    "znsStatus" TEXT,
    "znsLogId" TEXT,
    "znsSentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StudentBirthdayGreeting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentBirthdayGreeting_studentId_year_key" ON "StudentBirthdayGreeting"("studentId", "year");
CREATE INDEX "StudentBirthdayGreeting_centerId_birthdayDate_idx" ON "StudentBirthdayGreeting"("centerId", "birthdayDate");
CREATE INDEX "StudentBirthdayGreeting_celebrationDate_idx" ON "StudentBirthdayGreeting"("celebrationDate");
CREATE INDEX "StudentBirthdayGreeting_birthdayDate_idx" ON "StudentBirthdayGreeting"("birthdayDate");

ALTER TABLE "StudentBirthdayGreeting"
    ADD CONSTRAINT "StudentBirthdayGreeting_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
