-- Cổng học sinh — MÃ THOÁT 4 SỐ (02/11/2026). Chỉ CỘNG THÊM: hai bảng mới, không đụng bảng đang có.
--
-- Bài toán: con dùng Cổng học sinh ngay trên tài khoản của ba mẹ. Muốn về chế độ ba mẹ thì phải nhập đúng mã
-- do chính ba mẹ đặt. Trước đây chế độ học sinh chỉ là đường dẫn /portal/hoc-sinh — con gõ /portal là ra.
--
-- Cột TRẦN, KHÔNG FK (cùng nếp `orgUnitId` ở các bảng khác): xoá tài khoản không bị chặn bởi nhật ký, và hai bảng
-- này không theo cơ sở nên không qua scopedDb (không có centerId/orgUnitId).

CREATE TABLE IF NOT EXISTS "HocSinhMaThoat" (
    "id" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    -- bcrypt của mã 4 số. KHÔNG bao giờ lưu mã thô.
    "maBam" TEXT NOT NULL,
    -- Số lần nhập sai trong đợt hiện tại; chạm 5 thì đặt khoaDen và không nhận thêm lần thử nào cho tới khi hết khoá.
    "soLanSai" INTEGER NOT NULL DEFAULT 0,
    "khoaDen" TIMESTAMPTZ(6),
    "taoLuc" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doiLuc" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HocSinhMaThoat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HocSinhMaThoat_parentUserId_key" ON "HocSinhMaThoat"("parentUserId");

CREATE TABLE IF NOT EXISTS "HocSinhCheDoNhatKy" (
    "id" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "studentId" TEXT,
    -- VAO | THOAT_DUNG_MA | NHAP_SAI | KHOA | TAO_MA | DOI_MA | DAT_LAI_MA | XAC_MINH_SAI
    "loai" TEXT NOT NULL,
    "chiTiet" TEXT,
    "taoLuc" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HocSinhCheDoNhatKy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HocSinhCheDoNhatKy_parentUserId_taoLuc_idx" ON "HocSinhCheDoNhatKy"("parentUserId", "taoLuc");

ALTER TABLE "HocSinhMaThoat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HocSinhCheDoNhatKy" ENABLE ROW LEVEL SECURITY;
