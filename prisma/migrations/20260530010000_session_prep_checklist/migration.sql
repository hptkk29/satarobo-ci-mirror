-- Module Quản lý lớp phần 3 — checklist chuẩn bị phòng học
ALTER TABLE "ClassSession" ADD COLUMN "ckClean" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClassSession" ADD COLUMN "ckEquipment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClassSession" ADD COLUMN "ckKit" BOOLEAN NOT NULL DEFAULT false;
