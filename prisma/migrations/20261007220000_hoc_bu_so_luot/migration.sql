-- T06 (Học bù · SỔ LƯỢT) — CHỈ THÊM hai bảng mới, không đụng bảng đang có. CHẠY LẠI ĐƯỢC (luật [MIG-01]).
--
-- Trước T06 "còn mấy lượt" KHÔNG phải một con số lưu ở đâu cả: mỗi lần mở màn, `boSungDong` tính lại từ đơn hàng + bài học + cấu
-- hình học phần rồi trừ đếm `usedQuota`/`dungLuot`. Hệ quả đo được (audit 07/10/2026):
--   · HB-18  đơn huỷ/hoàn ⇒ không còn dòng đơn nào khai số buổi ⇒ rơi về `Course.totalSessions` ⇒ lượt TĂNG về đủ khoá;
--   · HB-19  chuyển lớp: quỹ đếm theo (học viên, LỚP) ⇒ lớp mới đếm lại từ 0;
--   · HB-20  hai dòng cùng bé xếp cùng lúc đều thấy "còn 1 lượt" ⇒ vượt lượt, và `conLuotBu` che số âm bằng `Math.max(0, …)`.
--
-- Sổ mới = một tài khoản MỖI (học viên, khoá) + các bút toán chỉ-thêm. Hàng tài khoản bị KHOÁ khi ghi (SELECT … FOR UPDATE) nên
-- hai lượt đồng thời xếp hàng; ràng buộc CHECK chặn số âm ở chính DB — một lỗi mã không thể "che" lượt âm nữa.
--
-- Ba cột delta thay cho một cột `delta` của bản thiết kế: "còn" = granted − held − consumed. Mỗi bút toán nói rõ nó đổi cột nào:
--   GRANT       granted +n
--   HOLD        held +1                      (xếp vào case bằng lượt)
--   RELEASE     held −1                      (gỡ / huỷ case / bé vắng buổi bù)
--   CONSUME     held −1, consumed +1         (bé CÓ MẶT; held=0 chỉ cho dòng cũ được nhập vào sổ — không có HOLD để nhả)
--   ADJUSTMENT  granted ±n                   (đơn huỷ/hoàn/đổi số buổi — luôn kèm lý do)
--
-- Bút toán KHÔNG sửa được (trigger chặn UPDATE) và có khoá chống lặp (`idemKey` duy nhất trong tài khoản) — chạy lại một bước
-- không ghi hai lần. Không có FK tới MakeupNeed/MakeupCaseStudent: sổ phải sống lâu hơn dòng bị xoá (kiểm bằng checker T01, không
-- bằng khoá ngoại). KHÔNG mang `centerId`: quỹ lượt thuộc (học viên, khoá), chuyển cơ sở không được làm nó đổi chủ.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MakeupCreditEntryType') THEN
    CREATE TYPE "MakeupCreditEntryType" AS ENUM ('GRANT', 'HOLD', 'RELEASE', 'CONSUME', 'ADJUSTMENT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MakeupCreditAccount" (
  "id"        TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "courseId"  TEXT NOT NULL,
  "granted"   INTEGER NOT NULL DEFAULT 0,
  "held"      INTEGER NOT NULL DEFAULT 0,
  "consumed"  INTEGER NOT NULL DEFAULT 0,
  "version"   INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MakeupCreditAccount_pkey" PRIMARY KEY ("id"),
  -- Prisma không biểu diễn CHECK ⇒ chỉ có ở đây (kiểm drift KHÔNG hiện).
  CONSTRAINT "MakeupCreditAccount_khong_am_check" CHECK ("granted" >= 0 AND "held" >= 0 AND "consumed" >= 0),
  CONSTRAINT "MakeupCreditAccount_khong_vuot_check" CHECK ("granted" - "held" - "consumed" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "MakeupCreditAccount_studentId_courseId_key"
  ON "MakeupCreditAccount"("studentId", "courseId");
CREATE INDEX IF NOT EXISTS "MakeupCreditAccount_courseId_idx" ON "MakeupCreditAccount"("courseId");

CREATE TABLE IF NOT EXISTS "MakeupCreditEntry" (
  "id"             TEXT NOT NULL,
  "accountId"      TEXT NOT NULL,
  "type"           "MakeupCreditEntryType" NOT NULL,
  "grantedDelta"   INTEGER NOT NULL DEFAULT 0,
  "heldDelta"      INTEGER NOT NULL DEFAULT 0,
  "consumedDelta"  INTEGER NOT NULL DEFAULT 0,
  "makeupNeedId"   TEXT,
  "caseStudentId"  TEXT,
  "reason"         TEXT,
  "actorId"        TEXT,
  "idemKey"        TEXT,
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MakeupCreditEntry_pkey" PRIMARY KEY ("id"),
  -- Mỗi loại chỉ được đổi đúng cột của nó — bút toán "GRANT mà đổi held" là dữ liệu hỏng, không phải một dạng hợp lệ.
  CONSTRAINT "MakeupCreditEntry_dang_check" CHECK (
    ("type" = 'GRANT'      AND "grantedDelta" > 0 AND "heldDelta" = 0 AND "consumedDelta" = 0) OR
    ("type" = 'HOLD'       AND "grantedDelta" = 0 AND "heldDelta" = 1 AND "consumedDelta" = 0) OR
    ("type" = 'RELEASE'    AND "grantedDelta" = 0 AND "heldDelta" = -1 AND "consumedDelta" = 0) OR
    ("type" = 'CONSUME'    AND "grantedDelta" = 0 AND "heldDelta" IN (0, -1) AND "consumedDelta" = 1) OR
    ("type" = 'ADJUSTMENT' AND "grantedDelta" <> 0 AND "heldDelta" = 0 AND "consumedDelta" = 0 AND "reason" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "MakeupCreditEntry_accountId_createdAt_idx" ON "MakeupCreditEntry"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "MakeupCreditEntry_makeupNeedId_idx" ON "MakeupCreditEntry"("makeupNeedId");
CREATE INDEX IF NOT EXISTS "MakeupCreditEntry_caseStudentId_idx" ON "MakeupCreditEntry"("caseStudentId");
CREATE UNIQUE INDEX IF NOT EXISTS "MakeupCreditEntry_accountId_idemKey_key"
  ON "MakeupCreditEntry"("accountId", "idemKey");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCreditAccount_studentId_fkey') THEN
    ALTER TABLE "MakeupCreditAccount" ADD CONSTRAINT "MakeupCreditAccount_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCreditAccount_courseId_fkey') THEN
    ALTER TABLE "MakeupCreditAccount" ADD CONSTRAINT "MakeupCreditAccount_courseId_fkey"
      FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'MakeupCreditEntry_accountId_fkey') THEN
    ALTER TABLE "MakeupCreditEntry" ADD CONSTRAINT "MakeupCreditEntry_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "MakeupCreditAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Bút toán không sửa được. DELETE vẫn qua được (xoá học viên kéo theo tài khoản + bút toán) — chặn cả DELETE là chặn xoá học viên.
CREATE OR REPLACE FUNCTION "makeup_credit_entry_bat_bien"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'MakeupCreditEntry là sổ chỉ-thêm: không sửa bút toán (%). Ghi một bút toán ADJUSTMENT mới.', OLD."id";
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'makeup_credit_entry_khong_sua') THEN
    CREATE TRIGGER "makeup_credit_entry_khong_sua"
      BEFORE UPDATE ON "MakeupCreditEntry"
      FOR EACH ROW EXECUTE FUNCTION "makeup_credit_entry_bat_bien"();
  END IF;
END $$;

ALTER TABLE "MakeupCreditAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MakeupCreditEntry" ENABLE ROW LEVEL SECURITY;
