-- EL-15c — bù SLA khi người chấm trễ + đóng băng khung của lượt nộp.
--
-- CHỈ THÊM CỘT, không ALTER kiểu, không DROP. Ba cột, cả ba có DEFAULT nên
-- `ADD COLUMN` không viết lại bảng và không khoá lâu.
--
-- ⚠️ `TrnEnrollment` LÀ BẢNG ĐANG CÓ DỮ LIỆU PROD (luật cứng #4). Đây là thêm cột
-- có DEFAULT — an toàn — nhưng vẫn phải do Dev chạy TAY, không để CI tự chạy.
--
-- ⚠️ Bản diff tự sinh của `prisma migrate diff --from-migrations` còn kèm 15 khối
-- TRÔI LỆCH có sẵn của repo (`DROP INDEX "OrgUnit_path_idx"` + hàng loạt
-- `ALTER COLUMN ... SET DATA TYPE TIMESTAMP(3)` trên bảng PROD, tức vứt múi giờ).
-- Toàn bộ phần đó đã bị LOẠI — xem quy ước trong docs/elearning/quy-uoc-nen.md.

-- Ngày LÀM VIỆC được miễn trừ vì người chấm trễ SLA. Xem chú thích trong schema.
ALTER TABLE "TrnEnrollment" ADD COLUMN "slaGraceDays" INTEGER NOT NULL DEFAULT 0;

-- Khung chấm đóng băng tại thời điểm nộp + sổ bù SLA của lượt nộp.
ALTER TABLE "TrnSubmission" ADD COLUMN "rubricId" TEXT;
ALTER TABLE "TrnSubmission" ADD COLUMN "slaBuNgayLam" INTEGER NOT NULL DEFAULT 0;
