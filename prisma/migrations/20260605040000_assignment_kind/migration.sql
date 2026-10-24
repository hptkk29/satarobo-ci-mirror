-- P-new — bài tập về nhà
CREATE TYPE "AssignmentKind" AS ENUM ('CLASSWORK', 'HOMEWORK');
ALTER TABLE "Assignment" ADD COLUMN "kind" "AssignmentKind" NOT NULL DEFAULT 'CLASSWORK';
