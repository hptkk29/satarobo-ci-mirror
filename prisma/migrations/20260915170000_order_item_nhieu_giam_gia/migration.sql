-- Chủ dự án 15/09/2026: "chỗ giảm giá cũng làm flex đi, vì 1 đơn có thể áp nhiều giảm
-- giá khác nhau."
--
-- Sáng nay giảm giá đã tách về TỪNG DÒNG (`20260915140000`), nhưng mỗi dòng chỉ giữ được
-- ĐÚNG MỘT khoản. Ưu đãi thật thì chồng lên nhau: anh chị em học cùng + đóng sớm cả khoá
-- + học bổng của riêng em đó. Nhét ba thứ vào một ô là mất tên của từng khoản, và cái
-- mất đi chính là thứ kế toán hỏi sáu tháng sau — "500.000đ này là chương trình nào".
--
-- ── VÌ SAO LÀ CỘT JSON, KHÔNG PHẢI BẢNG MỚI ──
-- Bảng `OrderItemDiscount` là hình dạng "đúng sách vở", nhưng ở repo này nó đắt hơn giá
-- trị nó mang lại:
--   · Luật cứng #3: mọi bảng MỚI có dữ liệu theo đơn vị BẮT BUỘC có `orgUnitId` ⇒ một
--     bảng tiền nữa phải tự gác scope ở mọi đường ghi, trong khi nó không bao giờ được
--     đọc độc lập với dòng đơn cha.
--   · Chốt "không tạo sổ tiền thứ tư": SỐ TIỀN của dòng vẫn là `OrderItem.discountAmount`
--     — một cột Int, một nguồn. Cột dưới đây chỉ là BẢN GIẢI THÍCH của con số đó, không
--     phải một sổ song song. Ai cộng tiền vẫn cộng `discountAmount`.
--   · `OrderItem.metadata Json?` đã là nếp có sẵn của chính bảng này (`coachFormat`,
--     `soBuoi`).
-- Khoản nào cần truy vấn theo chương trình khuyến mãi thì đó là việc của một bảng
-- `Promotion` có thật + khoá ngoại, không phải của bảng con vô danh này.
--
-- Hình dạng (mảng, thứ tự người bán gõ):
--   [{ "kieu": "SO_TIEN" | "PHAN_TRAM",
--      "giaTri": <số người bán gõ>,
--      "giam":   <số THỰC SỰ trừ được sau khi kẹp>,
--      "lyDo":   "<giải trình của riêng khoản này>" }]
--
-- ⚠️ `giaTri` và `giam` CỐ Ý là hai trường khác nhau. Khi tổng các khoản vượt tạm tính
-- của dòng, khoản cuối bị cắt bớt — `giaTri` giữ Ý ĐỊNH, `giam` giữ SỐ THẬT. Chỉ lưu một
-- trong hai là hoặc bảng hiển thị cộng không ra tổng, hoặc mất dấu việc đã cắt.

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "discounts" JSONB;

-- Dữ liệu đã ghi sáng nay (một khoản/dòng) chuyển sang hình dạng mới, để KHÔNG có dòng
-- nào mang `discountAmount > 0` mà `discounts` rỗng — đường đọc chỉ phải hiểu MỘT hình
-- dạng. Cả hai migration của hôm nay đều chưa lên `origin/main` nên đây là dữ liệu
-- nghiệm thu ở máy, không phải dữ liệu prod.
UPDATE "OrderItem"
SET "discounts" = jsonb_build_array(
      jsonb_build_object(
        'kieu',   CASE WHEN "discountPercent" IS NOT NULL THEN 'PHAN_TRAM' ELSE 'SO_TIEN' END,
        'giaTri', COALESCE("discountPercent", "discountAmount"),
        'giam',   "discountAmount",
        'lyDo',   "discountReason"
      )
    )
WHERE "discountAmount" > 0 AND "discounts" IS NULL;

-- ⚠️ BA CỘT CŨ GIỮ NGUYÊN, và giữ có định nghĩa chứ không phải giữ cho có:
--   · `discountAmount`  — TỔNG của dòng. Vẫn là con số tiền duy nhất, `Order.discountAmount`
--                         = Σ cột này. KHÔNG đổi nghĩa.
--   · `discountPercent` — chỉ còn nghĩa khi dòng có ĐÚNG MỘT khoản kiểu %. Nhiều khoản ⇒
--                         NULL, vì "phần trăm của cả dòng" lúc đó không tồn tại.
--   · `discountReason`  — ghép lý do các khoản, để hoá đơn và nhật ký cũ vẫn đọc được một
--                         chuỗi có nghĩa mà không phải biết về cột JSON.
