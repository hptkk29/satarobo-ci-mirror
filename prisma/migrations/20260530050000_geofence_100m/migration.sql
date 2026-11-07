-- Module Chấm công PHẦN 1 — geofence chuẩn 100m (bỏ token xoay 30s)

-- AlterColumn default
ALTER TABLE "Center" ALTER COLUMN "allowedRadiusMeters" SET DEFAULT 100;

-- Chuẩn hoá các cơ sở đang để mặc định cũ 150m về 100m
UPDATE "Center" SET "allowedRadiusMeters" = 100 WHERE "allowedRadiusMeters" = 150;
