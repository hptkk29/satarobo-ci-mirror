-- PHIÊN F2 · US-18 AC2 — BẢO LƯU: dời hạn đợt chưa tới hạn.
--
-- ADDITIVE, hai cột NULLABLE trên `PaymentRequest`. Không đổi kiểu cột nào, không DROP gì,
-- không đụng một dòng dữ liệu nào đang có (luật cứng #4).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VÌ SAO HAI CỘT NÀY, VÀ VÌ SAO KHÔNG THÊM `OrderItemStatus.PAUSED`
--
-- Nguồn sự thật của "bé nào đang bảo lưu" ĐÃ CÓ: `StudentReserve` (isActive · startedAt ·
-- expectedEndAt · enrollmentId). Chép trạng thái ấy xuống `OrderItem.status` là mở một
-- đường LỆCH, vì có tới BA cửa bảo lưu (màn học viên · duyệt yêu cầu PH · học lại) và chỉ
-- cần một cửa quên ghi. Lý lẽ đầy đủ ở đầu `lib/finance/bao-luu-con.ts`.
--
-- Thứ `StudentReserve` KHÔNG trả lời được, và là thứ hai cột này sinh ra để trả lời:
--   · `pauseShiftReserveId` — đợt này ĐÃ được dời chưa, vì LƯỢT BẢO LƯU NÀO. Đây là khoá
--     chống dời hai lần. Không có nó thì bấm lại nút bảo lưu (hoặc chạy lại phép nối) là
--     hạn trôi thêm một lượt nữa, và không ai biết vì hạn mới trông vẫn hợp lý.
--   · `pauseShiftDays`      — tổng số ngày đợt này đã bị dời (CỘNG DỒN qua nhiều lượt bảo
--     lưu). Để màn hình nói thật: "hạn 22/11 (đã dời 30 ngày do bảo lưu)".
--
-- ⚠️ `pauseShiftReserveId` là cột TRẦN, KHÔNG FK — cùng nếp với `createdByUserId` của
-- `StudentReserve` ("actor snapshots — no FK (defensive)"). Lý do ở đây mạnh hơn: nó là
-- DẤU VẾT trên sổ tiền. `StudentReserve` bị xoá (cascade theo `Student`) thì phép dời hạn
-- vẫn đã xảy ra thật, và một FK `ON DELETE SET NULL` sẽ âm thầm xoá khoá chống dời hai lần
-- của những đợt ấy.
--
-- Idempotent toàn bộ (`IF NOT EXISTS`): migration của F2 mang dấu thời gian SAU
-- `20260921160000_dung_hoc_mot_con` nhưng trên PROD hai đợt có thể lên theo thứ tự khác —
-- bài học c06. Chạy lại lần hai phải im lặng, không đỏ.

ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "pauseShiftReserveId" TEXT;
ALTER TABLE "PaymentRequest" ADD COLUMN IF NOT EXISTS "pauseShiftDays" INTEGER;

-- Chỉ mục trên `pauseShiftReserveId`: đường đọc thật là "lượt bảo lưu X đã dời những đợt
-- nào" (màn hình + phép chống dời hai lần khi bấm lại). Không có chỉ mục thì nó quét cả
-- bảng phiếu thu, và bảng ấy chỉ to lên.
CREATE INDEX IF NOT EXISTS "PaymentRequest_pauseShiftReserveId_idx"
  ON "PaymentRequest" ("pauseShiftReserveId");
