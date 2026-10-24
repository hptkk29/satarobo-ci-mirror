-- PR2 hoá đơn (docs/ke-toan-hoa-don/NANG-CAP-2026-10.md): cấu hình pháp nhân + ký hiệu theo cơ sở × khoảng ngày.
--
-- ⚠️ CHỈ THÊM BẢNG MỚI — không đụng bảng đang có dữ liệu PROD (luật cứng #4), không backfill, không seed.
--    Cơ sở chưa có dòng nào ⇒ màn Hoá đơn rơi về mặc định trong mã (hành vi hiện tại), và NÓI RÕ là mặc định.
-- ⚠️ KHÔNG khoá duy nhất xuyên cơ sở: hai cơ sở có thể dùng chung một (pháp nhân, ký hiệu) = một dãy số.
-- ⚠️ CHECK ngày chỉ có ở SQL (Prisma không biểu diễn). Chồng ngày giữa các dòng BẬT của cùng cơ sở do tầng ứng
--    dụng chặn dưới khoá tư vấn theo cơ sở.

CREATE TABLE IF NOT EXISTS "CauHinhHoaDonCoSo" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "phapNhanMa" TEXT NOT NULL,
    "kyHieu" TEXT NOT NULL,
    "hieuLucTu" DATE NOT NULL,
    "hieuLucDen" DATE NOT NULL,
    "dangBat" BOOLEAN NOT NULL DEFAULT true,
    "ghiChu" TEXT,
    "taoBoiId" TEXT NOT NULL,
    "capNhatBoiId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "CauHinhHoaDonCoSo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CauHinhHoaDonCoSo_khoang_ngay_check" CHECK ("hieuLucDen" >= "hieuLucTu")
);

CREATE INDEX IF NOT EXISTS "CauHinhHoaDonCoSo_centerId_hieuLucTu_idx" ON "CauHinhHoaDonCoSo"("centerId", "hieuLucTu");
CREATE INDEX IF NOT EXISTS "CauHinhHoaDonCoSo_orgUnitId_idx" ON "CauHinhHoaDonCoSo"("orgUnitId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CauHinhHoaDonCoSo_centerId_fkey') THEN
        ALTER TABLE "CauHinhHoaDonCoSo" ADD CONSTRAINT "CauHinhHoaDonCoSo_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Bảng MỚI tự bật RLS (chỉ ENABLE, không FORCE, không policy) — khuôn 20260825120000_lead_status_history.
ALTER TABLE "CauHinhHoaDonCoSo" ENABLE ROW LEVEL SECURITY;
