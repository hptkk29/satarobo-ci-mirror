-- Hoá đơn điện tử — CHÍNH SÁCH KÝ THEO PHÁP NHÂN: tạm dừng ký khẩn cấp + hạn mức ký tự động (BGĐ 04/11/2026), tài khoản MISA theo pháp nhân,
-- và dấu vết chứng thư / thời điểm ký trên lệnh ký.
--
-- 1. Bảng MỚI `HoaDonKyChinhSach` — một dòng cho mỗi PHÁP NHÂN (không phải cơ sở: một cơ sở có thể phát hành cho pháp nhân khác).
--    · Không có dòng = KHÔNG tạm dừng, KHÔNG hạn mức. Tạm dừng nằm NGOÀI bảng kết nối để pháp nhân đang chạy bằng biến môi trường (chưa có dòng kết nối) cũng dừng được.
--    · Hạn mức NULL = chưa khai. Quyết định "chưa khai thì có ký tự động không" là của luật thuần (fail-closed), không phải của cột.
-- 2. `HoaDonKetNoiNhaCungCap` thêm 2 cột cho tài khoản MISA theo pháp nhân (AppID + loại hoá đơn). Mật khẩu vẫn ở `matKhauMaHoa` (AES-256-GCM).
--    Dòng MISA cũ (chỉ ghi phương thức ký) giữ nguyên: thiếu thông tin tài khoản ⇒ cổng rơi về biến môi trường như trước.
-- 3. `HoaDonLenhKy` thêm `chungThuSerial` (chứng thư THỰC TẾ đã ký, đọc từ chữ ký trong XML) và `kyLuc` (lúc nhà cung cấp nhận chữ ký).
--
-- CHỈ THÊM. Idempotent. Bảng mới tự bật RLS (chỉ ENABLE, không FORCE, không policy).
-- ROLLBACK: docs/ke-toan-hoa-don/hub/14-KY-CHINH-SACH-VA-TAM-DUNG.md mục «Rollback».

CREATE TABLE IF NOT EXISTS "HoaDonKyChinhSach" (
    "id"               TEXT           NOT NULL,
    "phapNhanMa"       TEXT           NOT NULL,
    "tamDung"          BOOLEAN        NOT NULL DEFAULT false,
    "tamDungLuc"       TIMESTAMPTZ(6),
    "tamDungBoiId"     TEXT,
    "tamDungLyDo"      TEXT,
    "tamDungSuCo"      BOOLEAN        NOT NULL DEFAULT false,
    "hanMucMoiHoaDon"  INTEGER,
    "hanMucMoiNgay"    INTEGER,
    "soToiDa"          INTEGER,
    "cuaSoPhut"        INTEGER,
    "nguongTanSuat"    INTEGER,
    "capNhatBoiId"     TEXT           NOT NULL,
    "lyDoCapNhat"      TEXT,
    "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HoaDonKyChinhSach_pkey" PRIMARY KEY ("id"),
    -- Đang tạm dừng thì phải biết ai · lúc nào · vì sao.
    CONSTRAINT "HoaDonKyChinhSach_tam_dung_check" CHECK (NOT "tamDung" OR ("tamDungLuc" IS NOT NULL AND "tamDungBoiId" IS NOT NULL AND length(btrim(coalesce("tamDungLyDo", ''))) >= 10)),
    CONSTRAINT "HoaDonKyChinhSach_han_muc_check" CHECK (
        ("hanMucMoiHoaDon" IS NULL OR "hanMucMoiHoaDon" > 0)
        AND ("hanMucMoiNgay" IS NULL OR "hanMucMoiNgay" > 0)
        AND ("soToiDa" IS NULL OR "soToiDa" > 0)
        AND ("cuaSoPhut" IS NULL OR ("cuaSoPhut" > 0 AND "cuaSoPhut" <= 1440))
        AND ("nguongTanSuat" IS NULL OR "nguongTanSuat" > 0)
    ),
    -- Số hoá đơn tối đa và cửa sổ thời gian đi đôi với nhau.
    CONSTRAINT "HoaDonKyChinhSach_cua_so_check" CHECK (("soToiDa" IS NULL) = ("cuaSoPhut" IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "HoaDonKyChinhSach_phapNhanMa_key" ON "HoaDonKyChinhSach"("phapNhanMa");

ALTER TABLE "HoaDonKyChinhSach" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "HoaDonKetNoiNhaCungCap" ADD COLUMN IF NOT EXISTS "misaAppId" TEXT;
ALTER TABLE "HoaDonKetNoiNhaCungCap" ADD COLUMN IF NOT EXISTS "misaLoaiHoaDon" TEXT;
ALTER TABLE "HoaDonKetNoiNhaCungCap" DROP CONSTRAINT IF EXISTS "HoaDonKetNoiNhaCungCap_misa_loai_check";
ALTER TABLE "HoaDonKetNoiNhaCungCap" ADD CONSTRAINT "HoaDonKetNoiNhaCungCap_misa_loai_check" CHECK ("misaLoaiHoaDon" IS NULL OR "misaLoaiHoaDon" IN ('co-ma', 'khong-ma'));

ALTER TABLE "HoaDonLenhKy" ADD COLUMN IF NOT EXISTS "chungThuSerial" TEXT;
ALTER TABLE "HoaDonLenhKy" ADD COLUMN IF NOT EXISTS "kyLuc" TIMESTAMPTZ(6);
