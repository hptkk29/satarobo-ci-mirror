-- Phase F3 — add ADJUSTMENT_INCREASE + ADJUSTMENT_DECREASE values to
-- StockMovementType so kiểm-kê (audit) deltas can be recorded as
-- proper movements instead of silent balance edits.
--
-- Postgres rule: newly-added enum values can't be used in the SAME
-- transaction they were created in. This migration only ADDs values;
-- runtime code (recordAdjustment) runs in separate transactions so it
-- can use them immediately after deploy.
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT_INCREASE';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'ADJUSTMENT_DECREASE';
