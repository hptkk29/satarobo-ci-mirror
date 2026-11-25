-- Module Quản lý lớp phần 4 — CenterDayChecklist
CREATE TABLE "CenterDayChecklist" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "openPower" BOOLEAN NOT NULL DEFAULT false,
    "openDevices" BOOLEAN NOT NULL DEFAULT false,
    "openRoomsReady" BOOLEAN NOT NULL DEFAULT false,
    "openCleanCommon" BOOLEAN NOT NULL DEFAULT false,
    "openSecurity" BOOLEAN NOT NULL DEFAULT false,
    "closePower" BOOLEAN NOT NULL DEFAULT false,
    "closeDevices" BOOLEAN NOT NULL DEFAULT false,
    "closeLock" BOOLEAN NOT NULL DEFAULT false,
    "closeKpiBoard" BOOLEAN NOT NULL DEFAULT false,
    "closeSafety" BOOLEAN NOT NULL DEFAULT false,
    "closeHandover" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "byUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CenterDayChecklist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CenterDayChecklist_centerId_date_key" ON "CenterDayChecklist"("centerId", "date");
CREATE INDEX "CenterDayChecklist_centerId_date_idx" ON "CenterDayChecklist"("centerId", "date");
