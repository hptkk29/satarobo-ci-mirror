-- Quản trị tối cao TỰ DUYỆT đề xuất điều chỉnh hoa hồng do chính mình lập (chủ dự án chốt 21/11/2026, trong chat):
-- «tôi có full quyền, đừng bắt tôi đổi rồi người khác duyệt làm gì cho mệt».
--
-- Trước đó CHECK `CommissionAdjustmentRequest_khac_nguoi_chk` (migration 20261016100000) cấm MỌI người: cấp 1 = người đề xuất, cấp 2 = người đề xuất
-- hoặc = cấp 1, người từ chối = người đề xuất. CHECK không tra được vai của người dùng nên thay bằng TRIGGER cùng tên lỗi: trùng người CHỈ được qua khi
-- người duyệt/từ chối đang giữ vai SUPER_ADMIN còn hiệu lực tại đơn vị HO/ROOT — đúng định nghĩa `Actor.isSuperAdmin` (lib/auth/actor.ts). Mọi vai khác
-- vẫn bị chặn ở tầng DB như cũ. Luật ở tầng ứng dụng: `lyDoKhongDuocDuyet` (`nguoiDuyetLaQuanTriToiCao`); vế «người hưởng không tự duyệt» KHÔNG đổi.
-- Cộng thêm, không đổi cột, không đụng dữ liệu. Lùi: tạo lại CHECK cũ (khối cuối tệp này) rồi DROP trigger + hai hàm.

CREATE OR REPLACE FUNCTION commission_adjustment_request_la_qttc(uid text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "UserOrgRole" uor
    JOIN "RoleDef" r ON r."id" = uor."roleId"
    JOIN "OrgUnit" ou ON ou."id" = uor."orgUnitId"
    WHERE uor."userId" = uid
      AND uor."status" = 'ACTIVE'
      AND r."code" = 'SUPER_ADMIN'
      AND r."isActive"
      AND uor."effectiveFrom" <= now()
      AND (uor."effectiveTo" IS NULL OR uor."effectiveTo" >= now())
      AND ou."type" IN ('HO', 'ROOT')
      AND ou."deletedAt" IS NULL
      AND ou."isActive"
  )
$$;

CREATE OR REPLACE FUNCTION commission_adjustment_request_khac_nguoi() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."approver1Id" IS NOT NULL AND NEW."approver1Id" = NEW."requestedById" AND NOT commission_adjustment_request_la_qttc(NEW."approver1Id"))
     OR (NEW."approver2Id" IS NOT NULL AND (NEW."approver2Id" = NEW."requestedById" OR NEW."approver2Id" = NEW."approver1Id")
         AND NOT commission_adjustment_request_la_qttc(NEW."approver2Id"))
     OR (NEW."rejectedById" IS NOT NULL AND NEW."rejectedById" = NEW."requestedById" AND NOT commission_adjustment_request_la_qttc(NEW."rejectedById")) THEN
    RAISE EXCEPTION 'new row for relation "CommissionAdjustmentRequest" violates check constraint "CommissionAdjustmentRequest_khac_nguoi_chk" (tách nhiệm: chỉ Quản trị tối cao được tự duyệt)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "CommissionAdjustmentRequest_khac_nguoi_trg" ON "CommissionAdjustmentRequest";
CREATE TRIGGER "CommissionAdjustmentRequest_khac_nguoi_trg"
  BEFORE INSERT OR UPDATE OF "requestedById", "approver1Id", "approver2Id", "rejectedById" ON "CommissionAdjustmentRequest"
  FOR EACH ROW EXECUTE FUNCTION commission_adjustment_request_khac_nguoi();

ALTER TABLE "CommissionAdjustmentRequest" DROP CONSTRAINT IF EXISTS "CommissionAdjustmentRequest_khac_nguoi_chk";

-- Lùi (chạy tay nếu cần):
--   DROP TRIGGER "CommissionAdjustmentRequest_khac_nguoi_trg" ON "CommissionAdjustmentRequest";
--   DROP FUNCTION commission_adjustment_request_khac_nguoi(); DROP FUNCTION commission_adjustment_request_la_qttc(text);
--   ALTER TABLE "CommissionAdjustmentRequest" ADD CONSTRAINT "CommissionAdjustmentRequest_khac_nguoi_chk" CHECK (
--     ("approver1Id" IS NULL OR "approver1Id" <> "requestedById")
--     AND ("approver2Id" IS NULL OR ("approver2Id" <> "requestedById" AND "approver2Id" IS DISTINCT FROM "approver1Id"))
--     AND ("rejectedById" IS NULL OR "rejectedById" <> "requestedById"));
