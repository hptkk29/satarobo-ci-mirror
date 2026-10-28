-- 16/10/2026 — NGUỒN · LỊCH SỬ CHỦ NGUỒN (hướng B+C): bảng `LeadSourceOwnerPeriod` + 1 enum.
-- Đặc tả: docs/source-commission/08 §16.3 (chủ nguồn theo LỊCH SỬ, không hồi tố).
--
-- ADDITIVE (luật cứng #4): 1 enum + 1 bảng MỚI + SEED một dòng khởi tạo cho mỗi nguồn ĐANG có chủ. Không cột nào trên bảng có sẵn bị đổi,
-- `LeadSourceGroup.ownerEmployeeId` GIỮ NGUYÊN làm "chủ hiện tại / ý định mới nhất" của biểu mẫu.
--
-- Vì sao cần: chủ nguồn từng chỉ nằm ở `LeadAttribution.signals.nguon.chuNhanVienId` (ảnh chụp lúc ghi nhận) và ở dòng nguồn SỐNG. Đổi chủ A → B
-- không có MỐC NGÀY, nên không nói được "giao dịch này thuộc chủ nào". Bảng này ghi: từ ngày nào ai là chủ. Engine tra theo NGÀY SỰ KIỆN của giao dịch
-- (ngày thu đầu của lần mua), nên đổi chủ KHÔNG viết lại lịch sử tiền.
--
-- SEED KHÔNG HỒI TỐ: dòng khởi tạo có `effectiveFrom = now()` của lúc chạy migration, KHÔNG phải `createdAt` của nguồn. Sự kiện trước mốc đó
-- (và ghi nhận trước đó) vẫn đi đường cũ có kiểm soát: bản chụp `signals.nguon`, hoặc dòng nguồn sống đóng băng ở chủ khởi tạo.
--
-- XOÁ NGUỒN ⇒ lịch sử của nó đi theo (FK `ON DELETE CASCADE`): lịch sử chủ của một nguồn không còn nghĩa khi nguồn đã không còn, và RESTRICT làm MỌI chỗ dựng nguồn có chủ rồi
-- dọn bằng `leadSourceGroup.deleteMany` (20 tệp / 60 ca của bộ DB, đo 16/10/2026) đỏ. Trigger bất biến vẫn chặn xoá THẲNG một khoảng của nguồn CÒN SỐNG: chỉ cho xoá khi nguồn cha
-- đã biến mất (lúc cascade chạy, dòng cha đã bị xoá trong cùng lệnh nên truy vấn trong trigger không còn thấy nó).
--
-- Chạy lại được ([MIG-01]): enum kiểm pg_type, bảng/chỉ mục IF NOT EXISTS, FK/CHECK kiểm pg_constraint (FK nhóm bị tạo lại nếu đang là RESTRICT), hàm CREATE OR REPLACE,
-- trigger DROP IF EXISTS rồi CREATE, seed `WHERE NOT EXISTS`.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadSourceOwnerPeriodKind') THEN
    CREATE TYPE "LeadSourceOwnerPeriodKind" AS ENUM ('KHOI_TAO', 'DOI_CHU');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "LeadSourceOwnerPeriod" (
  "id"              TEXT NOT NULL,
  "groupId"         TEXT NOT NULL,
  -- NULL = từ mốc này nguồn KHÔNG có chủ (gỡ chủ, hoặc chủ nghỉ mà chưa thay).
  "ownerEmployeeId" TEXT,
  "kind"            "LeadSourceOwnerPeriodKind" NOT NULL,
  "effectiveFrom"   TIMESTAMPTZ(6) NOT NULL,
  "effectiveTo"     TIMESTAMPTZ(6),
  "setById"         TEXT,
  "reason"          TEXT NOT NULL,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadSourceOwnerPeriod_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LeadSourceOwnerPeriod_groupId_effectiveFrom_idx" ON "LeadSourceOwnerPeriod"("groupId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "LeadSourceOwnerPeriod_ownerEmployeeId_idx" ON "LeadSourceOwnerPeriod"("ownerEmployeeId");
-- Mỗi nguồn tối đa MỘT khoảng đang mở (chỉ mục TỪNG PHẦN — Prisma không biểu diễn được, GIỮ trong SQL).
CREATE UNIQUE INDEX IF NOT EXISTS "LeadSourceOwnerPeriod_mo_key" ON "LeadSourceOwnerPeriod"("groupId") WHERE "effectiveTo" IS NULL;

DO $$ BEGIN
  -- Bản đầu của tệp này (chưa lên môi trường nào ngoài máy dev) tạo khoá ngoại RESTRICT: tạo lại thành CASCADE.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceOwnerPeriod_groupId_fkey' AND confdeltype <> 'c') THEN
    ALTER TABLE "LeadSourceOwnerPeriod" DROP CONSTRAINT "LeadSourceOwnerPeriod_groupId_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceOwnerPeriod_groupId_fkey') THEN
    ALTER TABLE "LeadSourceOwnerPeriod" ADD CONSTRAINT "LeadSourceOwnerPeriod_groupId_fkey"
      FOREIGN KEY ("groupId") REFERENCES "LeadSourceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceOwnerPeriod_ownerEmployeeId_fkey') THEN
    ALTER TABLE "LeadSourceOwnerPeriod" ADD CONSTRAINT "LeadSourceOwnerPeriod_ownerEmployeeId_fkey"
      FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceOwnerPeriod_setById_fkey') THEN
    ALTER TABLE "LeadSourceOwnerPeriod" ADD CONSTRAINT "LeadSourceOwnerPeriod_setById_fkey"
      FOREIGN KEY ("setById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── CHECK ─────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceOwnerPeriod_khoang_chk') THEN
    ALTER TABLE "LeadSourceOwnerPeriod" ADD CONSTRAINT "LeadSourceOwnerPeriod_khoang_chk"
      CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
  END IF;
  -- KHÔNG LÙI NGÀY: hiệu lực không sớm hơn lúc ghi (createdAt) — đổi chủ hôm nay không viết lại được ngày hôm qua.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceOwnerPeriod_khong_lui_chk') THEN
    ALTER TABLE "LeadSourceOwnerPeriod" ADD CONSTRAINT "LeadSourceOwnerPeriod_khong_lui_chk"
      CHECK ("effectiveFrom" >= "createdAt");
  END IF;
  -- Đổi chủ bởi người (có tên) + lý do ≥ 10 ký tự; dòng khởi tạo của migration không có người.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceOwnerPeriod_nguoi_dat_chk') THEN
    ALTER TABLE "LeadSourceOwnerPeriod" ADD CONSTRAINT "LeadSourceOwnerPeriod_nguoi_dat_chk"
      CHECK (("kind" = 'DOI_CHU' AND "setById" IS NOT NULL) OR "kind" = 'KHOI_TAO');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadSourceOwnerPeriod_ly_do_chk') THEN
    ALTER TABLE "LeadSourceOwnerPeriod" ADD CONSTRAINT "LeadSourceOwnerPeriod_ly_do_chk"
      CHECK (char_length(btrim("reason")) >= 10);
  END IF;
END $$;

-- ─── TRIGGER: bất biến + không chồng khoảng ──────────────────────────────────────────────────
-- Chỉ MỘT thay đổi được phép: đóng khoảng đang mở (`effectiveTo` NULL → có giá trị). Mọi cột khác bất biến; xoá chỉ khi nguồn cha đã bị xoá (cascade).
-- INSERT: khoảng mới không được chồng khoảng nào của cùng nguồn (không dùng EXCLUDE/btree_gist để khỏi cần quyền tạo extension).
CREATE OR REPLACE FUNCTION lead_source_owner_period_bat_bien() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Cascade từ xoá nguồn: lúc này dòng cha đã biến mất. Xoá THẲNG một khoảng của nguồn còn sống thì vẫn chặn.
    IF EXISTS (SELECT 1 FROM "LeadSourceGroup" g WHERE g."id" = OLD."groupId") THEN
      RAISE EXCEPTION 'LeadSourceOwnerPeriod không bao giờ bị xoá khi nguồn còn tồn tại (id=%)', OLD."id";
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM "LeadSourceOwnerPeriod" p
      WHERE p."groupId" = NEW."groupId" AND p."id" <> NEW."id"
        AND p."effectiveFrom" < COALESCE(NEW."effectiveTo", 'infinity'::timestamptz)
        AND NEW."effectiveFrom" < COALESCE(p."effectiveTo", 'infinity'::timestamptz)
    ) THEN
      RAISE EXCEPTION 'Khoảng chủ nguồn chồng khoảng đã có của cùng nguồn (groupId=%)', NEW."groupId";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."groupId" IS DISTINCT FROM OLD."groupId"
     OR NEW."ownerEmployeeId" IS DISTINCT FROM OLD."ownerEmployeeId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom"
     OR NEW."setById" IS DISTINCT FROM OLD."setById"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Lịch sử chủ nguồn bất biến — chỉ được đóng khoảng đang mở (id=%)', OLD."id";
  END IF;
  IF OLD."effectiveTo" IS NOT NULL AND NEW."effectiveTo" IS DISTINCT FROM OLD."effectiveTo" THEN
    RAISE EXCEPTION 'Khoảng chủ nguồn đã đóng, không sửa lại (id=%)', OLD."id";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS "LeadSourceOwnerPeriod_bat_bien_biud" ON "LeadSourceOwnerPeriod";
CREATE TRIGGER "LeadSourceOwnerPeriod_bat_bien_biud" BEFORE INSERT OR UPDATE OR DELETE ON "LeadSourceOwnerPeriod"
  FOR EACH ROW EXECUTE FUNCTION lead_source_owner_period_bat_bien();

-- ─── SEED: mỗi nguồn ĐANG có chủ nhận một khoảng KHỞI TẠO mở từ lúc chạy migration (không hồi tố) ──────────
INSERT INTO "LeadSourceOwnerPeriod" ("id", "groupId", "ownerEmployeeId", "kind", "effectiveFrom", "effectiveTo", "setById", "reason", "createdAt")
SELECT 'lsop_' || replace(gen_random_uuid()::text, '-', ''), g."id", g."ownerEmployeeId", 'KHOI_TAO', now(), NULL, NULL,
       'Khởi tạo lịch sử chủ nguồn từ cấu hình lúc triển khai — không hồi tố lịch sử tiền trước mốc này.', now()
FROM "LeadSourceGroup" g
WHERE g."ownerEmployeeId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "LeadSourceOwnerPeriod" p WHERE p."groupId" = g."id");

-- ─── RLS: bảng MỚI ra đời với RLS TẮT (sự cố 09/08). Chỉ ENABLE, không FORCE, không policy. ─────
ALTER TABLE "LeadSourceOwnerPeriod" ENABLE ROW LEVEL SECURITY;
