-- R7-17 (PR3) — CoinRuleConfig (Satacoin config, SCHEMA-ONLY, không runtime).

-- CreateEnum
CREATE TYPE "CoinRuleSource" AS ENUM ('HOMEWORK_RESULT', 'TEACHER_EVAL_DONE', 'CENTER_SURVEY_DONE');

-- CreateTable
CREATE TABLE "CoinRuleConfig" (
    "id" TEXT NOT NULL,
    "behaviorKey" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "dailyCap" INTEGER,
    "totalCap" INTEGER,
    "source" "CoinRuleSource" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoinRuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoinRuleConfig_behaviorKey_key" ON "CoinRuleConfig"("behaviorKey");
