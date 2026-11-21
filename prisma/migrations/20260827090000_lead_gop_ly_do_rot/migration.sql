-- GỘP hai cột lý do lead rớt về MỘT: `Lead.lostNote` — gỡ `Lead.dropReason`.
--
-- VÌ SAO: hai cột trả lời cùng một câu hỏi ("phiếu này rụng vì sao") và ra đời từ hai
-- luồng làm song song. `lostNote` (+ `lostAt`) là tính năng đang chạy thật: đánh dấu
-- rớt theo TỪNG CON, bảng "Lead rớt" ở dashboard QLCS, nhãn trong lịch sử thay đổi.
-- `dropReason` sinh ở GĐ1 và chỉ có đúng một người đọc (khối "Lead rụng ở bậc nào"
-- trong báo cáo lead). Giữ cột giàu, bỏ cột nghèo.
--
-- KHÔNG đụng `droppedAtStage`: nó trả lời câu KHÁC — rụng ở BẬC nào — và không có
-- cột nào bên kia làm thay.
--
-- CHUYỂN DỮ LIỆU TRƯỚC KHI GỠ. `COALESCE` chứ không ghi đè: `lostNote` đã có giá trị
-- nghĩa là có con được đánh dấu rớt kèm lý do — đó là dữ liệu do người nhập, thắng
-- giá trị của cột đang bị bỏ. `lostAt` lấy theo mốc đổi trạng thái gần nhất, và cũng
-- chỉ điền khi đang trống.
UPDATE "Lead"
SET
  "lostNote" = COALESCE("lostNote", "dropReason"),
  "lostAt"   = COALESCE("lostAt", "statusChangedAt", NOW())
WHERE "dropReason" IS NOT NULL
  AND btrim("dropReason") <> '';

-- Trên PROD cột này CHƯA TỪNG tồn tại: toàn bộ migration GĐ0–GĐ6 còn chưa apply, nên
-- prod sẽ chạy "thêm cột" (20260825120000) rồi "gỡ cột" (bản này) trong cùng một lượt
-- — không mất gì. Trên dev/test cột có thật, nên lệnh UPDATE ở trên mới là phần việc.
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "dropReason";
