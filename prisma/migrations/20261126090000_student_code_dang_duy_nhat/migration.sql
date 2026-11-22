-- Mã học viên CHỈ CÓ MỘT DẠNG: <mã cơ sở>-<2 số cuối năm>-<6 ký tự>, ví dụ CS1-26-AB3K9P. [chủ dự án chốt 06/11/2026]
--
-- Vì sao ở tầng DB: ngày 06/11/2026 màn Học viên hiện `COSONGUYENHUUTHO-26-FD8Q6T` cạnh `CS1-26-XVM455` — tiền tố lấy nhầm từ
-- `Center.id` (slug) thay vì `Center.code`. Cổng ở tầng ứng dụng (`lib/students/ma-hoc-vien-dang.ts`) đã có, nhưng SQL tay / script
-- ghi thẳng DB đi vòng qua nó; chủ dự án đòi "từ nay về sau không được bị lại". Trigger này là hàng rào cuối, mọi đường ghi đều qua.
--
-- ⚠️ Mã sai ấy VẪN KHỚP mẫu `XXX-26-XXXXXX` ⇒ CHECK chỉ-hình-dạng không bắt được. Phải đối chiếu TIỀN TỐ với `Center.code` của học
-- viên, mà CHECK không tra được bảng khác ⇒ dùng trigger.
--
-- Chỉ kiểm khi GHI MỚI hoặc khi ĐỔI mã:
--   · `studentCode IS NULL` ⇒ cho qua (học viên chưa có mã, vd nhập Excel dòng trống);
--   · UPDATE không đụng mã (hoặc đặt lại đúng mã cũ) ⇒ cho qua: học viên mang mã cũ ở môi trường khác vẫn sửa được các ô khác.
-- Học viên chưa gắn cơ sở (`centerId IS NULL`), hoặc cơ sở chưa có mã ⇒ chỉ kiểm hình dạng (không có gì để đối chiếu tiền tố).
--
-- Dữ liệu hiện có KHÔNG bị chạm: trigger không quét lại bảng. Đo prod 06/11/2026 sau khi sửa 4 dòng: 148/148 đúng dạng, 0 tiền tố
-- lệch mã cơ sở. DB khác (test/dev) có thể còn mã cũ — vô hại, chỉ lúc ĐỔI mã mới bị kiểm.
--
-- Rollback: DROP TRIGGER "Student_studentCode_dang_trg" ON "Student"; DROP FUNCTION student_code_dang_duy_nhat();

CREATE OR REPLACE FUNCTION student_code_dang_duy_nhat() RETURNS trigger AS $$
DECLARE
  ma_co_so text;
  tien_to  text;
BEGIN
  IF NEW."studentCode" IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."studentCode" IS NOT DISTINCT FROM OLD."studentCode" THEN
    RETURN NEW;
  END IF;

  IF NEW."studentCode" !~ '^[A-Z0-9]+-[0-9]{2}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' THEN
    RAISE EXCEPTION 'Mã học viên "%" sai dạng: phải là CS1-26-AB3K9P (mã cơ sở - 2 số cuối năm - 6 ký tự in hoa/số, không dùng I, L, O, 0, 1)', NEW."studentCode"
      USING ERRCODE = '23514', CONSTRAINT = 'Student_studentCode_dang_chk';
  END IF;

  IF NEW."centerId" IS NOT NULL THEN
    SELECT regexp_replace(upper(c.code), '[^A-Z0-9]', '', 'g') INTO ma_co_so
      FROM "Center" c WHERE c.id = NEW."centerId";

    -- Cơ sở không tồn tại / chưa có mã ⇒ không có tiền tố nào để đối chiếu: chỉ kiểm hình dạng (đã xong ở trên). Tầng ứng dụng
    -- (`genStudentCodeV2ChoCoSo`, `loiMaHocVienTheoCoSo`) vẫn TỪ CHỐI cơ sở thiếu mã; đo prod 06/11: 0 cơ sở thiếu mã.
    IF ma_co_so IS NULL OR ma_co_so = '' THEN
      RETURN NEW;
    END IF;

    tien_to := split_part(NEW."studentCode", '-', 1);
    IF tien_to <> ma_co_so THEN
      RAISE EXCEPTION 'Mã học viên "%" phải bắt đầu bằng mã cơ sở của học viên này: "%-"', NEW."studentCode", ma_co_so
        USING ERRCODE = '23514', CONSTRAINT = 'Student_studentCode_coso_chk';
    END IF;
  END IF;

  RETURN NEW;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Student_studentCode_dang_trg"
  BEFORE INSERT OR UPDATE OF "studentCode" ON "Student"
  FOR EACH ROW EXECUTE FUNCTION student_code_dang_duy_nhat();
