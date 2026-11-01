-- QR TĨNH in ra dán tại quầy (đợt 2, chốt 07/09/2026). CHỈ THÊM một cột.
--
-- Chủ dự án chốt: "chỉ dùng 1 QR để chấm công, QR tĩnh không thay đổi nữa, in ra đặt tại các
-- trung tâm".
--
-- `qrKeyVersion` là cách DUY NHẤT thu hồi một tờ mã đã in. Không có nó thì huỷ mã = đổi
-- `NEXTAUTH_SECRET`, mà khoá đó dùng chung cho session, vé SCORM, cookie portal, OTP — đổi là
-- đá sập cả hệ thống. Mất tờ giấy, hoặc nhân viên nghỉ việc còn giữ ảnh chụp ⇒ tăng lên 1,
-- in lại, mọi ảnh cũ chết ngay.

ALTER TABLE "WorkLocation" ADD COLUMN "qrKeyVersion" INTEGER NOT NULL DEFAULT 1;
