-- Hoá đơn điện tử — MÁY KÝ USB (hub/13 §5, phương án B: ứng dụng ký trên máy Windows của kế toán tự hỏi máy chủ qua HTTPS đi ra).
--
-- Bảng MỚI `HoaDonMayKy`: một dòng cho mỗi máy đã/đang được ghép.
--   · KHÔNG có centerId/orgUnitId: thiết bị gắn với MỘT NGƯỜI DÙNG (`userId`), không gắn với cơ sở; phạm vi việc ký do quyền của người đó quyết LÚC GỌI
--     (mỗi lời gọi resolveActor lại), nên mất quyền kế toán ⇒ máy mất tác dụng.
--   · Mã ghép (dùng một lần, ~10 phút) và token máy CHỈ được lưu dưới dạng SHA-256 (64 ký tự hex) — không bao giờ lưu bản rõ, không bao giờ trả lại sau khi cấp.
--   · Thu hồi = đặt `thuHoiLuc` và xoá hai băm (token không còn tra ra được).
--
-- CHỈ THÊM bảng mới. Idempotent (IF NOT EXISTS). Bảng mới phải tự bật RLS (chỉ ENABLE, không FORCE, không policy).

CREATE TABLE IF NOT EXISTS "HoaDonMayKy" (
    "id"            TEXT           NOT NULL,
    "userId"        TEXT           NOT NULL,
    "tenMay"        TEXT           NOT NULL,
    "maGhepHash"    TEXT,
    "maGhepHetHan"  TIMESTAMPTZ(6),
    "tokenHash"     TEXT,
    "tokenHetHan"   TIMESTAMPTZ(6),
    "thuHoiLuc"     TIMESTAMPTZ(6),
    "lanDungCuoi"   TIMESTAMPTZ(6),
    "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HoaDonMayKy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HoaDonMayKy_ma_ghep_hash_check" CHECK ("maGhepHash" IS NULL OR "maGhepHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HoaDonMayKy_token_hash_check" CHECK ("tokenHash" IS NULL OR "tokenHash" ~ '^[0-9a-f]{64}$'),
    -- Mã ghép luôn đi kèm hạn; token luôn đi kèm hạn.
    CONSTRAINT "HoaDonMayKy_ma_ghep_han_check" CHECK (("maGhepHash" IS NULL) = ("maGhepHetHan" IS NULL)),
    CONSTRAINT "HoaDonMayKy_token_han_check" CHECK (("tokenHash" IS NULL) = ("tokenHetHan" IS NULL)),
    -- Máy đã thu hồi không còn băm nào.
    CONSTRAINT "HoaDonMayKy_thu_hoi_check" CHECK ("thuHoiLuc" IS NULL OR ("maGhepHash" IS NULL AND "tokenHash" IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonMayKy_maGhepHash_key" ON "HoaDonMayKy"("maGhepHash");
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonMayKy_tokenHash_key" ON "HoaDonMayKy"("tokenHash");
CREATE INDEX IF NOT EXISTS "HoaDonMayKy_userId_idx" ON "HoaDonMayKy"("userId");

ALTER TABLE "HoaDonMayKy" ENABLE ROW LEVEL SECURITY;
