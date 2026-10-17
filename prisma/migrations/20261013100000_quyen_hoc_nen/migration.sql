-- Quyền học theo phạm vi — NỀN DỮ LIỆU ("thu học phí theo phạm vi học", BA Phần 4(a) §2). CHỈ THÊM, chạy lại được.
--
-- Hai bảng MỚI (`StudyEntitlement`, `StudyEntitlementUsage`) + năm enum MỚI. KHÔNG đụng bảng nào đang có,
-- KHÔNG ADD VALUE vào enum có sẵn, KHÔNG backfill, KHÔNG UPDATE/DELETE dòng nào. Bảng sinh ra RỖNG và
-- nằm im: chưa có code nào ghi vào (cờ `billing.scopePurchaseEnabled` mặc định TẮT).
--
-- Con trỏ sang Student/Course/Order/OrderItem/Enrollment là CON TRỎ MỀM (không FK) — xem khối chú thích
-- ở đầu mô hình trong `schema.prisma`. FK nối sau, ở đợt nối vào luồng thật.
--
-- Chỉ mục duy nhất từng phần + CHECK Prisma KHÔNG model: `prisma migrate diff --from-url` sẽ báo chúng
-- là drift (đúng như `Enrollment_studentId_classId_active_key`) — giữ lại có chủ đích.

-- ── Enum ────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PurchaseKind') THEN
    CREATE TYPE "PurchaseKind" AS ENUM ('FULL','MILESTONE','CUSTOM');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomerKind') THEN
    CREATE TYPE "CustomerKind" AS ENUM ('NEW','RENEWAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StudyEntitlementStatus') THEN
    CREATE TYPE "StudyEntitlementStatus" AS ENUM ('AWAITING_PLACEMENT','ACTIVE','FROZEN','EXHAUSTED','SEAT_HOLD','COMPLETED','EXPIRED','STOPPED','VOIDED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntitlementOrigin') THEN
    CREATE TYPE "EntitlementOrigin" AS ENUM ('PAYMENT','LEGACY_BACKFILL','MANUAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UsageSource') THEN
    CREATE TYPE "UsageSource" AS ENUM ('CLASS','MAKEUP','CATCH_UP','GRACE','MANUAL');
  END IF;
END $$;

-- ── StudyEntitlement ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StudyEntitlement" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "enrollmentId" TEXT,
    "classId" TEXT,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "purchaseKind" "PurchaseKind" NOT NULL,
    "purchaseSessions" INTEGER NOT NULL,
    "curriculumId" TEXT,
    "curriculumVersion" INTEGER,
    "startLessonOrder" INTEGER,
    "endLessonOrder" INTEGER,
    "scopeLockedAt" TIMESTAMPTZ(6),
    "skippedSessions" INTEGER NOT NULL DEFAULT 0,
    "consumedSessions" INTEGER NOT NULL DEFAULT 0,
    "status" "StudyEntitlementStatus" NOT NULL DEFAULT 'AWAITING_PLACEMENT',
    "statusBeforeFreeze" "StudyEntitlementStatus",
    "paidAt" TIMESTAMPTZ(6),
    "confirmedAt" TIMESTAMPTZ(6),
    "effectiveFrom" TIMESTAMPTZ(6),
    "effectiveTo" TIMESTAMPTZ(6),
    "frozenAt" TIMESTAMPTZ(6),
    "frozenUntil" TIMESTAMPTZ(6),
    "frozenReserveId" TEXT,
    "graceSessionsGranted" INTEGER NOT NULL DEFAULT 0,
    "graceSessionsUsed" INTEGER NOT NULL DEFAULT 0,
    "graceStartedAt" TIMESTAMPTZ(6),
    "seatHoldUntil" TIMESTAMPTZ(6),
    "prevEntitlementId" TEXT,
    "purchaseOrdinal" INTEGER NOT NULL DEFAULT 1,
    "courseOrdinal" INTEGER NOT NULL DEFAULT 1,
    "customerKind" "CustomerKind" NOT NULL DEFAULT 'NEW',
    "closedBySaleId" TEXT,
    "firstPurchaseSaleId" TEXT,
    "listAmount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "netAmount" INTEGER NOT NULL,
    "priceIncludesVat" BOOLEAN NOT NULL DEFAULT true,
    "pricingSnapshot" JSONB NOT NULL,
    "discountSnapshot" JSONB,
    "commissionSnapshot" JSONB,
    "configSnapshot" JSONB,
    "approvalSnapshot" JSONB,
    "policyVersionId" TEXT,
    "exceptionId" TEXT,
    "invoiceLabel" TEXT,
    "origin" "EntitlementOrigin" NOT NULL DEFAULT 'PAYMENT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "StudyEntitlement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StudyEntitlement_studentId_courseId_status_idx" ON "StudyEntitlement"("studentId", "courseId", "status");
