-- Cầu nối MediaAsset ↔ ClassSessionMedia cho giai đoạn chuyển tiếp (2-phase).
-- Additive thuần: cột nullable + unique index. Không đụng dữ liệu đang có.
ALTER TABLE "MediaAsset" ADD COLUMN "legacyMediaId" TEXT;
CREATE UNIQUE INDEX "MediaAsset_legacyMediaId_key" ON "MediaAsset"("legacyMediaId");
