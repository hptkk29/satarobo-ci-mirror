-- CreateTable
CREATE TABLE "RbacShadowDiff" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "v1" BOOLEAN NOT NULL,
    "v2" BOOLEAN NOT NULL,
    "targetKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RbacShadowDiff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RbacShadowDiff_createdAt_idx" ON "RbacShadowDiff"("createdAt");

-- CreateIndex
CREATE INDEX "RbacShadowDiff_action_idx" ON "RbacShadowDiff"("action");
