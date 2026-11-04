-- R9 · N1-3 (docs/source-commission/12 §11.12) — `clk` «DÙNG MỘT LẦN» PHẢI ĐƯỢC GIỮ BẰNG RÀNG BUỘC CỦA DB, KHÔNG BẰNG «ĐỌC RỒI GHI».
--
-- Lỗ: `nhanReferral` hỏi «đã có referral dùng `clk` này chưa» bằng `findFirst`, còn dòng referral chỉ được ghi SAU khi lead đã tạo (ngoài giao dịch tạo lead, có chủ đích). N yêu cầu song song cùng `clk`,
-- khác `idempotencyKey`, khác SĐT ⇒ cả N cùng đọc «chưa ai dùng» ⇒ N lead mang nguồn Affiliate, N referral VALID.
--
-- Vì sao KHÔNG chỉ đặt UNIQUE trên `AffiliateReferral.clickId`: ràng buộc đó chỉ chặn được dòng referral ĐẾN SAU, khi lead của nó ĐÃ mang attribution `AFFILIATE_REFERRAL` — hạ referral xuống xem tay
-- không gỡ được attribution, mà các luật hoa hồng cấp NGUỒN vẫn đọc attribution ⇒ vẫn trả tiền cho đối tác. Phải GIỮ chỗ TRƯỚC khi tạo lead.
-- Vì sao KHÔNG thêm cột vào `ReferralClick`: bảng đó chỉ-thêm (trigger `ReferralClick_chi_them` chặn UPDATE/DELETE) — không nới trigger cho việc này.
--
-- FK `ON DELETE CASCADE`: `ReferralClick` chỉ-thêm (không ai xoá được trên prod), nên CASCADE chỉ để dọn hiện trường của test; Restrict chỉ làm mọi spec đang dọn bảng lượt bấm phải sửa theo.
--
-- Cơ chế: một dòng `AffiliateClickClaim(clickId PK → idempotencyKey)`. `INSERT` là phép giữ chỗ nguyên tử (PK): kẻ đến sau gặp lỗi trùng khoá, đọc `idempotencyKey` của dòng đang giữ —
-- cùng khoá ⇒ chính biểu mẫu đó gửi lại (vẫn HỢP LỆ); khác khoá ⇒ `clk` ĐÃ DÙNG ⇒ xem tay.
--
-- ADDITIVE, CHẠY LẠI ĐƯỢC ([MIG-01]): 1 bảng MỚI, rỗng. KHÔNG backfill (referral cũ vẫn được kiểm bằng truy vấn cũ). Chạy tay trên prod (luật Nền #4).

CREATE TABLE IF NOT EXISTS "AffiliateClickClaim" (
    "clickId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateClickClaim_pkey" PRIMARY KEY ("clickId")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AffiliateClickClaim_clickId_fkey' AND conrelid = '"AffiliateClickClaim"'::regclass) THEN
    ALTER TABLE "AffiliateClickClaim" ADD CONSTRAINT "AffiliateClickClaim_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "ReferralClick"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "AffiliateClickClaim" ENABLE ROW LEVEL SECURITY;
