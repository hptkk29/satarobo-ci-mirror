-- LMS-15 — nhắn tin 2 chiều PH ↔ GV/Trung tâm.
CREATE TABLE "MessageThread" (
  "id"              TEXT NOT NULL,
  "studentId"       TEXT NOT NULL,
  "classId"         TEXT,
  "subject"         TEXT,
  "createdByUserId" TEXT,
  "lastMessageAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
  "id"           TEXT NOT NULL,
  "threadId"     TEXT NOT NULL,
  "senderUserId" TEXT NOT NULL,
  "senderRole"   TEXT NOT NULL,
  "senderName"   TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "parentReadAt" TIMESTAMPTZ(6),
  "staffReadAt"  TIMESTAMPTZ(6),
  "createdAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageThread_studentId_lastMessageAt_idx" ON "MessageThread"("studentId", "lastMessageAt");
CREATE INDEX "MessageThread_classId_idx" ON "MessageThread"("classId");
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey"
  FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
