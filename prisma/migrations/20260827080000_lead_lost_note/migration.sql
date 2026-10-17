-- `Lead.lostNote` / `Lead.lostAt` — LÝ DO RỚT ở cấp PHỤ HUYNH (ô ghi chú tự do).
--
-- Hai cột này ra đời ở một luồng làm song song (C-06, quyết định B5 + 12(b) ngày
-- 24/08/2026) và nằm trong migration của luồng đó. Nhánh này tách riêng để lên `main`
-- trước, mà bản vá 20260827090000 ("gộp hai cột lý do rớt") lại ĐỌC `lostNote` — nên
-- phải dựng cột ở đây, nếu không lệnh UPDATE ở bản sau nổ "column does not exist".
--
-- `IF NOT EXISTS` để idempotent: trên dev/test cột đã có sẵn từ migration của luồng kia.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lostNote" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lostAt" TIMESTAMPTZ(6);
