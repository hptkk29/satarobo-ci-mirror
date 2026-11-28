-- Perf indexes (IDX-1..4) — chỉ THÊM index, KHÔNG đổi data/cột → an toàn, additive.
-- Áp: `pnpm prisma migrate deploy` (dev + prod là quyết định deploy của team).
-- ⚠️ Bảng RẤT LỚN ở prod: cân nhắc chạy CREATE INDEX CONCURRENTLY thủ công (ngoài
--    transaction) để tránh lock ghi; migration này dùng CREATE INDEX chuẩn Prisma.

-- IDX-1: Employee là SCOPED_MODEL duy nhất thiếu index centerId (seq scan mọi read HR).
CREATE INDEX "Employee_centerId_idx" ON "Employee"("centerId");
CREATE INDEX "Employee_centerId_status_idx" ON "Employee"("centerId", "status");

-- IDX-2: trang leads Kanban/table order createdAt DESC dưới scope centerId.
CREATE INDEX "Lead_centerId_status_createdAt_idx" ON "Lead"("centerId", "status", "createdAt");

-- IDX-3: trang students paginated order createdAt DESC dưới scope centerId.
CREATE INDEX "Student_centerId_createdAt_idx" ON "Student"("centerId", "createdAt");

-- IDX-4: cron order-debt-reminder (status=PENDING + createdAt) + admin order lists.
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");
