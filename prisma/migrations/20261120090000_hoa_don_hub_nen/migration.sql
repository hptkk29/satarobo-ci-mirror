-- SATAROBO INVOICE HUB — NỀN DỮ LIỆU (đợt 2, lát S4 · 01/11/2026).
-- docs/ke-toan-hoa-don/hub/04-KIEN-TRUC-VA-ADR.md §2 (ERD-01…06, ERD-07, ERD-09) + §6.1/§6.3 (HoaDonChinhSach) · hợp đồng 08-HOP-DONG-DOT-2.md.
--
-- ⚠️ CHỈ THÊM (luật cứng #4): 6 enum + 7 bảng MỚI + cột NULLABLE trên hai bảng cũ (CauHinhHoaDonCoSo, HoaDonDienTu). KHÔNG đổi kiểu,
--    KHÔNG bỏ cột, KHÔNG NOT NULL trên cột cũ, KHÔNG backfill, KHÔNG seed, KHÔNG thêm giá trị vào HoaDonTrangThai / HoaDonNguonPhatHanh
--    (ADR-014). Bảng mới RỖNG và nằm im cho tới khi lát S7/S8 nối vào sau cờ TẮT (TD-11) ⇒ hành vi hiện tại không đổi một chữ.
--    Rollback = ngừng ghi; bảng/cột nằm im.
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): mọi câu có IF NOT EXISTS / kiểm pg_type, pg_constraint — một lượt bị ngắt giữa chừng không để lại dòng
--    FAILED chặn mọi `migrate deploy` sau đó (P3009).
-- ⚠️ DDL bảng/cột/chỉ mục thường sinh bằng `prisma migrate diff --from-url` trên một DB NHÁP đã `migrate deploy` (CLAUDE.md mục 6, không reset
--    DB nào), rồi chép ĐÚNG phần HoaDon* / cột mới; drift 14 bảng có sẵn cố ý KHÔNG chép.
-- ⚠️ Prisma KHÔNG biểu diễn được: chỉ mục TỪNG PHẦN (4) và CHECK — chỉ có ở SQL này, ghi chú tương ứng ở `schema.prisma`:
--      HoaDonLenhKy_hoaDonId_song_key            UNIQUE(hoaDonId) WHERE trangThai IN ('CHO_KY','DANG_KY')   — một lệnh ký SỐNG mỗi hoá đơn
--      HoaDonNgoaiLe_dedupeKey_mo_key            UNIQUE(dedupeKey) WHERE trangThai IN ('MO','DANG_XU_LY')    — scanner chạy lại không đẻ trùng
--      HoaDonYeuCauNguoiMua_orderId_mo_key       UNIQUE(orderId) WHERE trangThai = 'DANG_MO'                 — mỗi đơn tối đa MỘT yêu cầu mở
--      HoaDonChinhSach_phapNhanMa_phienBan_chung_key  UNIQUE(phapNhanMa, phienBan) WHERE centerId IS NULL     — Postgres coi NULL là khác nhau
--    CHECK của bảng mới VALID ngay (khác ba CHECK NOT VALID của HoaDonDienTu). Hành vi của chúng đo thật ở
--    tests/finance/hoa-don-hub-nen-db.test.ts — lưới thuần chỉ bảo đảm câu SQL không biến mất.
-- ⚠️ Cố ý KHÔNG có cột CCCD / giấy tờ tuỳ thân ở HoaDonYeuCauNguoiMua (TM-14), và KHÔNG default 7 ngày cho hetHanLuc (TTL ở cấu hình, OD-11).
-- ⚠️ KHÔNG làm HoaDonViec (ERD-08, OD-13 còn mở).

