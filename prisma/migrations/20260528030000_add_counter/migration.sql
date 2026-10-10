-- Phase T0.2 — Counter (atomic sequence cho codegen mã định danh)
CREATE TABLE "Counter" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Counter_key_key" ON "Counter"("key");
