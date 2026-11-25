-- Hỗ trợ Trial thành MỘT loại đơn vị công việc (chủ dự án chốt 09/11/2026: "Hỗ trợ Trial làm luôn trong PR này").
-- Chốt kỳ ghi theo phân công ghi WorkUnit TRIAL_SUPPORT đúng số engine Lương dự kiến (`xetHoTroTrial`): quantity = số học viên có
-- mặt, rateSnapshot = mức / học viên tại ngày buổi. ADDITIVE: chỉ thêm một giá trị enum — không đổi / bỏ cột, không backfill, không bảng mới
-- (không cần RLS). ⚠️ PHẢI CHẠY TAY trên prod (luật cứng #4).
ALTER TYPE "WorkUnitType" ADD VALUE IF NOT EXISTS 'TRIAL_SUPPORT';