-- ─── Enum ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HoaDonNghiaVuNguon') THEN
        CREATE TYPE "HoaDonNghiaVuNguon" AS ENUM ('PAYMENT', 'BILLING');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HoaDonNghiaVuLoai') THEN
        CREATE TYPE "HoaDonNghiaVuLoai" AS ENUM ('THU_TIEN', 'THU_HOC_CU', 'THU_LE_PHI_THI', 'THU_PHI_HOC_BU', 'THU_TRUOC', 'DIEU_CHINH_GIAM', 'CHUA_PHAN_LOAI');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HoaDonNghiaVuTrangThai') THEN
        CREATE TYPE "HoaDonNghiaVuTrangThai" AS ENUM ('CHO_XUAT', 'CHO_QUYET', 'DANG_XU_LY', 'DA_XUAT', 'KHONG_XUAT', 'MAT_NGUON');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HoaDonVatTreatment') THEN
        CREATE TYPE "HoaDonVatTreatment" AS ENUM ('RATE_0', 'RATE_5', 'RATE_8', 'RATE_10', 'KCT', 'KKKNT');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HoaDonKieuGia') THEN
        CREATE TYPE "HoaDonKieuGia" AS ENUM ('DA_GOM_THUE', 'CHUA_GOM_THUE');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HoaDonChinhSachTrangThai') THEN
        CREATE TYPE "HoaDonChinhSachTrangThai" AS ENUM ('NHAP', 'CHO_DUYET', 'HIEU_LUC', 'HET_HIEU_LUC', 'TU_CHOI');
    END IF;
END $$;

-- ─── ERD-07 — cột NULLABLE mới trên CauHinhHoaDonCoSo (không backfill, không NOT NULL) ────────────────────────────────
ALTER TABLE "CauHinhHoaDonCoSo"
    ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT,
    ADD COLUMN IF NOT EXISTS "nhaCungCapMa" TEXT,
    ADD COLUMN IF NOT EXISTS "moiTruongNcc" TEXT,
    ADD COLUMN IF NOT EXISTS "loaiHoaDon" TEXT,
    ADD COLUMN IF NOT EXISTS "phuongThucKy" TEXT,
    ADD COLUMN IF NOT EXISTS "khoaBiMat" TEXT,
    ADD COLUMN IF NOT EXISTS "chungThuHetHan" DATE,
    ADD COLUMN IF NOT EXISTS "cheDoHub" TEXT;

-- ─── ERD-09 — cột NULLABLE mới trên HoaDonDienTu (không backfill, không NOT NULL) ─────────────────────────────────────
ALTER TABLE "HoaDonDienTu"
    ADD COLUMN IF NOT EXISTS "legalEntityId" TEXT,
    ADD COLUMN IF NOT EXISTS "nhaCungCapMa" TEXT,
    ADD COLUMN IF NOT EXISTS "nhaCungCapMoiTruong" TEXT,
    ADD COLUMN IF NOT EXISTS "khoaChongTrung" TEXT,
    ADD COLUMN IF NOT EXISTS "chinhSachPhienBan" TEXT,
    ADD COLUMN IF NOT EXISTS "kichHoatBoi" TEXT,
    ADD COLUMN IF NOT EXISTS "thamChieuLoai" TEXT,
    ADD COLUMN IF NOT EXISTS "hoaDonGocId" TEXT;

-- ─── ERD-01 — HoaDonNghiaVu (bảng CHIẾU nghĩa vụ hoá đơn; KHÔNG là sổ tiền thứ ba) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "HoaDonNghiaVu" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "legalEntityId" TEXT,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "nguonLoai" "HoaDonNghiaVuNguon" NOT NULL,
    "nguonId" TEXT NOT NULL,
    "loai" "HoaDonNghiaVuLoai" NOT NULL,
    "phanLoaiPhapLy" TEXT,
    "trangThai" "HoaDonNghiaVuTrangThai" NOT NULL,
    "lyDoCho" TEXT,
    "ngayPhatSinh" DATE NOT NULL,
    "hanLapDuKien" DATE,
    "nghiaVuGocId" TEXT,
    "hoaDonId" TEXT,
    "chinhSachPhienBan" TEXT,
    "thueSnapshot" JSONB,
    "soTienSnapshot" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "phienBan" INTEGER NOT NULL DEFAULT 1,
    "quetLanCuoiLuc" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HoaDonNghiaVu_pkey" PRIMARY KEY ("id"),
    -- CHO_QUYET ⇒ BẮT BUỘC có lý do (không NULL, không chuỗi trắng — CHECK coi NULL là QUA nên phải chặn NULL tường minh).
    CONSTRAINT "HoaDonNghiaVu_cho_quyet_ly_do_check" CHECK (
        "trangThai" <> 'CHO_QUYET' OR ("lyDoCho" IS NOT NULL AND btrim("lyDoCho") <> '')
    )
);

