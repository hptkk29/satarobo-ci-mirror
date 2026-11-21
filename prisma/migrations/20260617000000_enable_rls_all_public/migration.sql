-- FIX-C1 · Bật Row Level Security (RLS) cho TOÀN BỘ bảng trong schema `public`.
--
-- Mục đích: phòng thủ chiều sâu cho bề mặt PostgREST / anon role của Supabase.
-- Bật RLS mà CHƯA tạo policy nào = mặc định CHẶN HẾT mọi truy cập của các role
-- thường (anon / authenticated) → an toàn cho dữ liệu PII học viên/phụ huynh.
--
-- ⚠️ CHỈ dùng `ENABLE`, KHÔNG dùng `FORCE` (xem ERD-impact-map quyết định #5):
--   Backend app kết nối Postgres qua Prisma bằng role owner/đặc quyền (qua pooler).
--   - `ENABLE ROW LEVEL SECURITY` KHÔNG áp dụng cho role OWNER của bảng → Prisma
--     (owner) vẫn đọc/ghi bình thường, app KHÔNG vỡ. RLS chỉ chặn role non-owner
--     (anon/authenticated qua PostgREST), đúng mục tiêu phòng thủ.
--   - `FORCE ROW LEVEL SECURITY` sẽ áp policy cho CẢ role owner → vì chưa có policy
--     nào, nó sẽ chặn luôn chính Prisma => vỡ toàn bộ app. KHÔNG dùng ở giai đoạn này.
--
-- Lưu ý vận hành (thủ công, NGOÀI migration này): cân nhắc REVOKE quyền của role
-- `anon` / `authenticated` trên schema `public` ở Supabase dashboard để siết thêm.
--
-- Bỏ qua các bảng nội bộ của Prisma (`_prisma_migrations`, ...). Idempotent: bật RLS
-- nhiều lần là no-op an toàn.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '_prisma%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;
