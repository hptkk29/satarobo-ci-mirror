-- GĐ4 POS — R9 (07/10/2026), rà extension GĐ5: cặp PAYMENT + VOID (cùng RRN) rơi vào HAI LÔ khác nhau của MỘT lượt đồng
-- bộ, dòng VOID bị TỪ CHỐI ở một lô `final:false` ⇒ lô final (nơi PAYMENT đã xếp chờ được xử lý) không biết VOID đã bị từ
-- chối ở lô khác ⇒ PAYMENT đi lõi một mình ⇒ ghi thu cho lần quẹt ĐÃ HỦY. Lô chờ chỉ giữ dòng NHẬN; cột này giữ thêm
-- tín hiệu hủy/hoàn bị từ chối của lô (mã dòng · mã từ chối · RRN · quầy · giờ) — KHÔNG số thẻ, KHÔNG token, KHÔNG ghi chú.
-- Thiết kế: docs/pos-gd4-thiet-ke.md Phụ lục R9.
--
-- ADDITIVE: MỘT cột JSONB nullable trên bảng tạm `PosAgentLoCho` (sống tới lô final của lượt / cron giám sát dọn sau 1 giờ),
-- không DEFAULT, không backfill (lô chờ đang sống trước bản vá = NULL = "không có tín hiệu" = hành vi cũ). CHẠY LẠI ĐƯỢC
-- ([MIG-01]): IF NOT EXISTS. Bảng đã bật RLS ở migration 20261007130000 — cột mới thừa hưởng.
ALTER TABLE "PosAgentLoCho" ADD COLUMN IF NOT EXISTS "huyTuChoi" JSONB;