-- ─── ERD-02 — HoaDonDong (dòng hoá đơn + snapshot thuế; mang cả hai cột, sao từ hoá đơn cha lúc ghi) ────────────────
CREATE TABLE IF NOT EXISTS "HoaDonDong" (
    "id" TEXT NOT NULL,
    "hoaDonId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "stt" INTEGER NOT NULL,
    "orderItemId" TEXT,
    "ten" TEXT NOT NULL,
    "donViTinh" TEXT NOT NULL,
    "soLuong" DECIMAL(18,4) NOT NULL,
    "donGia" DECIMAL(20,6) NOT NULL,
    "chietKhau" INTEGER NOT NULL DEFAULT 0,
    "thanhTien" INTEGER NOT NULL,
    "thueSuat" DECIMAL(5,2),
    "vatTreatment" "HoaDonVatTreatment" NOT NULL,
    "kieuGia" "HoaDonKieuGia" NOT NULL,
    "tienThue" INTEGER NOT NULL,
    "congTien" INTEGER NOT NULL,
    "thueSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoaDonDong_pkey" PRIMARY KEY ("id")
);

-- ─── ERD-03 — HoaDonGiaoDichNhaCungCap (nhật ký từng lượt gọi nhà cung cấp, APPEND-ONLY) ─────────────────────────────
CREATE TABLE IF NOT EXISTS "HoaDonGiaoDichNhaCungCap" (
    "id" TEXT NOT NULL,
    "hoaDonId" TEXT,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "phapNhanMst" TEXT,
    "nhaCungCapMa" TEXT NOT NULL,
    "moiTruong" TEXT NOT NULL,
    "loaiLuot" TEXT NOT NULL,
    "luotThu" INTEGER NOT NULL,
    "khoaChongTrung" TEXT,
    "requestHash" TEXT,
    "ketQua" TEXT NOT NULL,
    "maHttp" INTEGER,
    "maNhaCungCap" TEXT,
    "thongDiepDaChe" TEXT,
    "doTreMs" INTEGER,
    "batDauLuc" TIMESTAMPTZ(6) NOT NULL,
    "ketThucLuc" TIMESTAMPTZ(6),
    "nguoiGoiId" TEXT,

    CONSTRAINT "HoaDonGiaoDichNhaCungCap_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HoaDonGiaoDichNhaCungCap_ket_qua_check" CHECK (
        "ketQua" IN ('DA_PHAT_HANH', 'TU_CHOI', 'KHONG_RO', 'CHUA_CO', 'LOI_KY_THUAT')
    ),
    -- ≤ 300 ký tự và đã qua bộ che (không PII/secret) — giới hạn độ dài là phần DB gác được.
    CONSTRAINT "HoaDonGiaoDichNhaCungCap_thong_diep_check" CHECK (
        "thongDiepDaChe" IS NULL OR char_length("thongDiepDaChe") <= 300
    )
);

-- ─── ERD-04 — HoaDonLenhKy (lệnh ký) ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "HoaDonLenhKy" (
    "id" TEXT NOT NULL,
    "hoaDonId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "phuongThuc" TEXT NOT NULL,
    "trangThai" TEXT NOT NULL DEFAULT 'CHO_KY',
    "nguoiYeuCauId" TEXT NOT NULL,
    "nguoiKyId" TEXT,
    "duLieuCanKyHash" TEXT NOT NULL,
    "maGiaoDich" TEXT,
    "chungThuHetHan" DATE,
    "hetHanLuc" TIMESTAMPTZ(6),
    "lyDo" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HoaDonLenhKy_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HoaDonLenhKy_trang_thai_check" CHECK (
        "trangThai" IN ('CHO_KY', 'DANG_KY', 'DA_KY', 'LOI_KY', 'HET_HAN', 'HUY')
    )
);

