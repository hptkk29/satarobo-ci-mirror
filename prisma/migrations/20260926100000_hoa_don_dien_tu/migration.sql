-- HOÁ ĐƠN ĐIỆN TỬ — màn kế toán (docs/ke-toan-hoa-don/PLAN.md §2.2). GĐ 1: chỉ bảng, chưa có
-- đường ghi nào dùng tới.
--
-- HOÀN TOÀN ADDITIVE (luật cứng #4): 2 enum + 3 bảng MỚI. KHÔNG ALTER bảng tiền nào đang có dữ
-- liệu PROD — quan hệ tới `Payment`/`Order` nằm ở bảng mới (khoá ngoại từ bảng mới trỏ sang),
-- nên không cột nào của `Payment`/`Order` bị đụng. Rollback = ngừng ghi; bảng nằm im.
--
-- Vì sao BẢNG NỐI `HoaDonKhoan` mà không thêm cột `hoaDonId` vào `Payment`: (1) không ALTER bảng
-- `Payment` đang có dữ liệu prod; (2) giữ được lịch sử khi hoá đơn bị thay — dòng nối cũ chuyển
-- `hieuLuc = false` chứ không mất.
--
-- ⚠️ DDL bảng/chỉ mục thường sinh bằng `prisma migrate diff --from-url` trên một DB NHÁP đã
-- `migrate deploy` (công thức AN TOÀN ở CLAUDE.md mục 6, không reset DB nào), rồi chép ĐÚNG phần
-- `HoaDon*`. Phần còn lại của bản diff là drift 14 bảng có sẵn — cố ý KHÔNG chép.

-- CreateEnum
CREATE TYPE "HoaDonTrangThai" AS ENUM ('NHAP', 'DA_XAC_NHAN', 'THAY_THE', 'KHONG_XUAT');

-- CreateEnum
CREATE TYPE "HoaDonGuiTrangThai" AS ENUM ('CHO', 'DANG_GUI', 'DA_GUI', 'LOI');

-- CreateTable
CREATE TABLE "HoaDonDienTu" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "trangThai" "HoaDonTrangThai" NOT NULL,
    "kyHieu" TEXT,
    "soHoaDon" TEXT,
    "ngayPhatHanh" DATE,
    "maTraCuu" TEXT,
    "phapNhanMa" TEXT,
    "phapNhanTen" TEXT,
    "phapNhanMst" TEXT,
    "nguoiMuaTen" TEXT,
    "nguoiMuaDonVi" TEXT,
    "nguoiMuaMst" TEXT,
    "nguoiMuaDiaChi" TEXT,
    "emailNhan" TEXT,
    "nguoiMuaHashLucIn" TEXT,
    "tongTien" INTEGER NOT NULL,
    "tienThaLamTron" INTEGER NOT NULL DEFAULT 0,
    "xuatTheoSoDaThu" BOOLEAN NOT NULL DEFAULT false,
    "guiEmailKhach" BOOLEAN NOT NULL DEFAULT true,
    "tepPdfKey" TEXT,
    "tepPdfTen" TEXT,
    "tepPdfCo" INTEGER,
    "tepPdfSha256" TEXT,
    "tepXmlKey" TEXT,
    "tepXmlTen" TEXT,
    "tepXmlCo" INTEGER,
    "lyDo" TEXT,
    "thayTheChoId" TEXT,
    "taoBoiId" TEXT NOT NULL,
    "xacNhanBoiId" TEXT,
    "xacNhanLuc" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HoaDonDienTu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoaDonKhoan" (
    "hoaDonId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "soTien" INTEGER NOT NULL,
    "hieuLuc" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoaDonKhoan_pkey" PRIMARY KEY ("hoaDonId","paymentId")
);

