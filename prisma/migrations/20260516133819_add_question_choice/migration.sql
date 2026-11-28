-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY', 'CODE');

-- CreateEnum
CREATE TYPE "QuestionDifficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD', 'EXPERT');

-- CreateTable
CREATE TABLE "Question" (
  "id"            TEXT NOT NULL,
  "questionCode"  TEXT,
  "type"          "QuestionType" NOT NULL,
  "text"          TEXT NOT NULL,
  "explanation"   TEXT,
  "difficulty"    "QuestionDifficulty" NOT NULL DEFAULT 'MEDIUM',
  "tags"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lessonId"      TEXT,
  "correctAnswer" TEXT,
  "authorId"      TEXT,
  "isPublic"      BOOLEAN NOT NULL DEFAULT true,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Question_questionCode_key" ON "Question"("questionCode");

-- CreateIndex
CREATE INDEX "Question_lessonId_idx" ON "Question"("lessonId");

-- CreateIndex
CREATE INDEX "Question_type_difficulty_idx" ON "Question"("type", "difficulty");

-- CreateIndex
CREATE INDEX "Question_authorId_idx" ON "Question"("authorId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Choice" (
  "id"         TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "order"      INTEGER NOT NULL,
  "text"       TEXT NOT NULL,
  "isCorrect"  BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Choice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Choice_questionId_order_key" ON "Choice"("questionId", "order");

-- AddForeignKey
ALTER TABLE "Choice" ADD CONSTRAINT "Choice_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