-- ─── ERD-05 — HoaDonNgoaiLe (hộp thư ngoại lệ; nghiaVuId/hoaDonId/orderId là THAM CHIẾU MỀM, không FK) ───────────────
CREATE TABLE IF NOT EXISTS "HoaDonNgoaiLe" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "loai" TEXT NOT NULL,
    "muc" TEXT NOT NULL,
    "nghiaVuId" TEXT,
    "hoaDonId" TEXT,
    "orderId" TEXT,
    "trangThai" TEXT NOT NULL DEFAULT 'MO',
    "hanXuLy" TIMESTAMPTZ(6),
    "nguoiXuLyId" TEXT,
    "lyDoXuLy" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HoaDonNgoaiLe_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HoaDonNgoaiLe_trang_thai_check" CHECK (
        "trangThai" IN ('MO', 'DANG_XU_LY', 'DA_XU_LY', 'BO_QUA_CO_LY_DO')
    ),
    -- Bỏ qua ngoại lệ ⇒ lý do ≥ 10 ký tự (ADR §2.6). Chặn cả NULL lẫn chuỗi ngắn/trắng.
    CONSTRAINT "HoaDonNgoaiLe_ly_do_xu_ly_check" CHECK (
        "trangThai" <> 'BO_QUA_CO_LY_DO' OR ("lyDoXuLy" IS NOT NULL AND char_length(btrim("lyDoXuLy")) >= 10)
    )
);

-- ─── ERD-06 — HoaDonYeuCauNguoiMua (QR thu thập thông tin người mua) ─────────────────────────────────────────────────
-- KHÔNG có cột CCCD / giấy tờ tuỳ thân. `hetHanLuc` do ỨNG DỤNG tính từ cấu hình (không default trong DB).
CREATE TABLE IF NOT EXISTS "HoaDonYeuCauNguoiMua" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "orderId" TEXT NOT NULL,
    "phamVi" TEXT NOT NULL DEFAULT 'DON',
    "tokenHash" TEXT NOT NULL,
    "trangThai" TEXT NOT NULL DEFAULT 'DANG_MO',
    "hetHanLuc" TIMESTAMPTZ(6) NOT NULL,
    "thayBoiId" TEXT,
    "phienBan" INTEGER NOT NULL DEFAULT 1,
    "soLanMo" INTEGER NOT NULL DEFAULT 0,
    "soLanSai" INTEGER NOT NULL DEFAULT 0,
    "khoaDen" TIMESTAMPTZ(6),
    "giaTriGocHash" JSONB NOT NULL,
    "duLieuGui" JSONB,
    "donY" JSONB,
    "taoBoiId" TEXT NOT NULL,
    "guiLuc" TIMESTAMPTZ(6),
    "ipGui" TEXT,
    "uaGui" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HoaDonYeuCauNguoiMua_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HoaDonYeuCauNguoiMua_trang_thai_check" CHECK (
        "trangThai" IN ('DANG_MO', 'DA_GUI', 'DA_AP_DUNG', 'TU_CHOI', 'HET_HAN', 'THU_HOI')
    ),
    -- Bộ đếm khoá cứng ở DB (rate-limit Upstash là fail-open) — không âm.
    CONSTRAINT "HoaDonYeuCauNguoiMua_so_lan_check" CHECK ("soLanMo" >= 0 AND "soLanSai" >= 0)
);

-- ─── §6.1/§6.3 — HoaDonChinhSach (chính sách có phiên bản; centerId NULL = dùng chung toàn pháp nhân) ─────────────────
CREATE TABLE IF NOT EXISTS "HoaDonChinhSach" (
    "id" TEXT NOT NULL,
    "phapNhanMa" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "centerId" TEXT,
    "orgUnitId" TEXT,
    "phienBan" INTEGER NOT NULL,
    "trangThai" "HoaDonChinhSachTrangThai" NOT NULL DEFAULT 'NHAP',
    "hieuLucTu" DATE NOT NULL,
    "hieuLucDen" DATE,
    "noiDung" JSONB NOT NULL,
    "nguoiTaoId" TEXT NOT NULL,
    "nguoiDuyetId" TEXT,
    "lyDo" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HoaDonChinhSach_pkey" PRIMARY KEY ("id"),
    -- MAKER ≠ CHECKER ở tầng DB: một phiên bản chỉ HIEU_LUC khi có người duyệt KHÁC người tạo. Chặn cả đường UPDATE (duyệt là một lượt UPDATE).
    CONSTRAINT "HoaDonChinhSach_maker_checker_check" CHECK (
        "trangThai" <> 'HIEU_LUC' OR ("nguoiDuyetId" IS NOT NULL AND "nguoiDuyetId" <> "nguoiTaoId")
    ),
    CONSTRAINT "HoaDonChinhSach_phien_ban_check" CHECK ("phienBan" >= 1),
    -- hieuLucDen NULL = không giới hạn (engine/chinh-sach.ts cho phép null hai đầu); có thì khoảng ĐÓNG [từ, đến] không ngược.
    CONSTRAINT "HoaDonChinhSach_khoang_ngay_check" CHECK ("hieuLucDen" IS NULL OR "hieuLucDen" >= "hieuLucTu")
);

