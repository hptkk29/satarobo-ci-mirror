-- 18/10/2026 — ĐỀ XUẤT THÊM / BỎ CHƯƠNG TRÌNH GIẢM SO VỚI GỢI Ý CỦA HỆ THỐNG, CHỜ QUẢN LÝ CƠ SỞ DUYỆT (D5). CHỈ THÊM.
-- Thiết kế: docs/thu-hoc-phi-pham-vi/CHON-CHUONG-TRINH-GIAM.md §12.
--
-- Chủ dự án chốt D5 ngày 18/10/2026 (bằng lời): Sale được ĐỀ XUẤT thêm hoặc bỏ ưu đãi do hệ thống gợi ý; bắt buộc có lý do; CHỜ QLCS duyệt
-- TRƯỚC khi áp dụng; ghi nhật ký người đề xuất, người duyệt, lý do, kết quả.
--
-- ── ĐÂY LÀ CÁI GÌ, VÀ KHÔNG PHẢI CÁI GÌ ─────────────────────────────────────────────────────────────
-- MỘT bảng MỚI ("DiscountProgramChangeRequest") + MỘT enum MỚI. KHÔNG đụng bảng nào đang có, KHÔNG ADD VALUE vào enum có sẵn, KHÔNG backfill,
-- KHÔNG UPDATE/DELETE dòng nào. Bảng sinh ra RỖNG và nằm im: chỉ `lib/pricing/de-xuat-doi-chuong-trinh-db.ts` ghi vào nó, và hàm đó chưa
-- được nối vào form / máy chủ tạo đơn (lưới `[DXC-PIN]`).
--
-- Con trỏ sang Order/OrderItem là CON TRỎ MỀM (không FK), như "StudyEntitlementXuLy": xoá đơn nháp không được bị chặn bởi một đề xuất, và
-- đề xuất là bản ghi ĐỐI SOÁT — phải sống lâu hơn dòng đơn mà nó nói tới.
--
-- Chỉ mục duy nhất TỪNG PHẦN "…_orderItemId_pending_key" (mỗi dòng đơn tối đa MỘT đề xuất đang chờ) không biểu diễn được trong schema.prisma.
-- ĐO 18/10/2026 trên DB tạm sau `migrate deploy` toàn bộ: `prisma migrate diff --from-url` ra 0 dòng nhắc bảng này (Prisma 5 bỏ qua chỉ mục
-- từng phần) — nhưng đừng coi đó là bằng chứng nó "khớp schema": nó chỉ có trong SQL, nên dựng lại DB từ schema (db push) sẽ KHÔNG có nó.
--
-- Ràng buộc CHECK cũng không có trong schema.prisma (Prisma không đọc CHECK nên không báo drift): chặn ngay ở DB để đường ghi thô cũng không
-- lọt dòng "đề xuất không lý do", "đề xuất rỗng" hay "đã duyệt mà không biết ai duyệt".
--
-- ⚠️ IDEMPOTENT (`[MIG-01]`): chạy tay trên prod, có thể bấm lại.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DiscountProgramChangeStatus') THEN
    CREATE TYPE "DiscountProgramChangeStatus" AS ENUM ('PENDING','APPROVED','REJECTED','CANCELLED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "DiscountProgramChangeRequest" (
    "id" TEXT NOT NULL,
    "status" "DiscountProgramChangeStatus" NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "addVoucherIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "removeVoucherIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "reason" TEXT NOT NULL,
    "suggestionFingerprint" TEXT NOT NULL,
    "suggestionSnapshot" JSONB NOT NULL,
    "familyBasis" JSONB,
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMPTZ(6) NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "DiscountProgramChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DiscountProgramChangeRequest_centerId_status_idx" ON "DiscountProgramChangeRequest"("centerId", "status");
CREATE INDEX IF NOT EXISTS "DiscountProgramChangeRequest_orderId_idx" ON "DiscountProgramChangeRequest"("orderId");
CREATE INDEX IF NOT EXISTS "DiscountProgramChangeRequest_orderItemId_idx" ON "DiscountProgramChangeRequest"("orderItemId");
CREATE INDEX IF NOT EXISTS "DiscountProgramChangeRequest_orgUnitId_idx" ON "DiscountProgramChangeRequest"("orgUnitId");

-- Mỗi dòng đơn tối đa MỘT đề xuất đang chờ: hai Sale bấm cùng lúc không đẻ hai đề xuất chờ, và người duyệt không phải chọn bản nào.
CREATE UNIQUE INDEX IF NOT EXISTS "DiscountProgramChangeRequest_orderItemId_pending_key"
  ON "DiscountProgramChangeRequest"("orderItemId") WHERE "status" = 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscountProgramChangeRequest_reason_chk') THEN
    ALTER TABLE "DiscountProgramChangeRequest" ADD CONSTRAINT "DiscountProgramChangeRequest_reason_chk"
      CHECK (char_length(btrim("reason")) >= 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscountProgramChangeRequest_nonempty_chk') THEN
    ALTER TABLE "DiscountProgramChangeRequest" ADD CONSTRAINT "DiscountProgramChangeRequest_nonempty_chk"
      CHECK (cardinality("addVoucherIds") + cardinality("removeVoucherIds") > 0);
  END IF;
  -- Một mã không thể vừa THÊM vừa BỎ trong cùng một đề xuất.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscountProgramChangeRequest_disjoint_chk') THEN
    ALTER TABLE "DiscountProgramChangeRequest" ADD CONSTRAINT "DiscountProgramChangeRequest_disjoint_chk"
      CHECK (NOT ("addVoucherIds" && "removeVoucherIds"));
  END IF;
  -- Đang chờ ⇔ chưa có người quyết; đã quyết ⇒ biết ai và lúc nào. Từ chối bắt buộc có lý do.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscountProgramChangeRequest_decision_chk') THEN
    ALTER TABLE "DiscountProgramChangeRequest" ADD CONSTRAINT "DiscountProgramChangeRequest_decision_chk"
      CHECK (
        ("status" = 'PENDING' AND "decidedById" IS NULL AND "decidedAt" IS NULL)
        OR ("status" <> 'PENDING' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscountProgramChangeRequest_reject_reason_chk') THEN
    ALTER TABLE "DiscountProgramChangeRequest" ADD CONSTRAINT "DiscountProgramChangeRequest_reject_reason_chk"
      CHECK ("status" <> 'REJECTED' OR char_length(btrim(COALESCE("decisionReason", ''))) >= 10);
  END IF;
END
$$;

-- RLS: bảng mới phải tự bật (chỉ ENABLE, không FORCE, không policy).
ALTER TABLE "DiscountProgramChangeRequest" ENABLE ROW LEVEL SECURITY;
