-- DISC × SataRobo — SỔ GIA ĐÌNH (docs/disc-tich-hop/18-ngan-hang-va-so-gia-dinh.md mục 2–9).
--
-- HOÀN TOÀN ADDITIVE: 10 bảng MỚI, không đụng bảng nào đang có dữ liệu (DiscSubmission/DiscSubject giữ nguyên).
-- Không backfill. Rollback = tắt cờ DISC_ENABLED; bảng nằm im.
-- Chạy lại được (MIG-01): CREATE TABLE/INDEX có IF NOT EXISTS, ràng buộc bọc DO $$ … pg_constraint …
--
-- Bảng KHÔNG theo cơ sở (dữ liệu theo GIA ĐÌNH, không theo trung tâm) ⇒ không centerId/orgUnitId,
-- và cố ý KHÔNG nằm trong SCOPED_MODELS. Quyền đọc/ghi là QUYỀN SỞ HỮU: DiscGiaDinh.ownerUserId = userId từ PHIÊN.
-- ⚠️ Chứa dữ liệu cá nhân của TRẺ EM: bật RLS (chỉ ENABLE, không policy) ⇒ chỉ vai dịch vụ của ứng dụng đọc được.
-- Chỉ đọc/ghi qua lib/disc/so-gia-dinh/*; không qua scopedDb; không log; không đưa vào analytics.
--
-- Kiểu "enum" lưu TEXT + CHECK (thêm giá trị mới không cần ALTER TYPE).
-- DiscBaiLam KHÔNG lưu câu trả lời từng câu (cùng luật DiscSubject.result): chỉ điểm D/I/S/C + kiểu + cảnh báo
-- + băm danh sách mã câu. DiscBanNhap là ngoại lệ DUY NHẤT (bản nháp dở dang, xoá ngay khi nộp bài hoặc sau 14 ngày).

-- ─── Gia đình ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DiscGiaDinh" (
  "id"          TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "ten"         TEXT NOT NULL,
  -- scrypt(salt:hash) của mã PIN 4 số thoát chế độ trẻ em. NULL = chưa đặt.
  "pinHash"     TEXT,
  "pinSai"      INTEGER NOT NULL DEFAULT 0,
  "pinKhoaDen"  TIMESTAMPTZ(6),
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiscGiaDinh_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DiscGiaDinh_ownerUserId_key" ON "DiscGiaDinh"("ownerUserId");

-- ─── Thành viên ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DiscThanhVien" (
  "id"         TEXT NOT NULL,
  "giaDinhId"  TEXT NOT NULL,
  "ten"        TEXT NOT NULL,
  -- Chỉ số trong VAI_GIA_DINH (config/disc-gia-dinh.ts) — thứ tự cố định vĩnh viễn, vai mới THÊM VÀO CUỐI.
  "vaiTro"     INTEGER NOT NULL,
  "lop"        TEXT,
  "namSinh"    INTEGER,
  "thuTu"      INTEGER NOT NULL DEFAULT 0,
  "ghiChu"     TEXT,
  -- Nối với học viên SataRobo; CHỈ học viên của chính tài khoản (kiểm ở lib/disc/so-gia-dinh/ghi.ts).
  "studentId"  TEXT,
  -- Thành viên chính là CHỦ SỔ (tài khoản đăng nhập). Mỗi sổ đúng một dòng true; không xoá được.
  "laChuSo"    BOOLEAN NOT NULL DEFAULT false,
  "deletedAt"  TIMESTAMPTZ(6),
  "createdAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiscThanhVien_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DiscThanhVien_giaDinhId_idx" ON "DiscThanhVien"("giaDinhId");
CREATE INDEX IF NOT EXISTS "DiscThanhVien_studentId_idx" ON "DiscThanhVien"("studentId");

-- ─── Bài làm (mỗi lần làm là một dòng, KHÔNG ghi đè) ─────────────────────────
CREATE TABLE IF NOT EXISTS "DiscBaiLam" (
  "id"             TEXT NOT NULL,
  "giaDinhId"      TEXT NOT NULL,
  -- NULL = mục "chưa xếp" (thành viên đã bị xoá nhưng chủ sổ chọn giữ bài).
  "thanhVienId"    TEXT,
  -- Tên chụp lúc làm — đổi/xoá thành viên sau đó vẫn đọc được bài cũ.
  "tenLuc"         TEXT NOT NULL,
  "boDe"           TEXT NOT NULL,
  -- "1.1" (đề gốc 104 câu) | "nh:nh1" (ngân hàng). Hai bài chỉ so trực tiếp khi CÙNG phiên bản.
  "phienBanBoDe"   TEXT NOT NULL,
  "cachLam"        TEXT NOT NULL,
  "nguoiTraLoiId"  TEXT NOT NULL,
  "diem"           JSONB NOT NULL,
  "kieu"           JSONB NOT NULL,
  "canhBao"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Băm SHA-256 danh sách mã câu của đề — để chứng minh bài làm từ đề nào, KHÔNG phải câu trả lời.
  "maDe"           TEXT NOT NULL,
  "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscBaiLam_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DiscBaiLam_giaDinhId_createdAt_idx" ON "DiscBaiLam"("giaDinhId", "createdAt");
CREATE INDEX IF NOT EXISTS "DiscBaiLam_thanhVienId_createdAt_idx" ON "DiscBaiLam"("thanhVienId", "createdAt");

-- ─── Mã câu đã thấy (nguồn cho bốc đề không trùng) — KHÔNG phải câu trả lời ───
CREATE TABLE IF NOT EXISTS "DiscCauDaThay" (
  "thanhVienId" TEXT NOT NULL,
  "maCau"       TEXT NOT NULL,
  "lanDau"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscCauDaThay_pkey" PRIMARY KEY ("thanhVienId", "maCau")
);
CREATE INDEX IF NOT EXISTS "DiscCauDaThay_thanhVienId_lanDau_idx" ON "DiscCauDaThay"("thanhVienId", "lanDau");

-- ─── Bản nháp đang làm dở ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DiscBanNhap" (
  "id"          TEXT NOT NULL,
  "giaDinhId"   TEXT NOT NULL,
  "thanhVienId" TEXT NOT NULL,
  "cachLam"     TEXT NOT NULL,
  "boDe"        TEXT NOT NULL,
  -- Vé đề đã mã hoá (AES-256-GCM, gắn người làm, có hạn) — làm tiếp đúng đề đã phát.
  "ve"          TEXT NOT NULL,
  "traLoi"      JSONB NOT NULL DEFAULT '{}'::JSONB,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiscBanNhap_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DiscBanNhap_thanhVienId_cachLam_key" ON "DiscBanNhap"("thanhVienId", "cachLam");
CREATE INDEX IF NOT EXISTS "DiscBanNhap_giaDinhId_idx" ON "DiscBanNhap"("giaDinhId");

-- ─── Bản phân tích cả nhà (bất biến, giữ 5 bản mới nhất) ─────────────────────
CREATE TABLE IF NOT EXISTS "DiscPhanTich" (
  "id"        TEXT NOT NULL,
  "giaDinhId" TEXT NOT NULL,
  "soBan"     INTEGER NOT NULL,
  -- Mã các bài đã dùng (bài đang dùng của mỗi người lúc chạy).
  "maBai"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "noiDung"   JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscPhanTich_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DiscPhanTich_giaDinhId_soBan_key" ON "DiscPhanTich"("giaDinhId", "soBan");

-- ─── Kế hoạch, việc, check-in ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DiscKeHoach" (
  "id"          TEXT NOT NULL,
  "giaDinhId"   TEXT NOT NULL,
  "phanTichId"  TEXT,
  "ky"          TEXT NOT NULL,
  "batDau"      DATE NOT NULL,
  "trangThai"   TEXT NOT NULL DEFAULT 'DANG_CHAY',
  "doKho"       INTEGER NOT NULL DEFAULT 1,
  "soViecTuan"  INTEGER NOT NULL DEFAULT 7,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiscKeHoach_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DiscKeHoach_giaDinhId_ky_idx" ON "DiscKeHoach"("giaDinhId", "ky");
-- Mỗi kỳ chỉ MỘT kế hoạch đang chạy.
CREATE UNIQUE INDEX IF NOT EXISTS "DiscKeHoach_dang_chay_key" ON "DiscKeHoach"("giaDinhId", "ky") WHERE "trangThai" = 'DANG_CHAY';

CREATE TABLE IF NOT EXISTS "DiscViec" (
  "id"          TEXT NOT NULL,
  "keHoachId"   TEXT NOT NULL,
  -- NULL = việc của CẢ NHÀ (nghi thức tuần, họp gia đình…): chủ sổ tick.
  "nguoiLamId"  TEXT,
  "nguoiNhanId" TEXT,
  "ngay"        DATE NOT NULL,
  -- Khoá bảng nội dung đã sinh ra việc (vd "VIEC_CUA_TOI:D:toi-cao-hon:ngang-vai") — để truy nguồn, không phải nội dung.
  "nguon"       TEXT NOT NULL,
  "noiDung"     TEXT NOT NULL,
  "phut"        INTEGER NOT NULL DEFAULT 10,
  "hoatDongId"  TEXT,
  "xongLuc"     TIMESTAMPTZ(6),
  "nguoiTick"   TEXT,
  "camOnLuc"    TIMESTAMPTZ(6),
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscViec_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DiscViec_keHoachId_ngay_idx" ON "DiscViec"("keHoachId", "ngay");
CREATE INDEX IF NOT EXISTS "DiscViec_nguoiLamId_idx" ON "DiscViec"("nguoiLamId");

CREATE TABLE IF NOT EXISTS "DiscCheckin" (
  "keHoachId"   TEXT NOT NULL,
  "thanhVienId" TEXT NOT NULL,
  "tuan"        INTEGER NOT NULL,
  "diem"        INTEGER NOT NULL,
  -- Cặp dễ chịu hơn trong tuần: "idA|idB" (id thành viên, thứ tự từ điển).
  "capDeChiu"   TEXT,
  "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscCheckin_pkey" PRIMARY KEY ("keHoachId", "thanhVienId", "tuan")
);

-- ─── Thư viện hoạt động gắn kết (admin quản trị; kế hoạch chỉ dùng dòng ĐÃ KIỂM) ──
CREATE TABLE IF NOT EXISTS "DiscHoatDong" (
  "id"        TEXT NOT NULL,
  "loai"      TEXT NOT NULL,
  "moTa"      TEXT NOT NULL,
  "truc"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "doTuoi"    INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "phut"      INTEGER NOT NULL DEFAULT 60,
  "chiPhi"    TEXT,
  -- { ten, diaChi, nguon, ngayKiem } — KHÔNG bịa: thiếu thì để NULL, kế hoạch sẽ hiện hoạt động không kèm địa điểm.
  "diaDiem"   JSONB,
  "trangThai" TEXT NOT NULL DEFAULT 'CHUA_KIEM',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DiscHoatDong_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DiscHoatDong_trangThai_idx" ON "DiscHoatDong"("trangThai");

-- ─── Khoá ngoại ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscThanhVien_giaDinhId_fkey') THEN
    ALTER TABLE "DiscThanhVien" ADD CONSTRAINT "DiscThanhVien_giaDinhId_fkey" FOREIGN KEY ("giaDinhId") REFERENCES "DiscGiaDinh"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscBaiLam_giaDinhId_fkey') THEN
    ALTER TABLE "DiscBaiLam" ADD CONSTRAINT "DiscBaiLam_giaDinhId_fkey" FOREIGN KEY ("giaDinhId") REFERENCES "DiscGiaDinh"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscBaiLam_thanhVienId_fkey') THEN
    ALTER TABLE "DiscBaiLam" ADD CONSTRAINT "DiscBaiLam_thanhVienId_fkey" FOREIGN KEY ("thanhVienId") REFERENCES "DiscThanhVien"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscCauDaThay_thanhVienId_fkey') THEN
    ALTER TABLE "DiscCauDaThay" ADD CONSTRAINT "DiscCauDaThay_thanhVienId_fkey" FOREIGN KEY ("thanhVienId") REFERENCES "DiscThanhVien"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscBanNhap_giaDinhId_fkey') THEN
    ALTER TABLE "DiscBanNhap" ADD CONSTRAINT "DiscBanNhap_giaDinhId_fkey" FOREIGN KEY ("giaDinhId") REFERENCES "DiscGiaDinh"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscBanNhap_thanhVienId_fkey') THEN
    ALTER TABLE "DiscBanNhap" ADD CONSTRAINT "DiscBanNhap_thanhVienId_fkey" FOREIGN KEY ("thanhVienId") REFERENCES "DiscThanhVien"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscPhanTich_giaDinhId_fkey') THEN
    ALTER TABLE "DiscPhanTich" ADD CONSTRAINT "DiscPhanTich_giaDinhId_fkey" FOREIGN KEY ("giaDinhId") REFERENCES "DiscGiaDinh"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscKeHoach_giaDinhId_fkey') THEN
    ALTER TABLE "DiscKeHoach" ADD CONSTRAINT "DiscKeHoach_giaDinhId_fkey" FOREIGN KEY ("giaDinhId") REFERENCES "DiscGiaDinh"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscKeHoach_phanTichId_fkey') THEN
    ALTER TABLE "DiscKeHoach" ADD CONSTRAINT "DiscKeHoach_phanTichId_fkey" FOREIGN KEY ("phanTichId") REFERENCES "DiscPhanTich"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscViec_keHoachId_fkey') THEN
    ALTER TABLE "DiscViec" ADD CONSTRAINT "DiscViec_keHoachId_fkey" FOREIGN KEY ("keHoachId") REFERENCES "DiscKeHoach"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscViec_nguoiLamId_fkey') THEN
    ALTER TABLE "DiscViec" ADD CONSTRAINT "DiscViec_nguoiLamId_fkey" FOREIGN KEY ("nguoiLamId") REFERENCES "DiscThanhVien"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscViec_hoatDongId_fkey') THEN
    ALTER TABLE "DiscViec" ADD CONSTRAINT "DiscViec_hoatDongId_fkey" FOREIGN KEY ("hoatDongId") REFERENCES "DiscHoatDong"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscCheckin_keHoachId_fkey') THEN
    ALTER TABLE "DiscCheckin" ADD CONSTRAINT "DiscCheckin_keHoachId_fkey" FOREIGN KEY ("keHoachId") REFERENCES "DiscKeHoach"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscCheckin_thanhVienId_fkey') THEN
    ALTER TABLE "DiscCheckin" ADD CONSTRAINT "DiscCheckin_thanhVienId_fkey" FOREIGN KEY ("thanhVienId") REFERENCES "DiscThanhVien"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ─── Ràng buộc giá trị (CHECK) ───────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscBaiLam_cachLam_check') THEN
    ALTER TABLE "DiscBaiLam" ADD CONSTRAINT "DiscBaiLam_cachLam_check" CHECK ("cachLam" IN ('TU_LAM', 'GOC_NHIN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscBanNhap_cachLam_check') THEN
    ALTER TABLE "DiscBanNhap" ADD CONSTRAINT "DiscBanNhap_cachLam_check" CHECK ("cachLam" IN ('TU_LAM', 'GOC_NHIN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscKeHoach_ky_check') THEN
    ALTER TABLE "DiscKeHoach" ADD CONSTRAINT "DiscKeHoach_ky_check" CHECK ("ky" IN ('NGAY_7', 'THANG_1', 'NAM_1'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscKeHoach_trangThai_check') THEN
    ALTER TABLE "DiscKeHoach" ADD CONSTRAINT "DiscKeHoach_trangThai_check" CHECK ("trangThai" IN ('DANG_CHAY', 'KET_THUC', 'HUY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscCheckin_diem_check') THEN
    ALTER TABLE "DiscCheckin" ADD CONSTRAINT "DiscCheckin_diem_check" CHECK ("diem" BETWEEN 1 AND 5);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscHoatDong_trangThai_check') THEN
    ALTER TABLE "DiscHoatDong" ADD CONSTRAINT "DiscHoatDong_trangThai_check" CHECK ("trangThai" IN ('CHUA_KIEM', 'DA_KIEM', 'AN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiscThanhVien_vaiTro_check') THEN
    ALTER TABLE "DiscThanhVien" ADD CONSTRAINT "DiscThanhVien_vaiTro_check" CHECK ("vaiTro" BETWEEN 0 AND 7);
  END IF;
END $$;

-- ─── RLS (chỉ ENABLE, không policy) ──────────────────────────────────────────
ALTER TABLE "DiscGiaDinh" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscThanhVien" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscBaiLam" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscCauDaThay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscBanNhap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscPhanTich" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscKeHoach" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscViec" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscCheckin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscHoatDong" ENABLE ROW LEVEL SECURITY;