-- ─── Chỉ mục thường (đúng tên quy ước Prisma) ───────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "HoaDonNghiaVu_centerId_trangThai_idx" ON "HoaDonNghiaVu"("centerId", "trangThai");
CREATE INDEX IF NOT EXISTS "HoaDonNghiaVu_orderId_idx" ON "HoaDonNghiaVu"("orderId");
CREATE INDEX IF NOT EXISTS "HoaDonNghiaVu_hoaDonId_idx" ON "HoaDonNghiaVu"("hoaDonId");
CREATE INDEX IF NOT EXISTS "HoaDonNghiaVu_trangThai_hanLapDuKien_idx" ON "HoaDonNghiaVu"("trangThai", "hanLapDuKien");
CREATE INDEX IF NOT EXISTS "HoaDonNghiaVu_orgUnitId_idx" ON "HoaDonNghiaVu"("orgUnitId");
CREATE INDEX IF NOT EXISTS "HoaDonNghiaVu_legalEntityId_trangThai_idx" ON "HoaDonNghiaVu"("legalEntityId", "trangThai");
-- UNIQUE(nguonLoai, nguonId): chống đẻ đôi nghĩa vụ cho cùng một khoản (FEN-07).
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonNghiaVu_nguonLoai_nguonId_key" ON "HoaDonNghiaVu"("nguonLoai", "nguonId");

CREATE INDEX IF NOT EXISTS "HoaDonDong_centerId_idx" ON "HoaDonDong"("centerId");
CREATE INDEX IF NOT EXISTS "HoaDonDong_orgUnitId_idx" ON "HoaDonDong"("orgUnitId");
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonDong_hoaDonId_stt_key" ON "HoaDonDong"("hoaDonId", "stt");

CREATE INDEX IF NOT EXISTS "HoaDonGiaoDichNhaCungCap_khoaChongTrung_idx" ON "HoaDonGiaoDichNhaCungCap"("khoaChongTrung");
CREATE INDEX IF NOT EXISTS "HoaDonGiaoDichNhaCungCap_nhaCungCapMa_ketQua_batDauLuc_idx" ON "HoaDonGiaoDichNhaCungCap"("nhaCungCapMa", "ketQua", "batDauLuc");
CREATE INDEX IF NOT EXISTS "HoaDonGiaoDichNhaCungCap_centerId_idx" ON "HoaDonGiaoDichNhaCungCap"("centerId");
CREATE INDEX IF NOT EXISTS "HoaDonGiaoDichNhaCungCap_orgUnitId_idx" ON "HoaDonGiaoDichNhaCungCap"("orgUnitId");
-- UNIQUE(hoaDonId, loaiLuot, luotThu): hai lượt cron chồng nhau va ở đây (FEN-08). hoaDonId NULL thì không ràng (NULL khác nhau) — chủ ý.
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonGiaoDichNhaCungCap_hoaDonId_loaiLuot_luotThu_key" ON "HoaDonGiaoDichNhaCungCap"("hoaDonId", "loaiLuot", "luotThu");

CREATE INDEX IF NOT EXISTS "HoaDonLenhKy_hoaDonId_idx" ON "HoaDonLenhKy"("hoaDonId");
CREATE INDEX IF NOT EXISTS "HoaDonLenhKy_centerId_trangThai_idx" ON "HoaDonLenhKy"("centerId", "trangThai");
CREATE INDEX IF NOT EXISTS "HoaDonLenhKy_orgUnitId_idx" ON "HoaDonLenhKy"("orgUnitId");

CREATE INDEX IF NOT EXISTS "HoaDonNgoaiLe_centerId_trangThai_idx" ON "HoaDonNgoaiLe"("centerId", "trangThai");
CREATE INDEX IF NOT EXISTS "HoaDonNgoaiLe_orgUnitId_idx" ON "HoaDonNgoaiLe"("orgUnitId");
CREATE INDEX IF NOT EXISTS "HoaDonNgoaiLe_nghiaVuId_idx" ON "HoaDonNgoaiLe"("nghiaVuId");
CREATE INDEX IF NOT EXISTS "HoaDonNgoaiLe_orderId_idx" ON "HoaDonNgoaiLe"("orderId");

CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonYeuCauNguoiMua_tokenHash_key" ON "HoaDonYeuCauNguoiMua"("tokenHash");
CREATE INDEX IF NOT EXISTS "HoaDonYeuCauNguoiMua_centerId_trangThai_idx" ON "HoaDonYeuCauNguoiMua"("centerId", "trangThai");
CREATE INDEX IF NOT EXISTS "HoaDonYeuCauNguoiMua_orgUnitId_idx" ON "HoaDonYeuCauNguoiMua"("orgUnitId");
CREATE INDEX IF NOT EXISTS "HoaDonYeuCauNguoiMua_orderId_idx" ON "HoaDonYeuCauNguoiMua"("orderId");
CREATE INDEX IF NOT EXISTS "HoaDonYeuCauNguoiMua_trangThai_hetHanLuc_idx" ON "HoaDonYeuCauNguoiMua"("trangThai", "hetHanLuc");

CREATE INDEX IF NOT EXISTS "HoaDonChinhSach_phapNhanMa_trangThai_idx" ON "HoaDonChinhSach"("phapNhanMa", "trangThai");
CREATE INDEX IF NOT EXISTS "HoaDonChinhSach_centerId_idx" ON "HoaDonChinhSach"("centerId");
CREATE INDEX IF NOT EXISTS "HoaDonChinhSach_orgUnitId_idx" ON "HoaDonChinhSach"("orgUnitId");
CREATE INDEX IF NOT EXISTS "HoaDonChinhSach_legalEntityId_idx" ON "HoaDonChinhSach"("legalEntityId");
-- Phần Prisma biểu diễn được. Với centerId NULL nó KHÔNG chặn gì (NULL khác nhau) ⇒ chỉ mục từng phần ở cuối file lo nhánh "dùng chung".
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonChinhSach_phapNhanMa_centerId_phienBan_key" ON "HoaDonChinhSach"("phapNhanMa", "centerId", "phienBan");

CREATE INDEX IF NOT EXISTS "CauHinhHoaDonCoSo_legalEntityId_idx" ON "CauHinhHoaDonCoSo"("legalEntityId");

-- khoaChongTrung UNIQUE: nhiều dòng NULL là hợp lệ (Postgres coi NULL là khác nhau) — các hoá đơn cũ không bị đụng.
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonDienTu_khoaChongTrung_key" ON "HoaDonDienTu"("khoaChongTrung");
CREATE INDEX IF NOT EXISTS "HoaDonDienTu_legalEntityId_idx" ON "HoaDonDienTu"("legalEntityId");
CREATE INDEX IF NOT EXISTS "HoaDonDienTu_hoaDonGocId_idx" ON "HoaDonDienTu"("hoaDonGocId");

