-- DropForeignKey
ALTER TABLE "BlogPost" DROP CONSTRAINT IF EXISTS "BlogPost_authorId_fkey";

-- DropTable
DROP TABLE IF EXISTS "Recruitment";

-- DropTable
DROP TABLE IF EXISTS "BlogPost";
