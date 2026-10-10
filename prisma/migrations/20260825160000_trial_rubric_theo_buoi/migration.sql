-- GĐ4 — PHIẾU ĐÁNH GIÁ THEO TỪNG BUỔI + ghi người điểm danh.
--
-- ⚠️ Đây là migration ĐỔI RÀNG BUỘC trên bảng đang có dữ liệu — khác hẳn ba migration
-- trước của đợt này (đều thuần additive). Đọc kỹ trước khi chạy.
--
-- VẤN ĐỀ ĐANG SỬA: `TrialRubricEval.trialEnrollmentId` là UNIQUE, tức mỗi ca chỉ chứa
-- được MỘT phiếu; mà đường ghi lại là `upsert` theo đúng khoá đó. Hệ quả: giáo viên
-- chấm buổi 2 GHI ĐÈ IM LẶNG phiếu buổi 1 và dời luôn con trỏ buổi.
--
-- ⚠️ DỮ LIỆU ĐÃ MẤT THÌ KHÔNG LẤY LẠI ĐƯỢC. Migration này chỉ chặn mất thêm. Đừng hứa
-- với ai là chạy xong sẽ thấy lại phiếu cũ.
--
-- Về NULL: khoá kép mới cho phép nhiều dòng có `trialClassSessionId` NULL (Postgres coi
-- NULL là khác nhau). Chấp nhận có chủ đích — phiếu không gắn buổi là dữ liệu CŨ, còn
-- mọi đường ghi từ GĐ4 đều bắt buộc có buổi (chặn ở tầng action).

-- ─── Bước 1: kiểm tra trước khi đổi ─────────────────────────────────────────
-- Nếu đã có cặp (ca, buổi) trùng nhau thì ADD CONSTRAINT sẽ nổ. Về lý thuyết không
-- thể có, vì khoá cũ chặt hơn (một ca một phiếu) — nhưng nổ ở đây tốt hơn nổ giữa chừng.
DO $$
DECLARE trung INTEGER;
BEGIN
  SELECT COUNT(*) INTO trung FROM (
    SELECT "trialEnrollmentId", "trialClassSessionId"
    FROM "TrialRubricEval"
    WHERE "trialClassSessionId" IS NOT NULL
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ) t;
  IF trung > 0 THEN
    RAISE EXCEPTION 'Có % cặp (ca, buổi) trùng — dừng migration, xử lý dữ liệu trước', trung;
  END IF;
END $$;

-- ─── Bước 2: bỏ khoá cũ, đặt khoá theo buổi ─────────────────────────────────
-- ⚠️ PHẢI là DROP INDEX, KHÔNG phải DROP CONSTRAINT.
--
-- Khoá cũ được tạo bằng `CREATE UNIQUE INDEX "TrialRubricEval_trialEnrollmentId_key"`
-- (xem 20260712000000_trial_rubric_eval/migration.sql:20) — đó là một INDEX, không
-- phải một ràng buộc ở cấp bảng. `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` sẽ chạy
-- XANH mà KHÔNG GỠ GÌ, và DB vẫn ép một ca một phiếu: giáo viên lưu phiếu buổi thứ hai
-- sẽ dính unique-violation, bị nuốt thành "Lỗi cơ sở dữ liệu".
-- Repo đã có tiền lệ làm đúng ở 20260618020000_exam_attempt_retake/migration.sql:5.
DROP INDEX IF EXISTS "TrialRubricEval_trialEnrollmentId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "TrialRubricEval_trialEnrollmentId_trialClassSessionId_key"
  ON "TrialRubricEval"("trialEnrollmentId", "trialClassSessionId");

-- Khoá cũ vốn đang phục vụ luôn việc tra theo ca; bỏ nó đi thì phải bù index thường,
-- nếu không mọi truy vấn "phiếu của ca này" chuyển sang quét bảng.
CREATE INDEX IF NOT EXISTS "TrialRubricEval_trialEnrollmentId_idx"
  ON "TrialRubricEval"("trialEnrollmentId");

-- ─── Bước 3: ghi người điểm danh (additive) ─────────────────────────────────
-- NULL với mọi dòng có trước GĐ4 — không suy ngược được ai đã điểm danh, đừng bịa.
ALTER TABLE "TrialAttendance" ADD COLUMN IF NOT EXISTS "markedById" TEXT;