-- ─── Khoá ngoại (Restrict/SetNull/Cascade đúng ERD; tự tham chiếu = NO ACTION như thayTheChoId) ─────────────────────
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonDienTu_legalEntityId_fkey') THEN
        ALTER TABLE "HoaDonDienTu" ADD CONSTRAINT "HoaDonDienTu_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonDienTu_hoaDonGocId_fkey') THEN
        ALTER TABLE "HoaDonDienTu" ADD CONSTRAINT "HoaDonDienTu_hoaDonGocId_fkey" FOREIGN KEY ("hoaDonGocId") REFERENCES "HoaDonDienTu"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CauHinhHoaDonCoSo_legalEntityId_fkey') THEN
        ALTER TABLE "CauHinhHoaDonCoSo" ADD CONSTRAINT "CauHinhHoaDonCoSo_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonNghiaVu_legalEntityId_fkey') THEN
        ALTER TABLE "HoaDonNghiaVu" ADD CONSTRAINT "HoaDonNghiaVu_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonNghiaVu_orderId_fkey') THEN
        ALTER TABLE "HoaDonNghiaVu" ADD CONSTRAINT "HoaDonNghiaVu_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonNghiaVu_orderItemId_fkey') THEN
        ALTER TABLE "HoaDonNghiaVu" ADD CONSTRAINT "HoaDonNghiaVu_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonNghiaVu_nghiaVuGocId_fkey') THEN
        ALTER TABLE "HoaDonNghiaVu" ADD CONSTRAINT "HoaDonNghiaVu_nghiaVuGocId_fkey" FOREIGN KEY ("nghiaVuGocId") REFERENCES "HoaDonNghiaVu"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonNghiaVu_hoaDonId_fkey') THEN
        ALTER TABLE "HoaDonNghiaVu" ADD CONSTRAINT "HoaDonNghiaVu_hoaDonId_fkey" FOREIGN KEY ("hoaDonId") REFERENCES "HoaDonDienTu"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonDong_hoaDonId_fkey') THEN
        ALTER TABLE "HoaDonDong" ADD CONSTRAINT "HoaDonDong_hoaDonId_fkey" FOREIGN KEY ("hoaDonId") REFERENCES "HoaDonDienTu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonGiaoDichNhaCungCap_hoaDonId_fkey') THEN
        ALTER TABLE "HoaDonGiaoDichNhaCungCap" ADD CONSTRAINT "HoaDonGiaoDichNhaCungCap_hoaDonId_fkey" FOREIGN KEY ("hoaDonId") REFERENCES "HoaDonDienTu"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonLenhKy_hoaDonId_fkey') THEN
        ALTER TABLE "HoaDonLenhKy" ADD CONSTRAINT "HoaDonLenhKy_hoaDonId_fkey" FOREIGN KEY ("hoaDonId") REFERENCES "HoaDonDienTu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonYeuCauNguoiMua_orderId_fkey') THEN
        ALTER TABLE "HoaDonYeuCauNguoiMua" ADD CONSTRAINT "HoaDonYeuCauNguoiMua_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HoaDonChinhSach_legalEntityId_fkey') THEN
        ALTER TABLE "HoaDonChinhSach" ADD CONSTRAINT "HoaDonChinhSach_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- ─── Chỉ mục TỪNG PHẦN — Prisma không biểu diễn được `WHERE`, nên chỉ có ở đây ──────────────────────────────────────
-- (1) MỘT lệnh ký SỐNG mỗi hoá đơn. Ký xong/lỗi/hết hạn/huỷ thì nhả chỗ — tạo lệnh mới được.
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonLenhKy_hoaDonId_song_key" ON "HoaDonLenhKy" ("hoaDonId") WHERE "trangThai" IN ('CHO_KY', 'DANG_KY');

-- (2) Một ngoại lệ ĐANG MỞ cho mỗi khoá nguồn — scanner chạy lại (hoặc hai lượt cron chồng nhau) không đẻ trùng. Đóng rồi tạo lại được.
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonNgoaiLe_dedupeKey_mo_key" ON "HoaDonNgoaiLe" ("dedupeKey") WHERE "trangThai" IN ('MO', 'DANG_XU_LY');

-- (3) Mỗi đơn tối đa MỘT yêu cầu thu thập thông tin người mua đang mở (mượn mẫu PaymentBill_orderId_open_key). Cấp lại ⇒ cái cũ THU_HOI trước.
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonYeuCauNguoiMua_orderId_mo_key" ON "HoaDonYeuCauNguoiMua" ("orderId") WHERE "trangThai" = 'DANG_MO';

-- (4) Hai chính sách DÙNG CHUNG (centerId NULL) của cùng pháp nhân không được cùng số phiên bản. UNIQUE(phapNhanMa, centerId, phienBan) ở trên
--     KHÔNG chặn được ca này vì Postgres coi NULL là khác nhau.
CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonChinhSach_phapNhanMa_phienBan_chung_key" ON "HoaDonChinhSach" ("phapNhanMa", "phienBan") WHERE "centerId" IS NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Bảng MỚI ra đời với RLS TẮT (sự cố 09/08: 31 bảng sinh sau nằm trần cho anon/authenticated). Chỉ ENABLE, không FORCE, không policy
-- (khuôn 20260825120000_lead_status_history). Chạy lại vô hại.
ALTER TABLE "HoaDonNghiaVu" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HoaDonDong" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HoaDonGiaoDichNhaCungCap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HoaDonLenhKy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HoaDonNgoaiLe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HoaDonYeuCauNguoiMua" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HoaDonChinhSach" ENABLE ROW LEVEL SECURITY;
