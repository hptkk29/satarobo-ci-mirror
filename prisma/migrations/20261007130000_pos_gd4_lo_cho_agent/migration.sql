-- GĐ4 POS — RÀ ĐỐI KHÁNG (07/10/2026), phát hiện RV-04: lô `final:false` của MỘT lượt đồng bộ XẾP CHỜ ở đây; lô
-- `final:true` xử lý CẢ LƯỢT như MỘT file (tập hủy của cả lượt — cặp PAYMENT + VOID rơi vào hai lô không còn ghi
-- tiền cho lần quẹt đã hủy), rồi xoá. Thiết kế: docs/pos-gd4-thiet-ke.md phụ lục "RÀ ĐỐI KHÁNG" + §5.1.
--
-- ADDITIVE: một bảng mới, không đụng bảng/cột có dữ liệu. CHẠY LẠI ĐƯỢC ([MIG-01]): mọi CREATE có IF NOT EXISTS,
-- khoá ngoại + CHECK bọc pg_constraint.
--
-- Không cột đơn vị (ngoại lệ có chủ đích — khuôn `PosAgentNonce`, T21): bảng TẠM của MỘT máy đồng bộ, khoá theo
-- agent đã xác thực, không màn nào / `scopedDb` nào đọc; sống tới lô final của lượt (hoặc cron giám sát dọn sau
-- 1 giờ nếu lượt bỏ dở).
CREATE TABLE IF NOT EXISTS "PosAgentLoCho" (
  "agentId"    TEXT NOT NULL,
  "syncId"     TEXT NOT NULL,
  "batchIndex" INTEGER NOT NULL,
  "dong"       JSONB NOT NULL,
  "createdAt"  TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosAgentLoCho_pkey" PRIMARY KEY ("agentId", "syncId", "batchIndex")
);
CREATE INDEX IF NOT EXISTS "PosAgentLoCho_createdAt_idx" ON "PosAgentLoCho"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosAgentLoCho_batchIndex_check') THEN
    ALTER TABLE "PosAgentLoCho" ADD CONSTRAINT "PosAgentLoCho_batchIndex_check" CHECK ("batchIndex" >= 0 AND "batchIndex" <= 999);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PosAgentLoCho_agentId_fkey') THEN
    ALTER TABLE "PosAgentLoCho" ADD CONSTRAINT "PosAgentLoCho_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "PosAgent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Chỉ ENABLE, không FORCE, không policy (khuôn 20261007120000_pos_gd4_pos_agent).
ALTER TABLE "PosAgentLoCho" ENABLE ROW LEVEL SECURITY;
