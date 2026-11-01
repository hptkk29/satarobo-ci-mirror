-- Đợt D, bản vá 22/08/2026 — cột KHỞI ĐIỂM của người vào vòng luân phiên.
--
-- Vì sao cần: `turns` là VỊ TRÍ trong vòng, không phải số lead đã nhận. Với
-- người có mặt từ đầu hai số trùng nhau, nhưng người vào sau được đặt ngang mức
-- thấp nhất của vòng (để không nhận dồn hàng trăm lead đuổi kịp) nên `turns` của
-- họ cao hơn số lead thật. Bảng sổ lượt tồn tại để làm BẰNG CHỨNG chống nghi
-- thiên vị — nó mà nói sai về đúng người dễ bị soi nhất thì phản tác dụng.
--
-- THUẦN THÊM MỚI, có DEFAULT 0: dòng cũ (nếu có) giữ nguyên nghĩa "vào từ đầu".
-- Quay lui = DROP COLUMN.

ALTER TABLE "LeadRotationTurn" ADD COLUMN "seedTurns" INTEGER NOT NULL DEFAULT 0;
