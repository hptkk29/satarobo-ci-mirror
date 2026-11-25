-- T03 (Học bù · lịch lớp) — hai thứ, CẢ HAI chỉ thêm, không đổi/xoá gì đang có.
--
-- 1) Dấu "CHỈNH TAY" trên buổi học. Trước đây không cột nào cho biết một buổi do ai đặt tay, nên mọi lần áp lại
--    lịch (đổi giai đoạn, ngày nghỉ, xếp lại theo khai giảng) đều coi buổi chỉnh tay như buổi thường và dời nó.
--    `NOT NULL DEFAULT false`: cột có giá trị hằng nên Postgres chỉ ghi metadata, không viết lại bảng; và không
--    lọc nào phải lo `NULL <> true` loại nhầm hàng cũ.
--    KHÔNG backfill: không có lịch sử nào cho biết buổi cũ nào được chỉnh tay (đường sửa tay chính từng không
--    ghi audit) — đoán là bịa. Buổi cũ giữ `false`.
--
-- 2) Chỉ mục duy nhất TỪNG PHẦN: một lớp không có hai buổi CÒN SỐNG cùng một thời điểm. Buổi đã HUỶ rời khỏi
--    phạm vi (một buổi huỷ rồi sinh lại đúng giờ đó là hợp lệ).
--    Bản ghi trùng đang có làm CREATE UNIQUE INDEX hỏng và kéo cả đợt deploy xuống — nên CHỈ tạo khi dữ liệu
--    sạch; còn trùng thì bỏ qua kèm NOTICE (xem `scripts/don-buoi-lop-trung.ts`, dry-run mặc định) rồi tạo
--    chỉ mục bằng chính script đó. Mã ứng dụng KHÔNG được dựa vào chỉ mục để đúng: khoá + kiểm trong khoá
--    ở `lib/classes/buoi-ghi.ts` là hàng rào chính, chỉ mục là hàng rào cuối.
--
--    Prisma không biểu diễn được chỉ mục từng phần ⇒ KHÔNG khai trong schema.prisma (chỉ chú thích), giống
--    `UserGroup_name_active_key`. Tên theo quy ước `Bang_cot_key` để `migrate diff` không đòi đổi tên.

ALTER TABLE "ClassSession"
  ADD COLUMN IF NOT EXISTS "manualOverride"     BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "manualOverrideAt"   TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "manualOverrideById" TEXT;

DO $$
DECLARE
  so_nhom_trung integer;
BEGIN
  SELECT COUNT(*) INTO so_nhom_trung
  FROM (
    SELECT 1
    FROM "ClassSession"
    WHERE "status" <> 'CANCELLED'
    GROUP BY "classId", "date"
    HAVING COUNT(*) > 1
  ) t;

  IF so_nhom_trung > 0 THEN
    RAISE NOTICE 'T03: BỎ QUA tạo ClassSession_class_date_active_key — còn % nhóm buổi trùng (classId, date). Dọn bằng scripts/don-buoi-lop-trung.ts rồi tạo chỉ mục.', so_nhom_trung;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "ClassSession_class_date_active_key"
      ON "ClassSession" ("classId", "date")
      WHERE "status" <> 'CANCELLED';
  END IF;
END $$;
