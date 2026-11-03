-- LMS-14 — kết quả học SCORM (điểm/hoàn thành) ghi từ runtime API.
CREATE TABLE "ScormAttempt" (
  "id"             TEXT NOT NULL,
  "packageId"      TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "classSessionId" TEXT,
  "scoreRaw"       INTEGER,
  "scoreMax"       INTEGER,
  "lessonStatus"   TEXT,
  "completion"     TEXT,
  "suspendData"    TEXT,
  "rawCmi"         JSONB,
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ScormAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScormAttempt_packageId_userId_key" ON "ScormAttempt"("packageId", "userId");
CREATE INDEX "ScormAttempt_packageId_idx" ON "ScormAttempt"("packageId");
ALTER TABLE "ScormAttempt" ADD CONSTRAINT "ScormAttempt_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "ScormPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
