-- PHIÊN C · Cấp phát mã phiếu 5 ký tự — SEQUENCE. Additive thuần.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- VÌ SAO SEQUENCE, KHÔNG PHẢI MỘT BẢNG ĐẾM
--
-- `sinhMa(soThuTu)` (lib/payments/ma-phieu.ts) nhận một SỐ THỨ TỰ và là hàm thuần. Thứ còn
-- thiếu là một nguồn số thứ tự KHÔNG BAO GIỜ cấp lại cùng một số — kể cả khi hai sale bấm
-- "In QR" cùng lúc, kể cả khi transaction của một trong hai bị rollback.
--
-- `nextval()` làm đúng điều đó và là thứ DUY NHẤT trong Postgres làm được: nó KHÔNG theo
-- transaction. Rollback rồi thì số đã cấp mất luôn — và mất số là ĐÚNG ở đây, vì luật của
-- repo là "mã không tái sử dụng". Một bảng đếm với `UPDATE ... RETURNING` thì ngược lại: nó
-- khoá hàng, mọi lượt phát hành xếp hàng sau nhau, và rollback trả lại số đã cấp — tức hai
-- phiếu có thể mang cùng một mã nếu lượt đầu rollback sau khi lượt sau đã đọc.
--
-- ⚠️ Kho mã là 21 × 27³ = 413.343 (xem `DUNG_LUONG`). Sequence KHÔNG có trần, nên phần canh
-- trần nằm ở tầng mã: `sinhMa` NÉM khi số thứ tự ≥ kho, và `tinhTrangKhoMa` cảnh báo từ 50%.
-- Đặt `MAXVALUE` ở đây sẽ biến "cạn kho" thành một lỗi SQL thô giữa lượt phát hành QR, thay
-- vì một câu tiếng Việt ở tầng trên.
--
-- ⚠️ `nextval` trả từ 1, còn `sinhMa` nhận 0..kho−1. Phép trừ 1 nằm ở `capPhatSoThuTu()`
-- (lib/payments/cap-phat-ma.ts) — MỘT chỗ, có test. Đừng trừ lần nữa ở chỗ gọi.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ KHÔNG ĐỤNG `PaymentBill_matchKey_key`, VÀ ĐÂY LÀ LÝ DO — ĐO, KHÔNG SUY
--
-- Spec của phiên này yêu cầu *"unique partial index PaymentBill.matchKey WHERE NOT NULL"*.
-- Chỉ mục ấy đã có sẵn và ĐÃ đủ:
--
--   20260916120000_payment_request_theo_con/migration.sql:146
--   CREATE UNIQUE INDEX IF NOT EXISTS "PaymentBill_matchKey_key" ON "PaymentBill"("matchKey");
--
-- Postgres coi **mỗi NULL là khác nhau** trong chỉ mục unique (chuẩn SQL, và `NULLS NOT
-- DISTINCT` phải khai tường minh mới đổi được — ở đây không khai). Nên chỉ mục hiện tại đã
-- cho phép vô số dòng `matchKey IS NULL` và chặn đúng các giá trị không-NULL trùng nhau —
-- tức nó ĐÃ là thứ mà bản partial định đạt được.
--
-- Đổi sang partial chỉ tiết kiệm chỗ chứa cho các dòng NULL. Cái giá: DROP rồi CREATE một
-- chỉ mục UNIQUE trên bảng PROD — trong khoảnh khắc giữa hai lệnh, ràng buộc chống trùng mã
-- KHÔNG còn, và `CREATE UNIQUE INDEX` (không `CONCURRENTLY`) khoá ghi cả bảng. Trả giá đó
-- cho 0 thay đổi hành vi là vi phạm tinh thần luật cứng #4.
--
-- Muốn đổi thì đó là ticket riêng, dùng `CREATE UNIQUE INDEX CONCURRENTLY` tên khác trước,
-- rồi mới DROP cái cũ — và phải có lý do đo được (kích thước chỉ mục) để biện minh.

CREATE SEQUENCE IF NOT EXISTS "payment_bill_ma_seq"
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MAXVALUE
  NO CYCLE;

COMMENT ON SEQUENCE "payment_bill_ma_seq" IS
  'PHIÊN C — số thứ tự cấp phát mã phiếu 5 ký tự. nextval trả từ 1; lib/payments/cap-phat-ma.ts trừ 1 rồi hoán vị trước khi gọi sinhMa(). Không tái sử dụng số: rollback làm mất số là ĐÚNG.';
