-- N-2 · quyết định B4 (24/08/2026) — nối doanh thu về TỪNG CON.
--
-- Migration ADD-ONLY: đúng một cột NULLABLE + một index + một khoá ngoại. Không sửa,
-- không bỏ, không đổi kiểu cột nào của bảng đang có dữ liệu PROD (luật cứng #4).
-- Chưa chạy lên môi trường nào — người vận hành chạy tay theo quy trình nhánh.
--
-- Ý nghĩa NULL: **chưa quy được về con**, KHÔNG phải "đơn không có con". Đơn tạo trước
-- N-2 đều NULL và KHÔNG được đoán ngược: phiếu một con thì suy được, phiếu nhiều con thì
-- không — đoán sai là gán doanh thu sang đứa khác mà tổng vẫn khớp nên không ai thấy.
-- Rà bằng `pnpm tsx scripts/n02-ra-soat-order-lead-child.ts` (dry-run mặc định).
--
-- Cố ý KHÔNG đặt DEFAULT và KHÔNG backfill trong migration: backfill là quyết định
-- nghiệp vụ có ca không suy được, phải chạy riêng và xem báo cáo trước.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "leadChildId" TEXT;

-- CreateIndex
CREATE INDEX "Order_leadChildId_idx" ON "Order"("leadChildId");

-- AddForeignKey
-- ON DELETE SET NULL: xoá phiếu con không được kéo theo đơn — đơn là chứng từ tiền.
ALTER TABLE "Order" ADD CONSTRAINT "Order_leadChildId_fkey" FOREIGN KEY ("leadChildId") REFERENCES "LeadChild"("id") ON DELETE SET NULL ON UPDATE CASCADE;
