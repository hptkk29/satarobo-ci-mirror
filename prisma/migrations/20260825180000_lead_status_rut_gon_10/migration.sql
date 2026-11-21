-- GĐ5 — RÚT LeadStatus TỪ 15 XUỐNG 10 GIÁ TRỊ, đổi sang tên tiếng Việt không dấu.
--
-- ⚠️⚠️ ĐÂY LÀ MIGRATION PHÁ HUỶ NHẤT CỦA CẢ ĐỢT. Đọc hết trước khi chạy.
--
-- Nó đổi KIỂU của một cột trên bảng Lead — bảng nghiệp vụ lớn nhất. Sai một nhánh
-- CASE là toàn bộ dòng Lead ném lỗi cast và migration dừng giữa chừng.
--
-- ĐIỀU KIỆN TIÊN QUYẾT (đã làm ở commit trước, đừng chạy migration này nếu chưa có):
--   Khoá chống đua của convert phải bám `convertedAt IS NULL`, KHÔNG bám status.
--   Khoá cũ dựa vào ENROLLED nằm trong danh sách terminal; sau khi gộp ENROLLED vào
--   DA_DANG_KY thì lead "mới đăng ký" cũng mang giá trị đó ⇒ sẽ KHÔNG BAO GIỜ
--   convert được nữa.
--
-- TRƯỚC KHI CHẠY TRÊN PROD — đếm số dòng theo từng giá trị, ĐỪNG ĐOÁN:
--   SELECT status, COUNT(*) FROM "Lead" GROUP BY status ORDER BY 2 DESC;
-- Đặc biệt để ý DEMO_SCHEDULED (nhiều khả năng 0 dòng vì migration 20260528 đã map
-- hết) và DUPLICATE (không đường code nào ghi, nhưng dữ liệu import cũ có thể có).
--
-- THÔNG TIN BỊ MẤT, chấp nhận có ý thức:
--   NO_ANSWER → DA_LIEN_HE  : mất dấu "gọi không nghe". Chỗ chứa đúng của nó là bộ
--                             đếm soLanGoiHut trên bảng log liên hệ — bảng đó CHƯA
--                             tồn tại, nên không có nơi nào để chuyển vào.
--   ASSIGNED  → MOI         : không mất gì, `assignedToId` vẫn còn nguyên.
--   DUPLICATE → DA_MAT      : ĐƯỢC GIỮ LẠI qua `dropReason` (xem bước 1).

-- ─── Bước 1: giữ lại thông tin sắp mất, TRƯỚC khi đổi kiểu ───────────────────
-- Cột `dropReason` do GĐ1 thêm. Ghi trước để nếu bước 2 hỏng thì vẫn còn dấu vết.
UPDATE "Lead"
SET "dropReason" = COALESCE("dropReason", 'Trùng lặp (gộp từ trạng thái DUPLICATE cũ)')
WHERE "status"::text = 'DUPLICATE';

UPDATE "Lead"
SET "dropReason" = COALESCE("dropReason", 'Không nghe máy (gộp từ trạng thái NO_ANSWER cũ)')
WHERE "status"::text = 'NO_ANSWER';

-- ─── Bước 2: dựng kiểu mới và cast ──────────────────────────────────────────
ALTER TYPE "LeadStatus" RENAME TO "LeadStatus_old";

CREATE TYPE "LeadStatus" AS ENUM (
  'MOI',
  'DA_LIEN_HE',
  'DANG_TU_VAN',
  'DA_HEN_HOC_THU',
  'DANG_HOC_THU',
  'DA_HOC_THU',
  'CHO_QUYET_DINH',
  'DA_DANG_KY',
  'DANG_NUOI_DUONG',
  'DA_MAT'
);

-- Bảng ánh xạ dùng chung cho cả ba cột. `ELSE 'MOI'` là lưới an toàn: nếu DB có giá
-- trị nào ngoài 15 cái đã biết (dữ liệu import tay, migration lỗi cũ) thì nó rơi về
-- bậc đầu phễu thay vì làm nổ cả migration.
ALTER TABLE "Lead" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Lead" ALTER COLUMN "status" TYPE "LeadStatus" USING (
  CASE "status"::text
    WHEN 'NEW'               THEN 'MOI'
    WHEN 'ASSIGNED'          THEN 'MOI'
    WHEN 'CONTACTED'         THEN 'DA_LIEN_HE'
    WHEN 'NO_ANSWER'         THEN 'DA_LIEN_HE'
    WHEN 'CONSULTING'        THEN 'DANG_TU_VAN'
    WHEN 'TRIAL_SCHEDULED'   THEN 'DA_HEN_HOC_THU'
    WHEN 'DEMO_SCHEDULED'    THEN 'DA_HEN_HOC_THU'
    WHEN 'TRIAL_IN_PROGRESS' THEN 'DANG_HOC_THU'
    WHEN 'TRIAL_ATTENDED'    THEN 'DA_HOC_THU'
    WHEN 'AWAITING_DECISION' THEN 'CHO_QUYET_DINH'
    WHEN 'REGISTERED'        THEN 'DA_DANG_KY'
    WHEN 'ENROLLED'          THEN 'DA_DANG_KY'
    WHEN 'NURTURING'         THEN 'DANG_NUOI_DUONG'
    WHEN 'LOST'              THEN 'DA_MAT'
    WHEN 'DUPLICATE'         THEN 'DA_MAT'
    ELSE 'MOI'
  END::"LeadStatus"
);

