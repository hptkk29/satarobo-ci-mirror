-- 20/11/2026 — E-learning ONLINE thương mại, LÕI (ADR 0005): khoá · phiên bản · chương/bài · QUYỀN HỌC · sự kiện quyền · tiến độ bài.
-- CHỈ THÊM: enum + bảng mới (tiền tố `Onl`), không đụng bảng đang có, không backfill. Bảng mới đã bật RLS (chỉ ENABLE).
-- ⚠️ Cố ý KHÔNG có `centerId`/`orgUnitId`: danh mục khoá Online là dữ liệu cấp CÔNG TY (không theo cơ sở); quyền học gắn theo HỌC VIÊN, đọc đi qua phiên phụ huynh + kiểm sở hữu học viên.
-- ⚠️ `orderId`/`orderItemId` là cột trần (không FK) có chủ đích: đơn hàng thuộc Workstream A; ràng buộc cứng ở đây là biến E-learning thành người đọc `Order`.


-- Chạy lại được (luật [MIG-01]): hỏi pg_type trước khi tạo enum.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlCourseSaleStatus') THEN CREATE TYPE "OnlCourseSaleStatus" AS ENUM ('NOT_ON_SALE', 'SCHEDULED', 'ON_SALE', 'PAUSED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlCourseLevel') THEN CREATE TYPE "OnlCourseLevel" AS ENUM ('INTRO', 'BASIC', 'INTERMEDIATE', 'ADVANCED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlPrerequisiteMode') THEN CREATE TYPE "OnlPrerequisiteMode" AS ENUM ('NONE', 'RECOMMENDED', 'REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlVersionStatus') THEN CREATE TYPE "OnlVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlProgressPolicy') THEN CREATE TYPE "OnlProgressPolicy" AS ENUM ('KEEP_PROGRESS', 'RELEARN_SELECTED', 'RESET_BY_SCOPE', 'ADD_NEW_ONLY'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlLessonKind') THEN CREATE TYPE "OnlLessonKind" AS ENUM ('VIDEO', 'READ', 'ASSIGNMENT', 'QUIZ', 'FINAL_EXAM'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlEntitlementStatus') THEN CREATE TYPE "OnlEntitlementStatus" AS ENUM ('ACTIVE', 'REVOKED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlEntitlementSource') THEN CREATE TYPE "OnlEntitlementSource" AS ENUM ('PURCHASE', 'FREE_GRANT'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlEntitlementEventKind') THEN CREATE TYPE "OnlEntitlementEventKind" AS ENUM ('GRANTED', 'RENEWED', 'REOPENED_AFTER_EXPIRY', 'REOPENED_AFTER_REVOKE', 'REVOKED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OnlLessonProgressStatus') THEN CREATE TYPE "OnlLessonProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'); END IF;
END $$;

