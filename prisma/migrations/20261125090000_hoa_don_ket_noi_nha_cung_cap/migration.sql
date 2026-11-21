-- Hoá đơn điện tử — KẾT NỐI NHÀ CUNG CẤP do KẾ TOÁN TỰ CẤU HÌNH + ký USB token (docs/ke-toan-hoa-don/hub/13-KY-USB-VA-KET-NOI-NHA-CUNG-CAP.md).
--
-- 1) Bảng MỚI `HoaDonKetNoiNhaCungCap`: một dòng cho mỗi (pháp nhân × môi trường).
--    · KHÔNG có centerId/orgUnitId — CÓ CHỦ ĐÍCH: đây là dữ liệu cấp PHÁP NHÂN (tài khoản + chứng thư của một công ty), không phải dữ liệu cấp
--      cơ sở. Pháp nhân không phải OrgUnit, và gán nó vào một cơ sở sẽ hoặc làm dòng của Hội sở (Sata Robo / MISA) vô hình, hoặc đưa tài khoản
--      của pháp nhân này cho kế toán cơ sở khác. Truy cập do ỨNG DỤNG gác: CHỈ kế toán Hội sở (phạm vi `payments:confirm` = ALL) xem/sửa;
--      việc phát hành đọc bảng này ở máy chủ, không qua người dùng.
--    · `matKhauMaHoa` = chuỗi AES-256-GCM `v1.<mã khoá>.<iv>.<ciphertext>.<tag>` (lib/security/hop-bi-mat.ts), AAD = `ketnoi:<id>`.
--      Khoá gốc ở env `HOA_DON_KHOA_BI_MAT`. Cột này KHÔNG bao giờ được SELECT ra giao diện.
--    · Chứng thư USB chỉ lưu thông tin CÔNG KHAI (serial, dấu vân tay, MST chủ thể, nhà phát hành, hạn). Không khoá riêng, không PIN.
--
-- 2) HoaDonLenhKy: THÊM 3 cột nullable cho phiên ký USB của VIN (maphiengiaodich sống 30 phút + XML chưa ký để đối chiếu XML đã ký).
--    CHỈ THÊM, nullable, không backfill ⇒ lệnh ký cũ giữ nguyên.
--
-- Idempotent (IF NOT EXISTS) để chạy lại không lỗi. Bảng mới phải tự bật RLS (chỉ ENABLE, không FORCE, không policy).

CREATE TABLE IF NOT EXISTS "HoaDonKetNoiNhaCungCap" (
    "id"                 TEXT         NOT NULL,
    "phapNhanMa"         TEXT         NOT NULL,
    "moiTruong"          TEXT         NOT NULL,
    "nhaCungCapMa"       TEXT         NOT NULL,
    "dangBat"            BOOLEAN      NOT NULL DEFAULT false,
    "baseUrl"            TEXT,
    "mst"                TEXT,
    "tenDangNhap"        TEXT,
    "matKhauMaHoa"       TEXT,
    "matKhauCapNhatLuc"  TIMESTAMPTZ(6),
    "phuongThucKy"       TEXT         NOT NULL DEFAULT 'HSM_NHA_CUNG_CAP',
    "cheDoKy"            TEXT         NOT NULL DEFAULT 'LO',
    "chungThuSerial"     TEXT,
    "chungThuThumbprint" TEXT,
    "chungThuChuTheMst"  TEXT,
    "chungThuNhaPhatHanh" TEXT,
    "chungThuHetHan"     DATE,
    "kiemTraLuc"         TIMESTAMPTZ(6),
    "kiemTraKetQua"      TEXT,
    "capNhatBoiId"       TEXT         NOT NULL,
    "lyDoCapNhat"        TEXT,
    "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HoaDonKetNoiNhaCungCap_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HoaDonKetNoiNhaCungCap_moi_truong_check" CHECK ("moiTruong" IN ('SANDBOX', 'PROD')),
    CONSTRAINT "HoaDonKetNoiNhaCungCap_nha_cung_cap_check" CHECK ("nhaCungCapMa" IN ('VIN_HOADON', 'MISA_MEINVOICE')),
    CONSTRAINT "HoaDonKetNoiNhaCungCap_phuong_thuc_ky_check" CHECK ("phuongThucKy" IN ('HSM_NHA_CUNG_CAP', 'USB_TOKEN')),
    CONSTRAINT "HoaDonKetNoiNhaCungCap_che_do_ky_check" CHECK ("cheDoKy" IN ('TUNG_LENH', 'LO', 'NEN')),
    -- Mật khẩu (nếu có) PHẢI là chuỗi đã mã hoá đúng khuôn — không bao giờ lưu thô.
    CONSTRAINT "HoaDonKetNoiNhaCungCap_mat_khau_ma_hoa_check" CHECK ("matKhauMaHoa" IS NULL OR "matKhauMaHoa" ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);

-- Một cấu hình mỗi (pháp nhân, môi trường).
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonKetNoiNhaCungCap_phapNhanMa_moiTruong_key" ON "HoaDonKetNoiNhaCungCap"("phapNhanMa", "moiTruong");

ALTER TABLE "HoaDonKetNoiNhaCungCap" ENABLE ROW LEVEL SECURITY;

-- ── Phiên ký USB trên lệnh ký ────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "HoaDonLenhKy" ADD COLUMN IF NOT EXISTS "maPhienNcc"  TEXT;
ALTER TABLE "HoaDonLenhKy" ADD COLUMN IF NOT EXISTS "phienLayLuc" TIMESTAMPTZ(6);
ALTER TABLE "HoaDonLenhKy" ADD COLUMN IF NOT EXISTS "xmlChuaKy"   TEXT;
