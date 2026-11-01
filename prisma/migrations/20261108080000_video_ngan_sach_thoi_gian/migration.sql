-- 28/10/2026: NGÂN SÁCH THỜI GIAN THẬT của việc xem video — bảng MỚI `TrnVideoBudget`, một dòng cho mỗi (người, bài).
--
-- Vì sao một bảng riêng mà không thêm cột vào `TrnVideoSession`: phiên xem là định nghĩa THỐNG KÊ ("số lần xem" của
-- `report-r2` và `du-lieu-cua-toi` đếm dòng của nó, cửa sổ 5 phút) và owner yêu cầu giữ nguyên định nghĩa đó. Ngân sách
-- là trạng thái XÁC MINH có vòng đời riêng (chỉ có nghĩa trong ~20 giây sau nhịp cuối) — gộp hai thứ vào một dòng là
-- buộc một cơ chế chống gian lận phải sống cùng nhịp với một định nghĩa báo cáo. Thuật toán: lib/elearning/video-time-budget.ts.
--
-- ⚠️ CHỈ THÊM: một bảng mới. Không đổi/bỏ cột nào đang có (luật cứng #4), KHÔNG backfill, KHÔNG seed.
--    Mã cũ chạy bình thường trên schema mới (không ai ghi/đọc bảng này); mã mới trên schema cũ thì KHÔNG chạy được
--    ⇒ migration phải đi TRƯỚC khi triển khai (deploy-vps tự `migrate deploy`).
-- ⚠️ CHẠY LẠI ĐƯỢC (luật [MIG-01]): IF NOT EXISTS / DO-EXCEPTION — một lượt bị ngắt giữa chừng không để lại dòng
--    FAILED chặn mọi `migrate deploy` sau đó (P3009).
-- ⚠️ Bảng mới tự bật RLS (chỉ ENABLE, không FORCE, không policy) — khuôn `20260825120000_lead_status_history`.
-- ⚠️ Không có quyền mới ⇒ không phải chạy seed-prod-roles. Không có cột đơn vị (cố ý, như TrnVideoSession): bảng này
--    không bao giờ được đọc qua màn hình nào — chỉ `ghiNhipXem` đọc/ghi, dưới khoá tư vấn theo (người, bài).
-- ⚠️ ROLLBACK (không tự chạy; chỉ an toàn khi MÃ đã lui trước): DROP TABLE IF EXISTS "TrnVideoBudget";
--    Bảng chỉ chứa mốc ngân sách ngắn hạn (không phải lịch sử học tập) nên xoá nó không làm mất dữ liệu nghiệp vụ.

CREATE TABLE IF NOT EXISTS "TrnVideoBudget" (
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "tat" TIMESTAMPTZ(6) NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrnVideoBudget_pkey" PRIMARY KEY ("userId", "lessonId")
);

CREATE INDEX IF NOT EXISTS "TrnVideoBudget_updatedAt_idx" ON "TrnVideoBudget"("updatedAt");

DO $$ BEGIN
    ALTER TABLE "TrnVideoBudget"
        ADD CONSTRAINT "TrnVideoBudget_lessonId_fkey"
        FOREIGN KEY ("lessonId") REFERENCES "TrnLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "TrnVideoBudget" ENABLE ROW LEVEL SECURITY;
