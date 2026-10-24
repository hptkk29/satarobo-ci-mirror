-- 30/09/2026 — TRẠNG THÁI LƯỢT IMPORT FILE POS (nợ 4 của docs/pos-the-smartpos.md).
--
-- Vì sao: bảng "10 lần import gần nhất" không phân biệt lượt DỪNG GIỮA CHỪNG với lượt xong,
-- và mỗi lần thử lại tạo thêm một lô 0 dòng. Nay lượt import mang trạng thái + số lô.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): một enum MỚI + bốn cột MỚI trên `PosImportBatch` —
-- bảng tạo ở 20260929120000, CHƯA lên prod. Không đổi / bỏ cột nào.
-- Lô CŨ (trước migration này) được coi là XONG: không có cách nào biết chúng dừng giữa chừng
-- hay không, và chúng đã hiện như "xong" từ trước — giữ nguyên thứ người dùng đang thấy.
--
-- Viết TAY (CẤM `prisma migrate dev` — drift 14 bảng, CLAUDE.md mục 6).

-- ─── Enum ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PosImportStatus') THEN
    CREATE TYPE "PosImportStatus" AS ENUM ('DANG_NHAP', 'XONG', 'DUNG_GIUA_CHUNG');
  END IF;
END $$;

-- ─── Cột mới ─────────────────────────────────────────────────────────────────
-- `trangThai` thêm với DEFAULT 'XONG' ⇒ mọi dòng đang có nhận XONG ngay trong câu ADD COLUMN
-- (backfill), rồi mới đổi DEFAULT sang 'DANG_NHAP' cho lượt mới.
ALTER TABLE "PosImportBatch" ADD COLUMN IF NOT EXISTS "trangThai" "PosImportStatus" NOT NULL DEFAULT 'XONG';
ALTER TABLE "PosImportBatch" ALTER COLUMN "trangThai" SET DEFAULT 'DANG_NHAP';

ALTER TABLE "PosImportBatch" ADD COLUMN IF NOT EXISTS "soLoTong" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PosImportBatch" ADD COLUMN IF NOT EXISTS "soLoXong" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PosImportBatch" ADD COLUMN IF NOT EXISTS "xongLuc" TIMESTAMPTZ(6);

-- Lô cũ: lúc xong = lần cập nhật cuối (lô cuối ghi số đếm là phép ghi cuối cùng lên dòng).
UPDATE "PosImportBatch" SET "xongLuc" = "updatedAt" WHERE "trangThai" = 'XONG' AND "xongLuc" IS NULL;
