-- G-06 — bốn nhóm trường bổ sung của module Lead.
--
-- THUẦN THÊM (additive): 7 cột nullable + 3 index. Không xoá, không đổi kiểu, không
-- NOT NULL, không DEFAULT, không khoá ngoại ⇒ mã đang chạy trên prod không thấy gì
-- khác và có thể lăn ngược mà dữ liệu vẫn nguyên.
--
-- ⚠️ CHƯA CHẠY lên môi trường nào (kể cả DB dev/test) — người vận hành chạy tay theo
-- luật cứng #4 của Nền Hệ thống.
--
-- ── "LeadChild"."closedAt" — MỐC CHỐT ────────────────────────────────────────────
-- Thời điểm một đứa con thành học viên, ghi ở đường chốt ghi danh
-- (`lib/crm/convert-lead-v2.ts`) TRONG CÙNG transaction tạo Enrollment.
-- KHÔNG backfill: con đã ghi danh trước hôm nay có `Enrollment.createdAt`, nhưng đó là
-- mốc TẠO BẢN GHI chứ không chắc là mốc chốt (có lô nhập liệu lịch sử, có ca backfill
-- tiền cũ). Đoán ngược là bịa một mốc rồi để C-03 tính "thời gian chốt" trên số bịa đó.
--
-- ── "LeadChild"."contractValue" — GIÁ TRỊ HỢP ĐỒNG ĐÃ KÝ (VND) ───────────────────
-- 🔴 KHÔNG PHẢI DOANH THU. Doanh thu lấy từ `Payment` đã xác nhận (quyết định B3 +
-- OQ-G2 ngày 24/08/2026). INTEGER là đủ: trần nghiệp vụ 5 tỷ, còn xa mức 2.147.483.647.
--
-- ── "Lead"."campaignName"/"campaignId"/"adsetId"/"adId" — MÃ CAMPAIGN ────────────
-- Nối lead ↔ chi tiêu quảng cáo cho CPL/CPA (D-04/D-05). KHÁC nhóm "utm*" đã có: utm*
-- là nhãn đọc từ URL website, còn lead Messenger-first không đi qua website nên không
-- có utm nào. "campaignName" lưu mã theo quy ước SR.QD.232 NGUYÊN VĂN — khuôn chỉ có
-- một bản, ở `lib/ads/campaign-code.ts`.
--
-- ── "Lead"."nextFollowUpAt" — NGÀY HẸN KẾ TIẾP ───────────────────────────────────
-- Thuộc tính của phiếu ("lần sau gọi khi nào"), KHÁC "LeadTask"."dueAt" là bảng việc.
-- Cố ý không suy từ LeadTask: hai nguồn cho một câu hỏi là hai con số sẽ lệch nhau.

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "campaignName" TEXT;
ALTER TABLE "Lead" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "adsetId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "adId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "nextFollowUpAt" TIMESTAMPTZ(6);

ALTER TABLE "LeadChild" ADD COLUMN "closedAt" TIMESTAMPTZ(6);
ALTER TABLE "LeadChild" ADD COLUMN "contractValue" INTEGER;

-- CreateIndex
CREATE INDEX "Lead_campaignId_idx" ON "Lead"("campaignId");
CREATE INDEX "Lead_nextFollowUpAt_idx" ON "Lead"("nextFollowUpAt");
CREATE INDEX "LeadChild_closedAt_idx" ON "LeadChild"("closedAt");
