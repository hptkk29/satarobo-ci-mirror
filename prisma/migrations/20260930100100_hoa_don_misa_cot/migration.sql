-- HOÁ ĐƠN ĐIỆN TỬ · BƯỚC 1 "PHÁT HÀNH QUA MISA" (30/09/2026) — cột + chỉ mục.
--
-- HOÀN TOÀN ADDITIVE, CHỈ bảng "HoaDonDienTu": mọi cột mới nullable hoặc có mặc định. Bảng ra đời ở
-- 20260926100000, chưa lên `main` (đo `git ls-tree origin/main prisma/migrations` 30/09: migration cuối
-- của main là 20260925…) ⇒ 0 dòng PROD, luật cứng #4 không bị chạm. KHÔNG đụng Payment / Order /
-- Receipt / BankTransaction / PaymentRequest. KHÔNG bảng mới ⇒ KHÔNG câu RLS mới.
--
-- Chạy SAU 20260930100000 (giá trị enum mới phải đã commit — xem chú thích ở tệp đó).

-- (1) Nguồn của bản hoá đơn. Mọi dòng cũ là tệp kế toán TẢI LÊN ⇒ mặc định 'TAI_LEN'.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HoaDonNguonPhatHanh') THEN
    CREATE TYPE "HoaDonNguonPhatHanh" AS ENUM ('TAI_LEN', 'MISA_API', 'MISA_GIA_LAP');
  END IF;
END $$;
ALTER TABLE "HoaDonDienTu" ADD COLUMN IF NOT EXISTS "nguonPhatHanh" "HoaDonNguonPhatHanh" NOT NULL DEFAULT 'TAI_LEN';

-- (2) Máy trạng thái gọi MISA. `misaRefId` là khoá chống trùng của MISA (RefID) — sinh MỘT LẦN khi tạo
--     bản ghi DANG_PHAT_HANH, gửi lại dùng lại đúng giá trị. UNIQUE (NULL không đụng nhau ⇒ dòng tải lên
--     không vướng). `misaPhieu` = ĐÚNG phiếu đã gửi (JSON) — gửi lại cùng refId phải gửi cùng nội dung,
--     không dựng lại từ đơn (người mua có thể đã bị sửa giữa chừng).
ALTER TABLE "HoaDonDienTu" ADD COLUMN IF NOT EXISTS "misaRefId" TEXT,
ADD COLUMN IF NOT EXISTS "misaPhieu" JSONB,
ADD COLUMN IF NOT EXISTS "misaLoiMa" TEXT,
ADD COLUMN IF NOT EXISTS "misaLoiThongDiep" TEXT,
ADD COLUMN IF NOT EXISTS "misaSoLanGui" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "misaGuiLuc" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonDienTu_misaRefId_key" ON "HoaDonDienTu"("misaRefId");

-- (3) Cron đối soát quét bản DANG_PHAT_HANH theo lúc gửi.
CREATE INDEX IF NOT EXISTS "HoaDonDienTu_trangThai_misaGuiLuc_idx" ON "HoaDonDienTu"("trangThai", "misaGuiLuc");

-- (4) Chỉ mục TỪNG PHẦN "không hai hoá đơn CÒN SỐNG cùng (MST, ký hiệu, số)" — dựng lại để tính cả
--     DANG_PHAT_HANH: bản đã có số từ MISA mà chưa tải xong tệp VẪN là một tờ hoá đơn đang sống (MISA đã
--     phát hành), luồng tay không được gắn lại đúng số đó cho lần thu khác. LOI_PHAT_HANH không có số
--     (NULL — không đụng khoá). DROP + CREATE có chủ đích: định nghĩa mới RỘNG hơn cũ, bảng 0 dòng prod.
--
--     Khoá KHOẢN (`HoaDonKhoan_paymentId_hieuLuc_key` — WHERE "hieuLuc") KHÔNG phải sửa: nó không hỏi
--     trạng thái hoá đơn, nên bản DANG_PHAT_HANH / LOI_PHAT_HANH giữ khoản ngay khi được tạo và luồng tay
--     KHÔNG tạo được bản thứ hai song song (P2002 ⇒ "người khác vừa xử lý").
--
--     CHECK hiện có (20260927120000): `huy_du_thong_tin` (chỉ THAY_THE), `xuatTheoSoDaThu_lyDo`,
--     `khongTrung_du_thong_tin` — không cái nào ràng theo trạng thái mới ⇒ KHÔNG nới CHECK nào.
DROP INDEX IF EXISTS "HoaDonDienTu_soHoaDon_conSong_key";
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonDienTu_soHoaDon_conSong_key" ON "HoaDonDienTu" ("phapNhanMst", "kyHieu", "soHoaDon") WHERE "trangThai" IN ('NHAP', 'DA_XAC_NHAN', 'DANG_PHAT_HANH');
