-- EL-15 — bài tập chấm tay + khung chấm (rubric).
--
-- CHỈ THÊM: 2 enum + 4 bảng mới. Không ALTER, không DROP, không đụng bảng đang
-- có dữ liệu (luật cứng #4).
--
-- ⚠️ Bản sinh tự động của `prisma migrate diff --from-migrations` còn kèm theo
-- TRÔI LỆCH CÓ SẴN của repo: một `DROP INDEX "OrgUnit_path_idx"` và 14 khối
-- `ALTER COLUMN ... SET DATA TYPE TIMESTAMP(3)` trên các bảng PROD. Toàn bộ phần
-- đó đã bị LOẠI khỏi tệp này — nó không thuộc ticket, và hạ `timestamptz(6)`
-- xuống `timestamp(3)` là vứt múi giờ của dữ liệu đang chạy.
-- CreateEnum
CREATE TYPE "TrnRubricStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrnSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'GRADED', 'NEEDS_REVISION');

-- CreateTable
CREATE TABLE "TrnRubric" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL DEFAULT 100,
    "passPoints" INTEGER NOT NULL DEFAULT 80,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "TrnRubricStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerUserId" TEXT NOT NULL,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnRubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnRubricCriterion" (
    "id" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "levelsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnRubricCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnSubmission" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "userId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "contentText" TEXT,
    "attachmentsJson" JSONB,
    "submittedAt" TIMESTAMPTZ(6),
    "status" "TrnSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "score" INTEGER,
    "passed" BOOLEAN,
    "gradedByUserId" TEXT,
    "gradedAt" TIMESTAMPTZ(6),
    "dueGradeAt" TIMESTAMPTZ(6),
    "feedback" TEXT,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrnRubricScore" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "levelIndex" INTEGER NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TrnRubricScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrnRubric_code_key" ON "TrnRubric"("code");

-- CreateIndex
CREATE INDEX "TrnRubric_status_idx" ON "TrnRubric"("status");

-- CreateIndex
CREATE INDEX "TrnRubric_centerId_idx" ON "TrnRubric"("centerId");

-- CreateIndex
CREATE INDEX "TrnRubric_orgUnitId_idx" ON "TrnRubric"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrnRubricCriterion_rubricId_idx" ON "TrnRubricCriterion"("rubricId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnRubricCriterion_rubricId_orderIndex_key" ON "TrnRubricCriterion"("rubricId", "orderIndex");

-- CreateIndex
CREATE INDEX "TrnSubmission_status_gradedByUserId_idx" ON "TrnSubmission"("status", "gradedByUserId");

-- CreateIndex
CREATE INDEX "TrnSubmission_status_dueGradeAt_idx" ON "TrnSubmission"("status", "dueGradeAt");

-- CreateIndex
CREATE INDEX "TrnSubmission_userId_lessonId_idx" ON "TrnSubmission"("userId", "lessonId");

-- CreateIndex
CREATE INDEX "TrnSubmission_enrollmentId_idx" ON "TrnSubmission"("enrollmentId");

-- CreateIndex
CREATE INDEX "TrnSubmission_centerId_idx" ON "TrnSubmission"("centerId");

-- CreateIndex
CREATE INDEX "TrnSubmission_orgUnitId_idx" ON "TrnSubmission"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnSubmission_lessonId_userId_attemptNo_key" ON "TrnSubmission"("lessonId", "userId", "attemptNo");

-- CreateIndex
CREATE INDEX "TrnRubricScore_submissionId_idx" ON "TrnRubricScore"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrnRubricScore_submissionId_criterionId_key" ON "TrnRubricScore"("submissionId", "criterionId");

-- AddForeignKey
ALTER TABLE "TrnRubricCriterion" ADD CONSTRAINT "TrnRubricCriterion_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "TrnRubric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnRubricScore" ADD CONSTRAINT "TrnRubricScore_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "TrnSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrnRubricScore" ADD CONSTRAINT "TrnRubricScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "TrnRubricCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
