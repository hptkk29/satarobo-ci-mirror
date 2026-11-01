-- PHẦN A — đảo `NG` (Công tác ngoài): 1 công / 0 cặp quét → 1 công / 1 CẶP QUÉT.
--
-- Chốt của chủ dự án: "Đảo chốt cũ: NG đang là 1 công / 0 cặp quét. Nay là 1 công / 1 CẶP
-- QUÉT." Nguồn sự thật: docs/cham-cong/BANG-MA-CA-CHOT.md; `catalog.test.ts` canh hai chiều.
--
-- ── BA VẾ PHẢI ĐI CÙNG NHAU ─────────────────────────────────────────────────────────────
--   · `soCapQuetKyVong = 1`  — một mình KHÔNG đổi gì (cổng ngoài của engine là
--                              `attendanceMode = REQUIRED`, ca OPTIONAL không chạy nhánh nào)
--   · `attendanceMode = REQUIRED` — một mình là đòi quét mà chưa có nút để bấm
--   · hai nút Check in / Check out ở màn "Của tôi" — đi cùng commit này
--
-- ── ĐO TRƯỚC KHI ĐẢO — vì sao KHÔNG cần lượt xử lý quá khứ ───────────────────────────────
-- `viec = ngay-cong-tac` trên prod, 15/09/2026:
--     ô ca công tác đã xếp (ShiftAssignment ACTIVE)   0
--     ngày công mã công tác (StaffAttendanceDay)      0
--     · chưa có đủ cặp vào/ra                         0
-- ⇒ KHÔNG ngày quá khứ nào bị gắn cờ oan. Nếu số ấy khác 0 thì đây đã là quyết định khác:
--   `lockPeriod` chạy `recomputeRange` NGAY TRƯỚC khi chốt (period.ts:445), nên đám cờ sẽ
--   mọc đúng lúc kế toán chốt kỳ rồi đóng băng vào `summaryJson`.
--
-- ── ShiftAssignment ─────────────────────────────────────────────────────────────────────
-- Prod có 0 ô ca `NG` nên UPDATE dưới đây chạm 0 dòng hôm nay. VẪN GIỮ: DB `test` và các
-- máy dev có dữ liệu khác prod, và một migration chỉ đúng trên đúng một môi trường là
-- migration sai.

UPDATE "ShiftTemplate"
   SET "soCapQuetKyVong" = 1,
       "attendanceMode"  = 'REQUIRED'
 WHERE "code" = 'NG';

UPDATE "ShiftAssignment"
   SET "soCapQuetKyVong" = 1,
       "attendanceMode"  = 'REQUIRED'
 WHERE "templateCode" = 'NG';
