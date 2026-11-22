-- AI LEAD GATEWAY — QUY TẮC THEO PAGE (E2, 09/11/2026): cờ "tự tạo lead" RIÊNG của từng Page.
-- Bối cảnh: `ai.autoCreateEnabled` là công tắc TOÀN HỆ (mặc định tắt). Khi bật thử, chủ dự án cần bật tự tạo lead CHỈ cho MỘT Page thử.
--
-- ⚠️ CHỈ THÊM: một cột, bảng `AiLeadAgentPage` do Gateway sở hữu (mới từ 20261108090000, chưa có dòng nào trên PROD). Không backfill, không seed, không DROP/ALTER cột cũ.
-- ⚠️ MẶC ĐỊNH TẮT (`DEFAULT false`): dòng cũ và mọi dòng tạo sau mà không khai ⇒ KHÔNG tự tạo lead. Đổi mặc định sang true là mở toang đường tự tạo lead cho mọi Page.
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): `ADD COLUMN IF NOT EXISTS` — một lượt bị ngắt giữa chừng không để lại dòng FAILED chặn `migrate deploy` (P3009).
-- Không phải bảng mới ⇒ không cần RLS.

ALTER TABLE "AiLeadAgentPage" ADD COLUMN IF NOT EXISTS "autoCreate" BOOLEAN NOT NULL DEFAULT false;
