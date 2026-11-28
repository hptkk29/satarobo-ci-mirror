-- 20261203090000_mobile_session — nền xác thực của API di động (B1.1) + bộ đếm lượt thử dùng chung (phương án C).
-- Thiết kế: docs/mobile/11_BACKEND_MOBILE_API_DESIGN.md mục 3 và 9.
-- CHỈ THÊM hai bảng mới. Chạy lại được (IF NOT EXISTS). Không sửa bảng nào đang có dữ liệu. Không backfill.
-- Không có centerId/orgUnitId: phiên gắn với MỘT NGƯỜI DÙNG, không mang dữ liệu theo cơ sở (cùng lập luận với HoaDonMayKy).
-- Không khoá ngoại tới "User" (nếp của HoaDonMayKy, SitePolicyAcceptance, OtpRequest, WebPushSubscription).

CREATE TABLE IF NOT EXISTS "MobileSession" (
    "id"                 TEXT           NOT NULL,
    "userId"             TEXT           NOT NULL,
    "maTra"              TEXT           NOT NULL,
    "maThietBi"          TEXT           NOT NULL,
    "nenTang"            TEXT           NOT NULL,
    "tenMay"             TEXT,
    "phienBanApp"        TEXT,
    "accessHash"         TEXT,
    "accessHetHan"       TIMESTAMPTZ(6),
    "refreshHash"        TEXT,
    "refreshHashTruoc"   TEXT,
    "xoayLuc"            TIMESTAMPTZ(6),
    "xacNhanLuc"         TIMESTAMPTZ(6),
    "hetHanKhongDung"    TIMESTAMPTZ(6) NOT NULL,
    "hetHanTuyetDoi"     TIMESTAMPTZ(6) NOT NULL,
    "tokenVersionLucCap" INTEGER        NOT NULL,
    "thuHoiLuc"          TIMESTAMPTZ(6),
    "lyDoThuHoi"         TEXT,
    "lanDungCuoi"        TIMESTAMPTZ(6),
    "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MobileSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MobileSession_ma_tra_check" CHECK ("maTra" ~ '^[A-Za-z0-9_-]{22}$'),
    CONSTRAINT "MobileSession_ma_thiet_bi_check"
        CHECK ("maThietBi" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    CONSTRAINT "MobileSession_nen_tang_check" CHECK ("nenTang" IN ('ios', 'android')),
    CONSTRAINT "MobileSession_ten_may_check" CHECK ("tenMay" IS NULL OR char_length("tenMay") <= 100),
    CONSTRAINT "MobileSession_phien_ban_check" CHECK ("phienBanApp" IS NULL OR char_length("phienBanApp") <= 32),
    CONSTRAINT "MobileSession_access_hash_check"
        CHECK ("accessHash" IS NULL OR "accessHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "MobileSession_refresh_hash_check"
        CHECK ("refreshHash" IS NULL OR "refreshHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "MobileSession_refresh_truoc_check"
        CHECK ("refreshHashTruoc" IS NULL OR "refreshHashTruoc" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "MobileSession_access_han_check"
        CHECK (("accessHash" IS NULL) = ("accessHetHan" IS NULL)),
    -- Phiên còn sống luôn có đủ băm access và băm refresh hiện hành.
    CONSTRAINT "MobileSession_song_check"
        CHECK ("thuHoiLuc" IS NOT NULL OR ("accessHash" IS NOT NULL AND "refreshHash" IS NOT NULL)),
    -- Phiên đã thu hồi không còn băm nào. Mã tra được GIỮ: token cũ vẫn tra ra phiên và nhận TOKEN_REVOKED.
    CONSTRAINT "MobileSession_thu_hoi_check"
        CHECK ("thuHoiLuc" IS NULL
               OR ("accessHash" IS NULL AND "refreshHash" IS NULL AND "refreshHashTruoc" IS NULL)),
    CONSTRAINT "MobileSession_ly_do_check" CHECK (("thuHoiLuc" IS NULL) = ("lyDoThuHoi" IS NULL)),
    CONSTRAINT "MobileSession_ly_do_gia_tri_check"
        CHECK ("lyDoThuHoi" IS NULL OR "lyDoThuHoi" IN
               ('dang-xuat', 'dang-nhap-lai', 'vuot-so-thiet-bi', 'dung-lai-token', 'tai-khoan', 'het-han',
                'nguoi-dung-thu-hoi', 'quan-tri')),
    CONSTRAINT "MobileSession_han_check" CHECK ("hetHanKhongDung" <= "hetHanTuyetDoi")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MobileSession_maTra_key" ON "MobileSession"("maTra");
-- MỘT phiên sống cho mỗi (người dùng, thiết bị). Chỉ mục TỪNG PHẦN: Prisma không khai được trong schema.prisma.
-- Hệ quả đã biết, cùng loại với "PaymentBill_orderId_open_key": `prisma migrate diff` có thể liệt kê nó như "thừa".
CREATE UNIQUE INDEX IF NOT EXISTS "MobileSession_userId_maThietBi_song_key"
    ON "MobileSession"("userId", "maThietBi") WHERE "thuHoiLuc" IS NULL;
CREATE INDEX IF NOT EXISTS "MobileSession_userId_idx" ON "MobileSession"("userId");

ALTER TABLE "MobileSession" ENABLE ROW LEVEL SECURITY;

-- Bộ đếm lượt thử đăng nhập / làm mới, dùng chung cho web và mobile (phương án C, mục 3.8).
-- `khoa` là SHA-256 của "<ngăn>:<giá trị đã chuẩn hoá>": bảng không chứa số điện thoại, email hay địa chỉ IP rõ.
CREATE TABLE IF NOT EXISTS "AuthAttemptCounter" (
    "khoa"      TEXT           NOT NULL,
    "cuaSoTu"   TIMESTAMPTZ(6) NOT NULL,
    "soLan"     INTEGER        NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AuthAttemptCounter_pkey" PRIMARY KEY ("khoa"),
    CONSTRAINT "AuthAttemptCounter_khoa_check" CHECK ("khoa" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "AuthAttemptCounter_so_lan_check" CHECK ("soLan" >= 1)
);
CREATE INDEX IF NOT EXISTS "AuthAttemptCounter_cuaSoTu_idx" ON "AuthAttemptCounter"("cuaSoTu");
ALTER TABLE "AuthAttemptCounter" ENABLE ROW LEVEL SECURITY;
