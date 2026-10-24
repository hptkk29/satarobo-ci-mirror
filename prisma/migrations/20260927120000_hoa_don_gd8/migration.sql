-- HOÁ ĐƠN ĐIỆN TỬ · GĐ 8 (docs/ke-toan-hoa-don/PLAN.md "Điều chỉnh khi thi công GĐ 8").
--
-- HOÀN TOÀN ADDITIVE, CHỈ bảng "HoaDonDienTu" — bảng ra đời ở 20260926100000, có trên `test`, CHƯA lên
-- `main` ⇒ 0 dòng PROD (luật cứng #4 không bị chạm). KHÔNG đụng Payment / Order / Receipt /
-- BankTransaction / PaymentRequest. KHÔNG bảng mới ⇒ KHÔNG câu RLS mới (RLS của "HoaDonDienTu" đã ENABLE
-- ở 20260926100000).
--
-- ⚠️ Ba CHECK dưới đây CHỈ có ở đây — Prisma không biểu diễn CHECK nên kiểm drift không hiện chúng.
--    NOT VALID theo tiền lệ 20260921160000_dung_hoc_mot_con: dòng cũ không quét lại, mọi INSERT/UPDATE
--    từ nay vẫn bị kiểm. Độ dài tối thiểu của lý do nằm ở MÃ (TOI_THIEU_LY_DO_HOA_DON — một nguồn); DB
--    chỉ chặn rỗng. CHECK coi NULL là QUA ⇒ vế lý do luôn viết "IS NOT NULL AND btrim(...) <> ''".

-- (1) Quyết định (1) 27/09 — HUỶ hoá đơn đã xác nhận. KHÔNG dùng lại "lyDo" (đang mang lý do KHONG_XUAT).
--     Giữ giá trị enum THAY_THE (nghĩa nay: "đã huỷ — bản thay có thể CHƯA có"); không ALTER TYPE.
ALTER TABLE "HoaDonDienTu" ADD COLUMN "huyLyDo" TEXT,
ADD COLUMN "huyBoiId" TEXT,
ADD COLUMN "huyLuc" TIMESTAMPTZ(6);

-- (2) Q-mở 1 — lần thu THIẾU vẫn xuất "theo số đã thu": lý do ở cột RIÊNG.
ALTER TABLE "HoaDonDienTu" ADD COLUMN "xuatTheoSoDaThuLyDo" TEXT;

-- (3) Quyết định (2) 27/09 — kế toán xác nhận lần thu NGHI TRÙNG là "không trùng", lưu TRÊN hoá đơn.
ALTER TABLE "HoaDonDienTu" ADD COLUMN "khongTrungLyDo" TEXT,
ADD COLUMN "khongTrungBoiId" TEXT,
ADD COLUMN "khongTrungLuc" TIMESTAMPTZ(6);

-- (4) Tra "tệp PDF này đã gắn cho hoá đơn còn sống nào chưa" theo vân tay. Kiểm ở MÃ dưới khoá advisory,
--     KHÔNG làm UNIQUE: DB test đã bật cờ có thể đang giữ bản trùng ⇒ migrate-test.yml sập.
CREATE INDEX "HoaDonDienTu_tepPdfSha256_idx" ON "HoaDonDienTu"("tepPdfSha256");

-- (5) "thayTheChoId" từ nay CÓ người ghi (bản kế tiếp tự nối về bản đã huỷ) ⇒ khoá ngoại tự tham chiếu.
--     NO ACTION (KHÔNG RESTRICT): kiểm ở CUỐI câu lệnh ⇒ một DELETE dọn cả chuỗi theo orderId (fixture
--     test) không đỏ oan theo thứ tự dòng; xoá lẻ bản đang bị trỏ vẫn bị chặn.
--     Chỉ mục "HoaDonDienTu_thayTheChoId_idx" đã có từ 20260926100000.
ALTER TABLE "HoaDonDienTu" ADD CONSTRAINT "HoaDonDienTu_thayTheChoId_fkey" FOREIGN KEY ("thayTheChoId") REFERENCES "HoaDonDienTu"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- (6) Bất biến chỉ ở DB.
ALTER TABLE "HoaDonDienTu" ADD CONSTRAINT "HoaDonDienTu_huy_du_thong_tin_check"
  CHECK ("trangThai" <> 'THAY_THE'
         OR ("huyLuc" IS NOT NULL AND "huyBoiId" IS NOT NULL
             AND "huyLyDo" IS NOT NULL AND btrim("huyLyDo") <> '')) NOT VALID;

ALTER TABLE "HoaDonDienTu" ADD CONSTRAINT "HoaDonDienTu_xuatTheoSoDaThu_lyDo_check"
  CHECK (NOT "xuatTheoSoDaThu"
         OR ("xuatTheoSoDaThuLyDo" IS NOT NULL AND btrim("xuatTheoSoDaThuLyDo") <> '')) NOT VALID;

ALTER TABLE "HoaDonDienTu" ADD CONSTRAINT "HoaDonDienTu_khongTrung_du_thong_tin_check"
  CHECK (("khongTrungLyDo" IS NULL AND "khongTrungBoiId" IS NULL AND "khongTrungLuc" IS NULL)
         OR ("khongTrungLyDo" IS NOT NULL AND btrim("khongTrungLyDo") <> ''
             AND "khongTrungBoiId" IS NOT NULL AND "khongTrungLuc" IS NOT NULL)) NOT VALID;
