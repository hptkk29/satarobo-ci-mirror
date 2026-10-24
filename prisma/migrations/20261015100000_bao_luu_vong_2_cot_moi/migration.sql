-- Bảo lưu · nghiệm thu vòng 2 (11/10/2026) — HAI cột mới, cộng thêm (additive), KHÔNG backfill.
--
-- 1) ParentRequest.reserveId — C12: yêu cầu "Bảo lưu" của phụ huynh được nhân sự "Lập hồ sơ bảo lưu" ⇒ yêu cầu tự chuyển 'Đã xử lý' và gắn id hồ sơ. NULL = chưa lập hồ sơ nào
--    (mọi yêu cầu cũ). Cột phẳng, không FK: yêu cầu là dữ liệu của cổng phụ huynh, xoá hồ sơ không được kéo theo xoá/sửa yêu cầu.
-- 2) StudentReserve.snapTuitionSuyRa — C13: ảnh chụp lấy học phí từ dòng đơn; không tìm được dòng đơn thì dùng Enrollment.finalPrice và đặt cờ này để Kế toán thấy
--    con số là SUY RA (cùng khuôn snapSoBuoiSuyRa). Hồ sơ cũ = false (đã chụp bằng finalPrice — nguồn của chúng không còn truy ngược được).
--
-- Chạy TAY trên prod (luật cứng #4): `prisma migrate deploy`. Không đổi/bỏ cột nào, không đụng dữ liệu.
ALTER TABLE "ParentRequest" ADD COLUMN IF NOT EXISTS "reserveId" TEXT;
CREATE INDEX IF NOT EXISTS "ParentRequest_reserveId_idx" ON "ParentRequest"("reserveId");

ALTER TABLE "StudentReserve" ADD COLUMN IF NOT EXISTS "snapTuitionSuyRa" BOOLEAN NOT NULL DEFAULT false;
