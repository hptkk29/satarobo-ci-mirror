-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PDF', 'IMAGE', 'VIDEO', 'SLIDE', 'WORKSHEET', 'AUDIO', 'OTHER');

-- CreateTable
CREATE TABLE "Document" (
  "id"            TEXT NOT NULL,
  "documentCode"  TEXT,
  "title"         TEXT NOT NULL,
  "description"   TEXT,
  "type"          "DocumentType" NOT NULL,
  "fileUrl"       TEXT NOT NULL,
  "fileName"      TEXT NOT NULL,
  "fileSize"      INTEGER NOT NULL,
  "mimeType"      TEXT,
  "lessonId"      TEXT,
  "isPublic"      BOOLEAN NOT NULL DEFAULT false,
  "tags"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"         TEXT,
  "uploadedById"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_documentCode_key" ON "Document"("documentCode");

-- CreateIndex
CREATE INDEX "Document_lessonId_idx" ON "Document"("lessonId");

-- CreateIndex
CREATE INDEX "Document_type_idx" ON "Document"("type");

-- CreateIndex
CREATE INDEX "Document_isPublic_idx" ON "Document"("isPublic");

-- CreateIndex
CREATE INDEX "Document_uploadedById_idx" ON "Document"("uploadedById");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
