-- AlterTable
ALTER TABLE "CenterDayChecklist" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "Class" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "ClassGroup" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "EmployeeCheckin" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "InventoryAudit" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "MakeupNeed" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "MessengerConversation" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "SataCoinTransaction" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "ShiftRegistration" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "StockBalance" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "orgUnitId" TEXT,
ADD COLUMN     "preferredOrgUnitId" TEXT;

-- AlterTable
ALTER TABLE "StudentCareTask" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "StudentCenterHistory" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "StudentRiskAlert" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "Survey" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "SurveyResponse" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "TimesheetAdjustmentRequest" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "TrialClass" ADD COLUMN     "orgUnitId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "orgUnitId" TEXT;

-- CreateIndex
CREATE INDEX "CenterDayChecklist_orgUnitId_idx" ON "CenterDayChecklist"("orgUnitId");

-- CreateIndex
CREATE INDEX "Class_orgUnitId_idx" ON "Class"("orgUnitId");

-- CreateIndex
CREATE INDEX "ClassGroup_orgUnitId_idx" ON "ClassGroup"("orgUnitId");

-- CreateIndex
CREATE INDEX "Employee_orgUnitId_idx" ON "Employee"("orgUnitId");

-- CreateIndex
CREATE INDEX "EmployeeCheckin_orgUnitId_idx" ON "EmployeeCheckin"("orgUnitId");

-- CreateIndex
CREATE INDEX "Holiday_orgUnitId_idx" ON "Holiday"("orgUnitId");

-- CreateIndex
CREATE INDEX "InventoryAudit_orgUnitId_idx" ON "InventoryAudit"("orgUnitId");

-- CreateIndex
CREATE INDEX "Lead_orgUnitId_idx" ON "Lead"("orgUnitId");

-- CreateIndex
CREATE INDEX "MakeupNeed_orgUnitId_idx" ON "MakeupNeed"("orgUnitId");

-- CreateIndex
CREATE INDEX "MessengerConversation_orgUnitId_idx" ON "MessengerConversation"("orgUnitId");

-- CreateIndex
CREATE INDEX "Notification_orgUnitId_idx" ON "Notification"("orgUnitId");

-- CreateIndex
CREATE INDEX "Order_orgUnitId_idx" ON "Order"("orgUnitId");

-- CreateIndex
CREATE INDEX "Room_orgUnitId_idx" ON "Room"("orgUnitId");

-- CreateIndex
CREATE INDEX "SataCoinTransaction_orgUnitId_idx" ON "SataCoinTransaction"("orgUnitId");

-- CreateIndex
CREATE INDEX "ShiftRegistration_orgUnitId_idx" ON "ShiftRegistration"("orgUnitId");

-- CreateIndex
CREATE INDEX "StockBalance_orgUnitId_idx" ON "StockBalance"("orgUnitId");

-- CreateIndex
CREATE INDEX "StockMovement_orgUnitId_idx" ON "StockMovement"("orgUnitId");

-- CreateIndex
CREATE INDEX "Student_orgUnitId_idx" ON "Student"("orgUnitId");

-- CreateIndex
CREATE INDEX "StudentCareTask_orgUnitId_idx" ON "StudentCareTask"("orgUnitId");

-- CreateIndex
CREATE INDEX "StudentCenterHistory_orgUnitId_idx" ON "StudentCenterHistory"("orgUnitId");

-- CreateIndex
CREATE INDEX "StudentRiskAlert_orgUnitId_idx" ON "StudentRiskAlert"("orgUnitId");

-- CreateIndex
CREATE INDEX "Survey_orgUnitId_idx" ON "Survey"("orgUnitId");

-- CreateIndex
CREATE INDEX "SurveyResponse_orgUnitId_idx" ON "SurveyResponse"("orgUnitId");

-- CreateIndex
CREATE INDEX "TimesheetAdjustmentRequest_orgUnitId_idx" ON "TimesheetAdjustmentRequest"("orgUnitId");

-- CreateIndex
CREATE INDEX "TrialClass_orgUnitId_idx" ON "TrialClass"("orgUnitId");

-- CreateIndex
CREATE INDEX "User_orgUnitId_idx" ON "User"("orgUnitId");

-- PR-A backfill: orgUnitId từ centerId qua OrgUnit.centerId (idempotent, chỉ set khi NULL).
-- Bản ghi centerId NULL hoặc trỏ Center không có OrgUnit tương ứng → orgUnitId vẫn NULL.
UPDATE "Lead" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "Order" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "Student" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "Student" t SET "preferredOrgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."preferredCenterId" AND t."preferredOrgUnitId" IS NULL;
UPDATE "Class" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "ClassGroup" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "TrialClass" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "Room" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "Holiday" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "InventoryAudit" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "StockBalance" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "StockMovement" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "Employee" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "EmployeeCheckin" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "CenterDayChecklist" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "MakeupNeed" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "Notification" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "ShiftRegistration" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "SataCoinTransaction" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "StudentCareTask" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "StudentCenterHistory" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "StudentRiskAlert" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "Survey" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "SurveyResponse" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "TimesheetAdjustmentRequest" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "MessengerConversation" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
UPDATE "User" t SET "orgUnitId" = ou.id FROM "OrgUnit" ou WHERE ou."centerId" = t."centerId" AND t."orgUnitId" IS NULL;