-- ─── Danh mục (2 cấp: cha → con) ───
CREATE TABLE IF NOT EXISTS "OnlCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "parentId" TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "OnlCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCategory_slug_key" ON "OnlCategory"("slug");
CREATE INDEX IF NOT EXISTS "OnlCategory_parentId_idx" ON "OnlCategory"("parentId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlCategory_parentId_fkey') THEN ALTER TABLE "OnlCategory" ADD CONSTRAINT "OnlCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OnlCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

-- ─── Khoá Online ───
CREATE TABLE IF NOT EXISTS "OnlCourse" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shortDescription" TEXT,
  "fullDescription" TEXT,
  "categoryId" TEXT,
  "level" "OnlCourseLevel",
  "gradeFrom" INTEGER,
  "gradeTo" INTEGER,
  "prerequisiteMode" "OnlPrerequisiteMode" NOT NULL DEFAULT 'NONE',
  "prerequisiteCourseId" TEXT,
  "coverImageKey" TEXT,
  "trailerKey" TEXT,
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  -- Giá: số nguyên đồng. `salePrice <= listPrice` ép bằng CHECK ở dưới.
  "listPrice" INTEGER NOT NULL DEFAULT 0,
  "salePrice" INTEGER NOT NULL DEFAULT 0,
  -- Kỳ hạn học: NULL = TRỌN ĐỜI; ngược lại số THÁNG LỊCH (1..120). Phụ huynh không chọn.
  "validityMonths" INTEGER,
  "renewalEnabled" BOOLEAN NOT NULL DEFAULT false,
  "renewalPrice" INTEGER,
  "saleStatus" "OnlCourseSaleStatus" NOT NULL DEFAULT 'NOT_ON_SALE',
  "saleOpensAt" TIMESTAMPTZ(6),
  "publishedVersionId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  "deletedAt" TIMESTAMPTZ(6),
  CONSTRAINT "OnlCourse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnlCourse_gia_check" CHECK ("listPrice" >= 0 AND "salePrice" >= 0 AND "salePrice" <= "listPrice"),
  CONSTRAINT "OnlCourse_gia_han_check" CHECK ("renewalPrice" IS NULL OR "renewalPrice" >= 0),
  CONSTRAINT "OnlCourse_ky_han_check" CHECK ("validityMonths" IS NULL OR ("validityMonths" BETWEEN 1 AND 120)),
  CONSTRAINT "OnlCourse_ma_check" CHECK ("code" ~ '^[A-Z0-9-]+$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCourse_code_key" ON "OnlCourse"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCourse_slug_key" ON "OnlCourse"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCourse_publishedVersionId_key" ON "OnlCourse"("publishedVersionId");
CREATE INDEX IF NOT EXISTS "OnlCourse_saleStatus_displayOrder_idx" ON "OnlCourse"("saleStatus", "displayOrder");
CREATE INDEX IF NOT EXISTS "OnlCourse_categoryId_idx" ON "OnlCourse"("categoryId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlCourse_categoryId_fkey') THEN ALTER TABLE "OnlCourse" ADD CONSTRAINT "OnlCourse_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "OnlCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlCourse_prerequisiteCourseId_fkey') THEN ALTER TABLE "OnlCourse" ADD CONSTRAINT "OnlCourse_prerequisiteCourseId_fkey" FOREIGN KEY ("prerequisiteCourseId") REFERENCES "OnlCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

-- ─── Phiên bản khoá (bản đang chạy bất biến; sửa đi qua bản NHÁP) ───
CREATE TABLE IF NOT EXISTS "OnlCourseVersion" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "status" "OnlVersionStatus" NOT NULL DEFAULT 'DRAFT',
  -- Cài đặt học tập của BẢN này (điều kiện qua bài, mở bài, thi cuối, xem lại…) — xem `lib/elearning-online/cai-dat-hoc-tap.ts`.
  "settingsJson" JSONB NOT NULL DEFAULT '{}',
  "changeSummaryJson" JSONB,
  -- Chỉ có khi PUBLISHED: chính sách tiến độ Đào tạo CHỌN lúc phát hành (bắt buộc, KHÔNG có mặc định) + ảnh chụp tác động.
  "progressPolicy" "OnlProgressPolicy",
  "progressPolicyDetailJson" JSONB,
  "impactJson" JSONB,
  "publishedAt" TIMESTAMPTZ(6),
  "publishedByUserId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "OnlCourseVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnlCourseVersion_phat_hanh_check" CHECK (
    ("status" = 'DRAFT' AND "publishedAt" IS NULL AND "progressPolicy" IS NULL)
    OR ("status" IN ('PUBLISHED', 'SUPERSEDED') AND "publishedAt" IS NOT NULL AND ("progressPolicy" IS NOT NULL OR "number" = 1))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCourseVersion_courseId_number_key" ON "OnlCourseVersion"("courseId", "number");
-- Mỗi khoá tối đa MỘT bản nháp và MỘT bản đang chạy — khoá ở DB, không phải kiểm tra ứng dụng.
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCourseVersion_mot_ban_nhap_key" ON "OnlCourseVersion"("courseId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX IF NOT EXISTS "OnlCourseVersion_mot_ban_chay_key" ON "OnlCourseVersion"("courseId") WHERE "status" = 'PUBLISHED';
CREATE INDEX IF NOT EXISTS "OnlCourseVersion_courseId_status_idx" ON "OnlCourseVersion"("courseId", "status");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlCourseVersion_courseId_fkey') THEN ALTER TABLE "OnlCourseVersion" ADD CONSTRAINT "OnlCourseVersion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "OnlCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlCourse_publishedVersionId_fkey') THEN ALTER TABLE "OnlCourse" ADD CONSTRAINT "OnlCourse_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "OnlCourseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF; END $$;

-- ─── Chương / bài THEO BẢN. `stableId` giữ nguyên giữa các bản (tiến độ khoá theo nó, không theo id hàng). ───
CREATE TABLE IF NOT EXISTS "OnlChapter" (
  "id" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "stableId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "OnlChapter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlChapter_versionId_stableId_key" ON "OnlChapter"("versionId", "stableId");
CREATE INDEX IF NOT EXISTS "OnlChapter_versionId_orderIndex_idx" ON "OnlChapter"("versionId", "orderIndex");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlChapter_versionId_fkey') THEN ALTER TABLE "OnlChapter" ADD CONSTRAINT "OnlChapter_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "OnlCourseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

CREATE TABLE IF NOT EXISTS "OnlLesson" (
  "id" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "chapterId" TEXT NOT NULL,
  "stableId" TEXT NOT NULL,
  "kind" "OnlLessonKind" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "thumbnailKey" TEXT,
  "orderIndex" INTEGER NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "freePreview" BOOLEAN NOT NULL DEFAULT false,
  "durationSec" INTEGER,
  -- Tham chiếu nội dung (khoá kho media / markdown / đề) — KHÔNG chứa URL công khai của nội dung trả phí.
  "contentJson" JSONB NOT NULL DEFAULT '{}',
  "passPercent" INTEGER,
  CONSTRAINT "OnlLesson_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnlLesson_nguong_check" CHECK ("passPercent" IS NULL OR ("passPercent" BETWEEN 0 AND 100))
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlLesson_versionId_stableId_key" ON "OnlLesson"("versionId", "stableId");
CREATE INDEX IF NOT EXISTS "OnlLesson_chapterId_orderIndex_idx" ON "OnlLesson"("chapterId", "orderIndex");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlLesson_versionId_fkey') THEN ALTER TABLE "OnlLesson" ADD CONSTRAINT "OnlLesson_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "OnlCourseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlLesson_chapterId_fkey') THEN ALTER TABLE "OnlLesson" ADD CONSTRAINT "OnlLesson_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "OnlChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- ─── QUYỀN HỌC: MỘT dòng cho mỗi (học viên × khoá) ───
CREATE TABLE IF NOT EXISTS "OnlEntitlement" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "status" "OnlEntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "OnlEntitlementSource" NOT NULL,
  "startsAt" TIMESTAMPTZ(6) NOT NULL,
  -- NULL = TRỌN ĐỜI. HẾT HẠN KHÔNG được lưu: suy từ cột này so với giờ hiện tại.
  "expiresAt" TIMESTAMPTZ(6),
  -- Ngày-trong-tháng (giờ VN) của lần cấp đầu, để gia hạn liên tiếp không trôi ngày (31/01 → 28/02 → 31/03).
  "anchorDay" INTEGER NOT NULL,
  "validityMonthsSnapshot" INTEGER,
  "revokedAt" TIMESTAMPTZ(6),
  "revokedReason" TEXT,
  "revokedByUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "OnlEntitlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnlEntitlement_anchor_check" CHECK ("anchorDay" BETWEEN 1 AND 31),
  CONSTRAINT "OnlEntitlement_thu_hoi_check" CHECK (
    ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND length(btrim(coalesce("revokedReason", ''))) >= 10)
    OR ("status" = 'ACTIVE' AND "revokedAt" IS NULL)
  )
);
-- MỘT con không có hai quyền cho cùng một khoá — TUYỆT ĐỐI (mua lại/gia hạn ghi lên chính dòng này).
CREATE UNIQUE INDEX IF NOT EXISTS "OnlEntitlement_studentId_courseId_key" ON "OnlEntitlement"("studentId", "courseId");
CREATE INDEX IF NOT EXISTS "OnlEntitlement_courseId_status_idx" ON "OnlEntitlement"("courseId", "status");
CREATE INDEX IF NOT EXISTS "OnlEntitlement_studentId_idx" ON "OnlEntitlement"("studentId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlEntitlement_studentId_fkey') THEN ALTER TABLE "OnlEntitlement" ADD CONSTRAINT "OnlEntitlement_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlEntitlement_courseId_fkey') THEN ALTER TABLE "OnlEntitlement" ADD CONSTRAINT "OnlEntitlement_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "OnlCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- ─── Sự kiện quyền (BẤT BIẾN: chỉ thêm). `idempotencyKey` duy nhất ⇒ webhook/gọi lại không cấp hai lần. ───
CREATE TABLE IF NOT EXISTS "OnlEntitlementEvent" (
  "id" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "kind" "OnlEntitlementEventKind" NOT NULL,
  "source" "OnlEntitlementSource",
  "idempotencyKey" TEXT NOT NULL,
  "monthsAdded" INTEGER,
  "fromExpiresAt" TIMESTAMPTZ(6),
  "toExpiresAt" TIMESTAMPTZ(6),
  "orderId" TEXT,
  "orderItemId" TEXT,
  "reason" TEXT,
  "actorUserId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnlEntitlementEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlEntitlementEvent_idempotencyKey_key" ON "OnlEntitlementEvent"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "OnlEntitlementEvent_entitlementId_createdAt_idx" ON "OnlEntitlementEvent"("entitlementId", "createdAt");
CREATE INDEX IF NOT EXISTS "OnlEntitlementEvent_orderId_idx" ON "OnlEntitlementEvent"("orderId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlEntitlementEvent_entitlementId_fkey') THEN ALTER TABLE "OnlEntitlementEvent" ADD CONSTRAINT "OnlEntitlementEvent_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "OnlEntitlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- Sự kiện không sửa/xoá: chặn ở DB (kể cả SQL tay).
CREATE OR REPLACE FUNCTION onl_entitlement_event_bat_bien() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OnlEntitlementEvent là sổ chỉ-thêm: không %', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END $$;
DROP TRIGGER IF EXISTS "OnlEntitlementEvent_bat_bien_trg" ON "OnlEntitlementEvent";
CREATE TRIGGER "OnlEntitlementEvent_bat_bien_trg" BEFORE UPDATE OR DELETE ON "OnlEntitlementEvent" FOR EACH ROW EXECUTE FUNCTION onl_entitlement_event_bat_bien();

-- ─── Tiến độ theo bài (khoá theo QUYỀN × bài ổn định — sống sót qua các bản) ───
CREATE TABLE IF NOT EXISTS "OnlLessonProgress" (
  "id" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "lessonStableId" TEXT NOT NULL,
  "status" "OnlLessonProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "percent" INTEGER NOT NULL DEFAULT 0,
  "bestScore" INTEGER,
  "completedAt" TIMESTAMPTZ(6),
  -- Bản đã hoàn thành bài này (để biết bài đổi ở bản sau có phải học lại).
  "completedVersionNumber" INTEGER,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "OnlLessonProgress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnlLessonProgress_percent_check" CHECK ("percent" BETWEEN 0 AND 100),
  CONSTRAINT "OnlLessonProgress_xong_check" CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "OnlLessonProgress_entitlementId_lessonStableId_key" ON "OnlLessonProgress"("entitlementId", "lessonStableId");
CREATE INDEX IF NOT EXISTS "OnlLessonProgress_entitlementId_idx" ON "OnlLessonProgress"("entitlementId");
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OnlLessonProgress_entitlementId_fkey') THEN ALTER TABLE "OnlLessonProgress" ADD CONSTRAINT "OnlLessonProgress_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "OnlEntitlement"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- ─── RLS: chỉ ENABLE (không FORCE, không policy) — khuôn của repo ───
ALTER TABLE "OnlCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlCourse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlCourseVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlChapter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlLesson" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlEntitlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlEntitlementEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnlLessonProgress" ENABLE ROW LEVEL SECURITY;
