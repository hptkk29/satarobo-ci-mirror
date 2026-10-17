-- FIX-C2 — Chuyển MỌI cột `timestamp without time zone` → `timestamptz(6)`.
--
-- ⚠️ CHIỀU CONVERT = 'UTC', KHÔNG phải 'Asia/Ho_Chi_Minh'.
-- Prisma ghi DateTime vào cột timestamp-without-tz dưới dạng UTC wall-clock
-- (serialize ISO `...Z`, Postgres cắt offset) → giá trị naive đang lưu CHÍNH LÀ UTC.
-- Vì vậy diễn giải naive là UTC (`AT TIME ZONE 'UTC'`) sẽ GIỮ ĐÚNG mốc thời gian.
-- Dùng 'Asia/Ho_Chi_Minh' sẽ coi naive là giờ VN → dịch SAI −7h toàn bộ lịch sử.
--
-- ⚠️ TRƯỚC KHI APPLY PROD: verify trên staging rằng mọi ghi đều qua Prisma (UTC).
-- Nếu có data nhập bằng raw SQL `now()` / seed dùng chuỗi local → chiều có thể khác.
--
-- Bỏ qua bảng nội bộ Prisma (`_prisma%`). Cột `date`/`@db.Date` (data_type='date')
-- và giờ `String "HH:mm"` KHÔNG bị đụng (chỉ lọc data_type='timestamp without time zone').
-- ALTER COLUMN TYPE = ACCESS EXCLUSIVE + rewrite → chạy giờ thấp điểm; bảng lớn
-- (Attendance/AuditLog/DomainEvent) sẽ lock lâu.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type = 'timestamp without time zone'
      AND table_name NOT LIKE '_prisma%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I TYPE timestamptz(6) USING %I AT TIME ZONE ''UTC'';',
      r.table_name, r.column_name, r.column_name
    );
  END LOOP;
END $$;
