-- "Thu học phí theo phạm vi học" — PR5 (13/10/2026), quyết định 1 của chủ dự án: FREE_MAKEUP KHÔNG trừ quyền học chính.
--
--   "freeMakeupSessions" = số bài học bù MIỄN PHÍ, liền từ "startLessonOrder" (gói trọn vào trễ trong ngưỡng; mua tiếp mà lớp đã đi qua vài bài).
--   Các bài này VẪN nằm trong [start,end] nhưng không có dòng "StudyEntitlementUsage" nào và `tinhConLai` trừ chúng ra, để quyền học hết đúng lúc lớp
--   dạy xong bài cuối (không kẹt remaining = D). Cùng quy ước TIỀN TỐ với "skippedSessions"; hai tiền tố không bao giờ cùng > 0 (gói trọn: FREE_MAKEUP
--   và OVER_CAP_SKIPPED loại trừ nhau; mua tiếp không có bài bỏ qua).
--
-- ADDITIVE, chạy lại được: ADD COLUMN IF NOT EXISTS + DEFAULT 0 (mọi dòng cũ = 0 ⇒ hành vi cũ nguyên văn, không backfill, không UPDATE/DELETE),
-- CHECK thêm trong khối DO có điều kiện (cùng khuôn "20261013100000_quyen_hoc_nen"). CHECK cố ý KHÔNG nhắc "consumedSessions": ràng buộc cũ
-- "StudyEntitlement_consumed_chk" đã giữ consumed + skipped <= purchase, và một CHECK mới ở đường ghi điểm danh là rủi ro không cần.
ALTER TABLE "StudyEntitlement" ADD COLUMN IF NOT EXISTS "freeMakeupSessions" INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudyEntitlement_free_makeup_chk') THEN
    ALTER TABLE "StudyEntitlement" ADD CONSTRAINT "StudyEntitlement_free_makeup_chk"
      CHECK ("freeMakeupSessions" >= 0 AND ("freeMakeupSessions" = 0 OR "skippedSessions" = 0) AND "freeMakeupSessions" + "skippedSessions" <= "purchaseSessions");
  END IF;
END $$;
