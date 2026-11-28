-- 16/10/2026 — HOA HỒNG THEO NGUỒN · Hướng G: GIẢI THÍCH «VÌ SAO 0đ» (khoản thu hút ngoài cửa sổ ghi công).
-- Thiết kế: scratchpad sc2.md · docs/source-commission/08-nguon-dong.md §14 mục 22 (R1-M3) · lib/hoa-hong/giai-thich-khong-tien.ts.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): 1 bảng MỚI + 1 hàm trigger MỚI. KHÔNG cột nào trên bảng có sẵn, KHÔNG backfill, KHÔNG đụng sổ.
-- Rollback = ngừng ghi (xoá lời gọi `ghiGiaiThich`); bảng nằm im. Đơn cũ KHÔNG có giải thích cho tới khi lượt quét kế tiếp tự chữa (chỉ khi ô đã khớp).
--
-- Vì sao MỘT BẢNG RIÊNG chứ không phải dòng 0đ trong sổ / hàng chờ / tính lại lúc đọc:
--   · sổ có CHECK "amount" <> 0 và mọi tổng · kỳ · bảng chi · đối soát đọc nó;
--   · hàng chờ là bảng công việc (sửa được) — thêm việc không ai làm là làm hỏng hàng chờ;
--   · tính lại lúc đọc dùng chủ nguồn / chính sách / tỉ lệ CỦA HÔM NAY ⇒ lịch sử tiền «trôi».
-- Bảng này KHÔNG có `periodId`, KHÔNG vào tổng, KHÔNG vào bảng chi, KHÔNG vào đối soát, KHÔNG làm INPUT_DRIFT.
--
-- Bảng sinh ra đã có CẢ HAI cột đơn vị (luật Nền #3, đính chính 27/08): `centerId` (cột cách ly đang đọc thật) + `orgUnitId` (hướng đích) — khai đủ SCOPED_MODELS ·
-- getModelPrefixes · BACKFILL_SPECS. KHÔNG có `leadId`: bảng con của ô tính, đọc qua ô ⇒ không phải khai ở COT_DA_BIET của gop-lead.
-- Chỉ MỘT khoá ngoại (ô tính, RESTRICT) như chính `CommissionCalcSlot` (vai · nhóm nguồn · chính sách · người là ảnh chụp bằng id, không FK: giải thích phải sống lâu hơn thay đổi master).
--
-- ⚠️ Prisma 5 KHÔNG đọc CHECK/trigger/RLS ⇒ kiểm drift `--from-url` không thấy chúng: lưới là ca DB [GTK-D3] (trigger) và [GTK-D4] (CHECK).
-- Chạy lại được ([MIG-01]): bảng/chỉ mục IF NOT EXISTS, FK/CHECK kiểm pg_constraint, CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

CREATE TABLE IF NOT EXISTS "CommissionExplainLine" (
  "id"                     TEXT NOT NULL,
  "calcSlotId"             TEXT NOT NULL,
  "paymentId"              TEXT NOT NULL,
  "roleCode"               TEXT NOT NULL,
  "beneficiaryRoleId"      TEXT NOT NULL,
  -- 'USER:<id>' | 'AFFILIATE:<id>' | '-' — NOT NULL để UNIQUE có tác dụng (Postgres coi NULL là khác nhau).
  "beneficiaryKey"         TEXT NOT NULL,
  "beneficiaryKind"        "CommissionBeneficiaryKind",
  "beneficiaryUserId"      TEXT,
  "beneficiaryAffiliateId" TEXT,
  "beneficiaryName"        TEXT,
  -- Mã máy của lý do (vd ATTRIBUTION_WINDOW_EXPIRED). KHÔNG CHECK danh sách: thêm mã sau không cần migration.
  "reasonCode"             TEXT NOT NULL,
  "sourceGroupId"          TEXT NOT NULL,
  "sourceGroupCode"        TEXT NOT NULL,
  "transactionTypeCode"    TEXT NOT NULL,
  "policyId"               TEXT NOT NULL,
  "policyVersionId"        TEXT NOT NULL,
  "versionNo"              INTEGER NOT NULL,
  "ruleId"                 TEXT NOT NULL,
  "documentNumber"         TEXT NOT NULL,
  "calcKind"               "CommissionCalcKind" NOT NULL,
  "rate"                   DECIMAL(9,6),
  "fixedAmount"            INTEGER,
  -- Tiền LẼ RA có — KHÔNG phải khoản nợ, KHÔNG vào tổng nào.
  "wouldBeAmount"          INTEGER NOT NULL,
  "netBase"                INTEGER NOT NULL,
  "naturalPeriod"          TEXT NOT NULL,
  -- { attributedAt, ngayThuDau, cuaSoNgay, hanGhiCong, soNgayTre } — attributionId nằm ở đây, KHÔNG có FK (khỏi động tới gop-lead).
  "details"                JSONB NOT NULL,
  "inputHash"              TEXT NOT NULL,
  "createdAt"              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "centerId"               TEXT NOT NULL,
  "orgUnitId"              TEXT NOT NULL,
  CONSTRAINT "CommissionExplainLine_pkey" PRIMARY KEY ("id")
);

-- Tên khoá UNIQUE đặt tay: tên Prisma mặc định (`..._calcSlotId_roleCode_beneficiaryKey_reasonCode_inputHash_key`) dài 80 ký tự, quá trần 63 của Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionExplainLine_khoa_key"
  ON "CommissionExplainLine"("calcSlotId", "roleCode", "beneficiaryKey", "reasonCode", "inputHash");
CREATE INDEX IF NOT EXISTS "CommissionExplainLine_centerId_naturalPeriod_idx" ON "CommissionExplainLine"("centerId", "naturalPeriod");
CREATE INDEX IF NOT EXISTS "CommissionExplainLine_beneficiaryUserId_idx" ON "CommissionExplainLine"("beneficiaryUserId");
CREATE INDEX IF NOT EXISTS "CommissionExplainLine_sourceGroupId_idx" ON "CommissionExplainLine"("sourceGroupId");
CREATE INDEX IF NOT EXISTS "CommissionExplainLine_paymentId_idx" ON "CommissionExplainLine"("paymentId");
CREATE INDEX IF NOT EXISTS "CommissionExplainLine_orgUnitId_idx" ON "CommissionExplainLine"("orgUnitId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionExplainLine_calcSlotId_fkey') THEN
    ALTER TABLE "CommissionExplainLine" ADD CONSTRAINT "CommissionExplainLine_calcSlotId_fkey"
      FOREIGN KEY ("calcSlotId") REFERENCES "CommissionCalcSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionExplainLine_so_tien_chk') THEN
    ALTER TABLE "CommissionExplainLine" ADD CONSTRAINT "CommissionExplainLine_so_tien_chk" CHECK ("wouldBeAmount" >= 0);
  END IF;
  -- Cùng khuôn `CommissionTransaction_nguoi_huong_chk`, thêm nhánh «chưa biết người» (kind NULL ⇒ cả hai id NULL).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionExplainLine_nguoi_huong_chk') THEN
    ALTER TABLE "CommissionExplainLine" ADD CONSTRAINT "CommissionExplainLine_nguoi_huong_chk" CHECK (
      CASE "beneficiaryKind"
        WHEN 'USER' THEN "beneficiaryUserId" IS NOT NULL AND "beneficiaryAffiliateId" IS NULL
        WHEN 'AFFILIATE' THEN "beneficiaryAffiliateId" IS NOT NULL AND "beneficiaryUserId" IS NULL
        ELSE "beneficiaryUserId" IS NULL AND "beneficiaryAffiliateId" IS NULL
      END
    );
  END IF;
END $$;

-- ─── CHỈ-THÊM: UPDATE/DELETE ⇒ ném. Không dùng `hoa_hong_so_bat_bien` (hàm đó đặc thù cho sổ: cho đổi 3 cột chi trả). ───
CREATE OR REPLACE FUNCTION hoa_hong_bang_chi_them() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% là bảng chỉ-thêm — % bị chặn (id=%)', TG_TABLE_NAME, TG_OP, OLD."id";
END $$;
DROP TRIGGER IF EXISTS "CommissionExplainLine_chi_them_bud" ON "CommissionExplainLine";
CREATE TRIGGER "CommissionExplainLine_chi_them_bud" BEFORE UPDATE OR DELETE ON "CommissionExplainLine"
  FOR EACH ROW EXECUTE FUNCTION hoa_hong_bang_chi_them();

-- Bảng MỚI tự bật RLS (khuôn 20260825120000_lead_status_history). Chỉ ENABLE, không FORCE, không policy.
ALTER TABLE "CommissionExplainLine" ENABLE ROW LEVEL SECURITY;
