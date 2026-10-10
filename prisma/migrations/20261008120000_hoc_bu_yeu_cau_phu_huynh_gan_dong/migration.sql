-- T11 (08/10/2026) — Đơn xin học bù của phụ huynh gắn ĐÚNG dòng cần bù.
--
-- Trước: `ParentRequest` chỉ có `sessionId` (cột phẳng) — đơn MAKEUP gắn "buổi vắng" bằng chuỗi, không có khoá tới dòng cần bù. Khi dòng được xếp case / bù xong /
-- huỷ, đơn vẫn PENDING và chiếm trần 10 đơn mở của phụ huynh (không ai đóng nó). Nay đơn mang `makeupNeedId` (nullable, FK ON DELETE SET NULL) để hệ thống tự đóng
-- đơn khi dòng rời trạng thái "chờ xếp".
--
-- ADDITIVE: một cột nullable + chỉ mục + FK. Điền sẵn cho đơn CŨ bằng phép nối tất định duy nhất có thể: `MakeupNeed` unique (học viên, buổi gốc), đơn MAKEUP mang
-- `sessionId` = buổi gốc. Đơn không nối được (không có `sessionId`, hoặc buổi không có dòng) GIỮ NULL — không đoán.

ALTER TABLE "ParentRequest" ADD COLUMN IF NOT EXISTS "makeupNeedId" TEXT;

CREATE INDEX IF NOT EXISTS "ParentRequest_makeupNeedId_idx" ON "ParentRequest"("makeupNeedId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParentRequest_makeupNeedId_fkey') THEN
    ALTER TABLE "ParentRequest" ADD CONSTRAINT "ParentRequest_makeupNeedId_fkey"
      FOREIGN KEY ("makeupNeedId") REFERENCES "MakeupNeed"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

UPDATE "ParentRequest" pr
   SET "makeupNeedId" = n."id"
  FROM "MakeupNeed" n
 WHERE pr."type" = 'MAKEUP'
   AND pr."makeupNeedId" IS NULL
   AND pr."sessionId" IS NOT NULL
   AND n."studentId" = pr."studentId"
   AND n."missedSessionId" = pr."sessionId";
