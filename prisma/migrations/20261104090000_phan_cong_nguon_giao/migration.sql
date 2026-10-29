-- Phân công gộp GĐ2 (docs/phan-cong-gop/KHAO-SAT.md · CHỐT GĐ0 số 1, 6). ADDITIVE + đổi giá trị có chụp trước/sau trong PR.
--
-- 1. `nguonGiao` — NGUỒN QUYẾT ĐỊNH CUỐI của dòng phân công / dòng trực. Đồng bộ một chiều từ buổi gốc chỉ được đụng dòng
--    `DONG_BO` (`danXuatDuoc`, lib/parttime/phan-cong.ts). Cột NOT NULL, KHÔNG mặc định (luật 7: mọi đường ghi phải khai — `tsc`
--    liệt kê chỗ gọi). Backfill: phân công MANUAL ⇒ TAY, còn lại ⇒ DONG_BO; dòng trực luôn do QLCS giao ⇒ TAY.
-- 2. Bỏ bước nhận / từ chối (chốt 1): dòng còn chờ (`PROPOSED` / `WAITING_ACCEPTANCE`) ⇒ `ACCEPTED`; mặc định cột ⇒ `ACCEPTED`.
--    KHÔNG gỡ giá trị enum — bảng xác nhận BẤT BIẾN (trigger) còn tham chiếu `DECLINED`. Dòng DECLINED giữ nguyên (lịch sử).
--    Prod đo 26/10/2026 (lượt 40218685888): SSA 0 dòng chờ, trực 0 dòng ⇒ bước 2 không đổi dòng nào trên prod.

-- Chạy lại được ([MIG-01]): mọi câu tự kiểm tồn tại / chỉ đổi giá trị đã định.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NguonGiao') THEN
    CREATE TYPE "NguonGiao" AS ENUM ('DONG_BO', 'TAY', 'AP_KHUNG', 'TU_XEP_BU_TRIAL');
  END IF;
END $$;

ALTER TABLE "SessionStaffAssignment" ADD COLUMN IF NOT EXISTS "nguonGiao" "NguonGiao" NOT NULL DEFAULT 'DONG_BO';
UPDATE "SessionStaffAssignment" SET "nguonGiao" = 'TAY' WHERE "assignmentType" = 'MANUAL';
ALTER TABLE "SessionStaffAssignment" ALTER COLUMN "nguonGiao" DROP DEFAULT;

ALTER TABLE "OperationsDutyAssignment" ADD COLUMN IF NOT EXISTS "nguonGiao" "NguonGiao" NOT NULL DEFAULT 'TAY';
ALTER TABLE "OperationsDutyAssignment" ALTER COLUMN "nguonGiao" DROP DEFAULT;

UPDATE "SessionStaffAssignment" SET "status" = 'ACCEPTED' WHERE "status" IN ('PROPOSED', 'WAITING_ACCEPTANCE');
UPDATE "OperationsDutyAssignment" SET "status" = 'ACCEPTED' WHERE "status" IN ('PROPOSED', 'WAITING_ACCEPTANCE');
ALTER TABLE "SessionStaffAssignment" ALTER COLUMN "status" SET DEFAULT 'ACCEPTED';
ALTER TABLE "OperationsDutyAssignment" ALTER COLUMN "status" SET DEFAULT 'ACCEPTED';