CREATE INDEX IF NOT EXISTS "StudyEntitlement_enrollmentId_idx" ON "StudyEntitlement"("enrollmentId");
CREATE INDEX IF NOT EXISTS "StudyEntitlement_centerId_status_idx" ON "StudyEntitlement"("centerId", "status");
CREATE INDEX IF NOT EXISTS "StudyEntitlement_status_seatHoldUntil_idx" ON "StudyEntitlement"("status", "seatHoldUntil");
CREATE INDEX IF NOT EXISTS "StudyEntitlement_status_graceStartedAt_idx" ON "StudyEntitlement"("status", "graceStartedAt");
CREATE INDEX IF NOT EXISTS "StudyEntitlement_orgUnitId_idx" ON "StudyEntitlement"("orgUnitId");
CREATE INDEX IF NOT EXISTS "StudyEntitlement_prevEntitlementId_idx" ON "StudyEntitlement"("prevEntitlementId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudyEntitlement_prevEntitlementId_fkey') THEN
    ALTER TABLE "StudyEntitlement" ADD CONSTRAINT "StudyEntitlement_prevEntitlementId_fkey"
      FOREIGN KEY ("prevEntitlementId") REFERENCES "StudyEntitlement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Ràng buộc Prisma không model — giữ lại. Mỗi CHECK dưới đây là một bất biến của BA (§2.2, §2.5).
-- Một lần mua = một quyền học: chỉ mục duy nhất TỪNG PHẦN, dòng VOIDED không chặn cấp lại.
CREATE UNIQUE INDEX IF NOT EXISTS "StudyEntitlement_orderItemId_active_key" ON "StudyEntitlement"("orderItemId") WHERE "orderItemId" IS NOT NULL AND "status" <> 'VOIDED';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudyEntitlement_purchase_chk') THEN
    ALTER TABLE "StudyEntitlement" ADD CONSTRAINT "StudyEntitlement_purchase_chk" CHECK ("purchaseSessions" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudyEntitlement_consumed_chk') THEN
    ALTER TABLE "StudyEntitlement" ADD CONSTRAINT "StudyEntitlement_consumed_chk" CHECK ("consumedSessions" >= 0 AND "skippedSessions" >= 0 AND "consumedSessions" + "skippedSessions" <= "purchaseSessions");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudyEntitlement_scope_chk') THEN
    ALTER TABLE "StudyEntitlement" ADD CONSTRAINT "StudyEntitlement_scope_chk" CHECK (("startLessonOrder" IS NULL) = ("endLessonOrder" IS NULL) AND ("startLessonOrder" IS NULL OR "endLessonOrder" - "startLessonOrder" + 1 = "purchaseSessions"));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudyEntitlement_amount_chk') THEN
    ALTER TABLE "StudyEntitlement" ADD CONSTRAINT "StudyEntitlement_amount_chk" CHECK ("listAmount" >= 0 AND "discountAmount" >= 0 AND "netAmount" >= 0 AND "listAmount" - "discountAmount" = "netAmount");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudyEntitlement_origin_chk') THEN
    ALTER TABLE "StudyEntitlement" ADD CONSTRAINT "StudyEntitlement_origin_chk" CHECK ("origin" <> 'PAYMENT' OR ("orderId" IS NOT NULL AND "orderItemId" IS NOT NULL));
  END IF;
END $$;

-- ── StudyEntitlementUsage ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "StudyEntitlementUsage" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonOrder" INTEGER NOT NULL,
    "source" "UsageSource" NOT NULL,
    "sessionId" TEXT,
    "makeupCaseStudentId" TEXT,
    "attendanceId" TEXT,
    "movedFromEntitlementId" TEXT,
    "usedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(6),
    "voidReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudyEntitlementUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StudyEntitlementUsage_entitlementId_lessonOrder_key" ON "StudyEntitlementUsage"("entitlementId", "lessonOrder");
CREATE INDEX IF NOT EXISTS "StudyEntitlementUsage_studentId_lessonOrder_idx" ON "StudyEntitlementUsage"("studentId", "lessonOrder");
CREATE INDEX IF NOT EXISTS "StudyEntitlementUsage_sessionId_idx" ON "StudyEntitlementUsage"("sessionId");
CREATE INDEX IF NOT EXISTS "StudyEntitlementUsage_movedFromEntitlementId_idx" ON "StudyEntitlementUsage"("movedFromEntitlementId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudyEntitlementUsage_entitlementId_fkey') THEN
    ALTER TABLE "StudyEntitlementUsage" ADD CONSTRAINT "StudyEntitlementUsage_entitlementId_fkey"
      FOREIGN KEY ("entitlementId") REFERENCES "StudyEntitlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudyEntitlementUsage_lesson_chk') THEN
    ALTER TABLE "StudyEntitlementUsage" ADD CONSTRAINT "StudyEntitlementUsage_lesson_chk" CHECK ("lessonOrder" >= 1);
  END IF;
END $$;

-- ── RLS: bảng mới phải tự bật (chỉ ENABLE, không FORCE, không policy) ───────────────
ALTER TABLE "StudyEntitlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudyEntitlementUsage" ENABLE ROW LEVEL SECURITY;
