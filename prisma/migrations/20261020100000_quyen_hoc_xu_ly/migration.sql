-- Hàng đợi xử lý của quyền học — "thu học phí theo phạm vi học", PR nối đường tiền + trạng thái CHỜ CHUYỂN ĐỔI. CHỈ THÊM.
--
-- Một bảng MỚI (`StudyEntitlementXuLy`) + hai enum MỚI. KHÔNG đụng bảng nào đang có, KHÔNG ADD VALUE vào enum có sẵn,
-- KHÔNG backfill, KHÔNG UPDATE/DELETE dòng nào. Bảng sinh ra RỖNG và nằm im: chỉ `lib/entitlements/cap-tu-don.ts` ghi vào
-- nó, mà hàm đó dừng trước mọi phép ghi khi cờ `billing.scopePurchaseEnabled` TẮT (mặc định) hoặc đơn không có dấu SCOPE.
--
-- Vì sao một bảng riêng: chủ dự án chốt (11/10/2026) "tiền đã xác nhận nhưng chưa có Student ⇒ KHÔNG cấp quyền active,
-- GHI TRẠNG THÁI CHỜ". Ops cần thấy danh sách đó, và hook sau Chuyển đổi cần biết dòng nào đang chờ. Hai loại còn lại
-- (CAN_THU_HOI, TREO_DUYET_TAY) dành cho chiều ngược ở PR sau — chừa sẵn trong enum để KHÔNG phải migration lần hai.
--
-- Con trỏ sang Order/OrderItem/Student/Course/LeadChild/StudyEntitlement là CON TRỎ MỀM (không FK), như `StudyEntitlement`.
-- Duy nhất (orderItemId, loai) là chỉ mục ĐẦY ĐỦ (không từng phần): mở lại một dòng đã đóng thì lật trạng thái, không
-- chèn dòng mới — nên `prisma migrate diff --from-url` không báo drift cho bảng này.

-- ── Enum ────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntitlementXuLyLoai') THEN
    CREATE TYPE "EntitlementXuLyLoai" AS ENUM ('CHO_CHUYEN_DOI','CAN_THU_HOI','TREO_DUYET_TAY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntitlementXuLyTrangThai') THEN
    CREATE TYPE "EntitlementXuLyTrangThai" AS ENUM ('OPEN','DA_XU_LY','HUY');
  END IF;
END $$;

-- ── StudyEntitlementXuLy ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StudyEntitlementXuLy" (
    "id" TEXT NOT NULL,
    "loai" "EntitlementXuLyLoai" NOT NULL,
    "trangThai" "EntitlementXuLyTrangThai" NOT NULL DEFAULT 'OPEN',
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "courseId" TEXT,
    "leadChildId" TEXT,
    "studentId" TEXT,
    "entitlementId" TEXT,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "lyDo" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6),
    "resolvedNote" TEXT,
    CONSTRAINT "StudyEntitlementXuLy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StudyEntitlementXuLy_orderItemId_loai_key" ON "StudyEntitlementXuLy"("orderItemId", "loai");
CREATE INDEX IF NOT EXISTS "StudyEntitlementXuLy_centerId_loai_trangThai_idx" ON "StudyEntitlementXuLy"("centerId", "loai", "trangThai");
CREATE INDEX IF NOT EXISTS "StudyEntitlementXuLy_orderId_idx" ON "StudyEntitlementXuLy"("orderId");
CREATE INDEX IF NOT EXISTS "StudyEntitlementXuLy_orgUnitId_idx" ON "StudyEntitlementXuLy"("orgUnitId");

-- ── RLS: bảng mới phải tự bật (chỉ ENABLE, không FORCE, không policy) ───────────────
ALTER TABLE "StudyEntitlementXuLy" ENABLE ROW LEVEL SECURITY;