-- CreateTable
CREATE TABLE "HoaDonGuiEmail" (
    "id" TEXT NOT NULL,
    "hoaDonId" TEXT NOT NULL,
    "lanGui" INTEGER NOT NULL,
    "toi" TEXT NOT NULL,
    "trangThai" "HoaDonGuiTrangThai" NOT NULL DEFAULT 'CHO',
    "emailQueueId" TEXT,
    "loi" TEXT,
    "guiBoiId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HoaDonGuiEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HoaDonDienTu_orderId_idx" ON "HoaDonDienTu"("orderId");

-- CreateIndex
CREATE INDEX "HoaDonDienTu_centerId_trangThai_idx" ON "HoaDonDienTu"("centerId", "trangThai");

-- CreateIndex
CREATE INDEX "HoaDonDienTu_orgUnitId_idx" ON "HoaDonDienTu"("orgUnitId");

-- CreateIndex
CREATE INDEX "HoaDonDienTu_thayTheChoId_idx" ON "HoaDonDienTu"("thayTheChoId");

-- CreateIndex
CREATE INDEX "HoaDonKhoan_paymentId_idx" ON "HoaDonKhoan"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "HoaDonGuiEmail_hoaDonId_lanGui_key" ON "HoaDonGuiEmail"("hoaDonId", "lanGui");

-- AddForeignKey
ALTER TABLE "HoaDonDienTu" ADD CONSTRAINT "HoaDonDienTu_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoaDonKhoan" ADD CONSTRAINT "HoaDonKhoan_hoaDonId_fkey" FOREIGN KEY ("hoaDonId") REFERENCES "HoaDonDienTu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoaDonKhoan" ADD CONSTRAINT "HoaDonKhoan_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoaDonGuiEmail" ADD CONSTRAINT "HoaDonGuiEmail_hoaDonId_fkey" FOREIGN KEY ("hoaDonId") REFERENCES "HoaDonDienTu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Hai chỉ mục TỪNG PHẦN — Prisma không biểu diễn được `WHERE`, nên chỉ có ở đây ────────
--
-- (1) MỘT khoản chỉ thuộc TỐI ĐA MỘT hoá đơn đang hiệu lực (NHAP / DA_XAC_NHAN / KHONG_XUAT).
--     Khoá ở DB chứ không ở mã: hai kế toán (Hội sở + cơ sở) có thể cùng bấm trên một lần thu,
--     và kiểm-rồi-ghi ở tầng ứng dụng thì cả hai cùng thấy "chưa có hoá đơn".
--     Hoá đơn bị THAY ⇒ dòng nối cũ `hieuLuc = false` ⇒ nhả khoản cho bản thay thế.
CREATE UNIQUE INDEX "HoaDonKhoan_paymentId_hieuLuc_key" ON "HoaDonKhoan" ("paymentId") WHERE "hieuLuc";

-- (2) Không hai hoá đơn CÒN SỐNG mang cùng (MST pháp nhân, ký hiệu, số) — gắn nhầm một tờ hoá
--     đơn cho hai lần thu là gửi hoá đơn của khách A cho khách B. Bản THAY_THE nhả số (tải lại
--     đúng tờ đó sau khi huỷ bản nhầm). Dòng không có số (KHONG_XUAT) có `soHoaDon` NULL ⇒
--     Postgres coi NULL là khác nhau ⇒ không đụng khoá.
CREATE UNIQUE INDEX "HoaDonDienTu_soHoaDon_conSong_key" ON "HoaDonDienTu" ("phapNhanMst", "kyHieu", "soHoaDon") WHERE "trangThai" IN ('NHAP', 'DA_XAC_NHAN');

-- ─── RLS ──────────────────────────────────────────────────────────────────────────────────
-- Bảng MỚI ra đời với RLS TẮT (migration 20260617 bật hàng loạt chỉ chạy MỘT LẦN; sự cố 09/08:
-- 31 bảng sinh sau nằm trần cho anon/authenticated). Cả ba bảng: `HoaDonDienTu` có MST + địa chỉ
-- + email khách, `HoaDonGuiEmail` có email, `HoaDonKhoan` nối sang khoản tiền. Chỉ ENABLE, không
-- FORCE, không policy (khuôn `20260825120000_lead_status_history`).
ALTER TABLE "HoaDonDienTu" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HoaDonKhoan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HoaDonGuiEmail" ENABLE ROW LEVEL SECURITY;
