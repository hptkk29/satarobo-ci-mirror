-- AFF-L2 (13/10/2026) — ENGINE CLOSEOUT: người hưởng TỔ CHỨC · cửa sổ bảo vệ của campaign.
-- docs/source-commission/closeout/l2-engine.md.
--
-- ADDITIVE, KHÔNG BACKFILL, CHẠY LẠI ĐƯỢC ([MIG-01]). Chạy tay trên prod (luật Nền #4) — KHÔNG nằm trong task này.
--
--   1. enum `CommissionBeneficiaryType` (PERSON | ORGANIZATION) + cột `CommissionTransaction.beneficiaryType` (nullable).
--      Sổ BẤT BIẾN (trigger `hoa_hong_so_bat_bien`) nên cột phải được điền lúc INSERT; dòng cũ giữ NULL = "đời cũ, không đoán".
--      `beneficiaryAffiliateId` đã là id ĐỐI TÁC (Affiliate = AffiliateParty) và `beneficiaryName` đã là tên hiển thị — KHÔNG thêm cột trùng.
--   2. giá trị `ON_HOLD` cho `CommissionPayoutStatus` (đứng TRƯỚC `PENDING`): dòng của người hưởng tổ chức vào sổ ở trạng thái này cho tới khi đủ hồ sơ pháp lý / ngân hàng / thuế.
--   3. trigger `hoa_hong_so_bat_bien` viết lại ĐÚNG như bản gốc (20261014110000_hoa_hong_so_cai), chỉ thêm `ON_HOLD` vào đầu thứ tự "chỉ tiến" —
--      mở khoá ON_HOLD → PENDING là TIẾN, không bị chặn; PENDING → ON_HOLD (lùi) vẫn bị chặn.
--   4. `CommissionRule.dungCuaSoNguon` BOOLEAN NOT NULL DEFAULT false (hằng số ⇒ không ghi lại bảng): chính sách YÊU CẦU tường minh dùng cửa sổ ghi công của NGUỒN thay cho cửa sổ bảo vệ của campaign.
--
-- ⚠️ `ALTER TYPE … ADD VALUE` KHÔNG được dùng giá trị mới trong CÙNG transaction. File này chỉ nhắc `ON_HOLD` như CHUỖI trong thân hàm plpgsql (mảng text) — không DEFAULT, không CHECK,
--    không INSERT/UPDATE dùng nó. Nếu sau này cần CHECK/DEFAULT trỏ `ON_HOLD` thì phải ở migration SAU.

-- ─── 1 · Loại người hưởng ───────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionBeneficiaryType') THEN
    CREATE TYPE "CommissionBeneficiaryType" AS ENUM ('PERSON', 'ORGANIZATION');
  END IF;
END $$;

ALTER TABLE "CommissionTransaction" ADD COLUMN IF NOT EXISTS "beneficiaryType" "CommissionBeneficiaryType";

-- ─── 2 · ON_HOLD ────────────────────────────────────────────────────────────────────────────────────────────
ALTER TYPE "CommissionPayoutStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD' BEFORE 'PENDING';

-- ─── 3 · Trigger sổ bất biến: thêm ON_HOLD vào thứ tự "chỉ tiến" (thân còn lại GIỮ NGUYÊN bản 20261014110000) ─────
CREATE OR REPLACE FUNCTION hoa_hong_so_bat_bien() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cho_sua text[] := ARRAY['payoutStatus','payoutBatchId','payoutStatusAt'];
  thu_tu  text[] := ARRAY['ON_HOLD','PENDING','APPROVED','EXPORTED','PAID'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CommissionTransaction là sổ bất biến — xoá bị chặn (id=%)', OLD."id";
  END IF;
  IF (to_jsonb(NEW) - cho_sua) IS DISTINCT FROM (to_jsonb(OLD) - cho_sua) THEN
    RAISE EXCEPTION 'CommissionTransaction là sổ bất biến — chỉ được đổi cột chi trả (id=%)', OLD."id";
  END IF;
  IF array_position(thu_tu, NEW."payoutStatus"::text) < array_position(thu_tu, OLD."payoutStatus"::text) THEN
    RAISE EXCEPTION 'payoutStatus chỉ tiến (% → % bị chặn, id=%)', OLD."payoutStatus", NEW."payoutStatus", OLD."id";
  END IF;
  IF OLD."payoutBatchId" IS NOT NULL AND NEW."payoutBatchId" IS DISTINCT FROM OLD."payoutBatchId" THEN
    RAISE EXCEPTION 'payoutBatchId chỉ ghi một lần (id=%)', OLD."id";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "CommissionTransaction_bat_bien_bud" ON "CommissionTransaction";
CREATE TRIGGER "CommissionTransaction_bat_bien_bud" BEFORE UPDATE OR DELETE ON "CommissionTransaction"
  FOR EACH ROW EXECUTE FUNCTION hoa_hong_so_bat_bien();

-- ─── 4 · Cửa sổ nguồn do chính sách yêu cầu ─────────────────────────────────────────────────────────────────
ALTER TABLE "CommissionRule" ADD COLUMN IF NOT EXISTS "dungCuaSoNguon" BOOLEAN NOT NULL DEFAULT false;