ALTER TABLE "Lead" ALTER COLUMN "status" SET DEFAULT 'MOI';

-- Cột bậc-rơi của GĐ1 (nullable — giữ NULL nguyên vẹn).
ALTER TABLE "Lead" ALTER COLUMN "droppedAtStage" TYPE "LeadStatus" USING (
  CASE "droppedAtStage"::text
    WHEN 'NEW'               THEN 'MOI'
    WHEN 'ASSIGNED'          THEN 'MOI'
    WHEN 'CONTACTED'         THEN 'DA_LIEN_HE'
    WHEN 'NO_ANSWER'         THEN 'DA_LIEN_HE'
    WHEN 'CONSULTING'        THEN 'DANG_TU_VAN'
    WHEN 'TRIAL_SCHEDULED'   THEN 'DA_HEN_HOC_THU'
    WHEN 'DEMO_SCHEDULED'    THEN 'DA_HEN_HOC_THU'
    WHEN 'TRIAL_IN_PROGRESS' THEN 'DANG_HOC_THU'
    WHEN 'TRIAL_ATTENDED'    THEN 'DA_HOC_THU'
    WHEN 'AWAITING_DECISION' THEN 'CHO_QUYET_DINH'
    WHEN 'REGISTERED'        THEN 'DA_DANG_KY'
    WHEN 'ENROLLED'          THEN 'DA_DANG_KY'
    WHEN 'NURTURING'         THEN 'DANG_NUOI_DUONG'
    WHEN 'LOST'              THEN 'DA_MAT'
    WHEN 'DUPLICATE'         THEN 'DA_MAT'
    ELSE NULL
  END::"LeadStatus"
);

-- Sổ trạng thái của GĐ1. Bảng này mới nên có thể chưa có dòng nào, nhưng cột vẫn
-- phải đổi kiểu cùng lúc — để lại là DROP TYPE ở bước 3 sẽ nổ.
ALTER TABLE "LeadStatusHistory" ALTER COLUMN "fromStatus" TYPE "LeadStatus" USING (
  CASE "fromStatus"::text
    WHEN 'NEW'               THEN 'MOI'
    WHEN 'ASSIGNED'          THEN 'MOI'
    WHEN 'CONTACTED'         THEN 'DA_LIEN_HE'
    WHEN 'NO_ANSWER'         THEN 'DA_LIEN_HE'
    WHEN 'CONSULTING'        THEN 'DANG_TU_VAN'
    WHEN 'TRIAL_SCHEDULED'   THEN 'DA_HEN_HOC_THU'
    WHEN 'DEMO_SCHEDULED'    THEN 'DA_HEN_HOC_THU'
    WHEN 'TRIAL_IN_PROGRESS' THEN 'DANG_HOC_THU'
    WHEN 'TRIAL_ATTENDED'    THEN 'DA_HOC_THU'
    WHEN 'AWAITING_DECISION' THEN 'CHO_QUYET_DINH'
    WHEN 'REGISTERED'        THEN 'DA_DANG_KY'
    WHEN 'ENROLLED'          THEN 'DA_DANG_KY'
    WHEN 'NURTURING'         THEN 'DANG_NUOI_DUONG'
    WHEN 'LOST'              THEN 'DA_MAT'
    WHEN 'DUPLICATE'         THEN 'DA_MAT'
    ELSE NULL
  END::"LeadStatus"
);

ALTER TABLE "LeadStatusHistory" ALTER COLUMN "toStatus" TYPE "LeadStatus" USING (
  CASE "toStatus"::text
    WHEN 'NEW'               THEN 'MOI'
    WHEN 'ASSIGNED'          THEN 'MOI'
    WHEN 'CONTACTED'         THEN 'DA_LIEN_HE'
    WHEN 'NO_ANSWER'         THEN 'DA_LIEN_HE'
    WHEN 'CONSULTING'        THEN 'DANG_TU_VAN'
    WHEN 'TRIAL_SCHEDULED'   THEN 'DA_HEN_HOC_THU'
    WHEN 'DEMO_SCHEDULED'    THEN 'DA_HEN_HOC_THU'
    WHEN 'TRIAL_IN_PROGRESS' THEN 'DANG_HOC_THU'
    WHEN 'TRIAL_ATTENDED'    THEN 'DA_HOC_THU'
    WHEN 'AWAITING_DECISION' THEN 'CHO_QUYET_DINH'
    WHEN 'REGISTERED'        THEN 'DA_DANG_KY'
    WHEN 'ENROLLED'          THEN 'DA_DANG_KY'
    WHEN 'NURTURING'         THEN 'DANG_NUOI_DUONG'
    WHEN 'LOST'              THEN 'DA_MAT'
    WHEN 'DUPLICATE'         THEN 'DA_MAT'
    ELSE 'MOI'
  END::"LeadStatus"
);

-- ─── Bước 3: bỏ kiểu cũ ─────────────────────────────────────────────────────
-- Nếu lệnh này nổ vì "còn phụ thuộc" thì nghĩa là còn CỘT NÀO ĐÓ dùng kiểu cũ mà
-- migration này chưa xử. Tra bằng:
--   SELECT c.table_name, c.column_name FROM information_schema.columns c
--   WHERE c.udt_name = 'LeadStatus_old';
DROP TYPE "LeadStatus_old";
