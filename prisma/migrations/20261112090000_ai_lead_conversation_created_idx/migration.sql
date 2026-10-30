-- AI LEAD GATEWAY — CHỈ MỤC CHO ĐẾM CUỘC TRÒ CHUYỆN MỚI THEO NGÀY (12/11/2026).
-- Bối cảnh: Trung tâm kết nối đếm cuộc trò chuyện mới hôm nay theo (Agent, Page) bằng `WHERE agentId IN (...) AND createdAt >= <nửa đêm VN>`. Bảng `AiLeadConversation` không bao giờ xoá dòng nên nếu thiếu chỉ mục này
-- mỗi lần mở trang phải quét mọi cuộc trò chuyện của các Agent đó, chi phí tăng mãi.
--
-- ⚠️ CHỈ THÊM: một chỉ mục trên bảng của chính gói AI Lead (chưa có dòng nào trên PROD). Không đổi/xoá cột, không backfill.
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): `IF NOT EXISTS`. Tên theo quy ước Prisma (`Bang_cot1_cot2_idx`).

CREATE INDEX IF NOT EXISTS "AiLeadConversation_agentId_createdAt_idx" ON "AiLeadConversation"("agentId", "createdAt");
