-- P7-E (06/11/2026): HỒ SƠ CHỨNG TỪ NGÂN HÀNG của khoản thu — kế toán đánh dấu khoản cần bổ sung sao kê / ủy nhiệm chi,
-- tải tệp lên SAU khi khoản đã tạo, rồi kiểm tra. Gắn với Payment kể cả khoản nguồn nhập lịch sử (backfill).
--
-- ⚠️ CHỈ THÊM: một enum + một bảng MỚI + ràng buộc/chỉ mục của nó. KHÔNG đụng bảng đang có dữ liệu PROD (luật cứng #4: không
--    ALTER/DROP cột nào của Payment; khoá ngoại nằm ở bảng mới), không backfill, không seed. Bảng rỗng ⇒ màn "Chứng từ ngân hàng"
--    trống cho tới khi kế toán đánh dấu khoản đầu tiên.
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): mọi câu có IF NOT EXISTS / kiểm pg_type, pg_constraint — một lượt bị ngắt giữa chừng không để lại dòng FAILED
--    chặn mọi `migrate deploy` sau đó (P3009).
-- ⚠️ KHÔNG đổi Payment.accountantStatus / evidenceUrl, Receipt, hoá đơn. Không có quyền mới (dùng lại payments:confirm) ⇒ không phải
--    chạy seed-prod-roles.
-- ⚠️ CHECK chỉ có ở SQL (Prisma không biểu diễn): hai trạng thái "đã có tệp" bắt buộc có khoá tệp — chặn đường ghi bỏ sót.

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChungTuNganHangTrangThai') THEN
        CREATE TYPE "ChungTuNganHangTrangThai" AS ENUM ('CHO_BO_SUNG', 'DA_TAI_LEN', 'DA_KIEM_TRA', 'CAN_BO_SUNG_LAI');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ChungTuNganHang" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "trangThai" "ChungTuNganHangTrangThai" NOT NULL DEFAULT 'CHO_BO_SUNG',
    "lyDoDanhDau" TEXT NOT NULL,
    "danhDauBoiId" TEXT NOT NULL,
    "danhDauLuc" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ghiChu" TEXT,
    "tepKhoa" TEXT,
    "tepTen" TEXT,
    "tepLoai" TEXT,
    "tepCo" INTEGER,
    "tepSha256" TEXT,
    "taiLenBoiId" TEXT,
    "taiLenLuc" TIMESTAMPTZ(6),
    "kiemTraBoiId" TEXT,
    "kiemTraLuc" TIMESTAMPTZ(6),
    "canBoSungLyDo" TEXT,
    "canBoSungBoiId" TEXT,
    "canBoSungLuc" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ChungTuNganHang_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChungTuNganHang_co_tep_check" CHECK (
        "trangThai" IN ('CHO_BO_SUNG', 'CAN_BO_SUNG_LAI') OR "tepKhoa" IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChungTuNganHang_paymentId_key" ON "ChungTuNganHang"("paymentId");
CREATE INDEX IF NOT EXISTS "ChungTuNganHang_centerId_trangThai_idx" ON "ChungTuNganHang"("centerId", "trangThai");
CREATE INDEX IF NOT EXISTS "ChungTuNganHang_orgUnitId_idx" ON "ChungTuNganHang"("orgUnitId");
CREATE INDEX IF NOT EXISTS "ChungTuNganHang_tepKhoa_idx" ON "ChungTuNganHang"("tepKhoa");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChungTuNganHang_paymentId_fkey') THEN
        ALTER TABLE "ChungTuNganHang" ADD CONSTRAINT "ChungTuNganHang_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Bảng MỚI tự bật RLS (chỉ ENABLE, không FORCE, không policy) — khuôn 20260825120000_lead_status_history. Chạy lại vô hại.
ALTER TABLE "ChungTuNganHang" ENABLE ROW LEVEL SECURITY;
