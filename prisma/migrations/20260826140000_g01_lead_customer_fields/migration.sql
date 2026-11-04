-- G-01 — bù 6 trường còn thiếu của bộ thông tin khách hàng.
--
-- THUẦN THÊM (additive): 6 cột nullable + 1 index. Không đổi kiểu, không xoá,
-- không đặt NOT NULL, không thêm ràng buộc khoá ngoại ⇒ mã đang chạy trên prod
-- không thấy gì khác và có thể lăn ngược mà dữ liệu vẫn nguyên.
--
-- ⚠️ CHƯA CHẠY lên môi trường nào (kể cả DB dev/test) — người vận hành chạy tay
-- theo luật cứng #4 của Nền Hệ thống.
--
-- `Lead.city` / `Lead.ward` / `Lead.addressLine` lưu TÊN đọc được, không lưu mã
-- hành chính (giống "Order"."customerCity"/"customerWard"). Danh mục: mô hình 2
-- CẤP hiệu lực 01/07/2025 — tỉnh → phường/xã, không còn cấp quận/huyện.
--
-- KHÔNG có backfill kèm theo: địa chỉ của phiếu cũ đang nằm dưới dạng chữ trong
-- "Lead"."note" (nợ N-1). Bóc nó ra là việc RIÊNG, phải dry-run và đối chiếu mẫu
-- (`note` còn chứa cả cảnh báo tự do do máy ghi), nên cố ý không nhét vào đây —
-- một migration vừa thêm cột vừa đoán dữ liệu là thứ không lăn ngược được.

ALTER TABLE "Lead" ADD COLUMN "parentGender" "Gender";
ALTER TABLE "Lead" ADD COLUMN "parentDob" DATE;
ALTER TABLE "Lead" ADD COLUMN "city" TEXT;
ALTER TABLE "Lead" ADD COLUMN "ward" TEXT;
ALTER TABLE "Lead" ADD COLUMN "addressLine" TEXT;

ALTER TABLE "LeadChild" ADD COLUMN "classId" TEXT;

CREATE INDEX "LeadChild_classId_idx" ON "LeadChild"("classId");
