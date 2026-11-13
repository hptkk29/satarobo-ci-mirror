-- Chủ dự án 15/09/2026: "giảm giá tách riêng theo từng đơn luôn chứ không gộp chung
-- giảm tổng đơn."
--
-- ĐO TRƯỚC KHI SỬA. Giảm giá theo TỪNG DÒNG không phải khái niệm mới trong repo này —
-- `lib/crm/bulk-convert.ts:202` đã tính khuyến mãi của RIÊNG từng em qua
-- `computeEnrollmentPrice` rồi `reduce` vào `discountAmount` của đơn, và
-- `Enrollment.discountAmount` là cột có thật từ lâu. Chỗ lệch là `/orders/new`: nó chỉ
-- có MỘT ô giảm giá cấp đơn, nên đơn hai con không nói được "bớt cho đứa nào".
--
-- Vì sao điều đó hỏng ngay khi đơn có hai con: ưu đãi thật gần như luôn bám vào một em
-- (anh chị em học cùng, học bổng, chuyển tiếp khoá). Gộp thành một số ở cấp đơn là mất
-- hẳn thông tin đó — và mất ở đúng chỗ sau này phải trả lời: hoàn tiền cho một em thì
-- trừ bao nhiêu, chuyển lớp một em thì phần giảm đi theo hay ở lại.
--
-- ⚠️ `unitPrice` KHÔNG đổi và KHÔNG được dùng để "hạ giá cho gọn".
-- `lib/orders/price-guard.ts` so `unitPrice` với giá niêm yết để phát hiện đơn bán lệch;
-- nhét phần giảm vào `unitPrice` là làm mù cổng đó. Giảm giá là cột RIÊNG, đúng như
-- `Enrollment` đang làm (`listPrice` + `discountAmount` + `finalPrice`).
--
-- ⚠️ KHÔNG backfill, và lần này lý do khác lần trước. Đơn CŨ có giảm giá thật, nhưng số
-- đó là giảm CẢ ĐƠN — không có dữ liệu nào nói nó thuộc dòng nào. Chia đều theo tỉ lệ là
-- bịa ra một sự thật mịn hơn sự thật gốc. Nên đơn cũ giữ nguyên `Order.discountAmount`
-- và `Σ OrderItem.discountAmount = 0`; mọi chỗ ĐỌC phải chịu được cả hai hình dạng
-- (bảng sản phẩm hiện dòng giảm cấp đơn ở chân bảng như cũ, chỉ thêm dòng giảm cấp dòng
-- khi dòng đó thực sự có).
--
-- ⚠️ `Order.discountAmount` VẪN LÀ TỔNG, không phải sổ thứ hai. Nó đã có sẵn và được đọc
-- bởi hoá đơn · ZNS · báo cáo · `soatGiaDon`; đường ghi mới đặt nó bằng ĐÚNG tổng các
-- dòng. Đây không phải "thêm cột tổng hợp" (luật cấm `Order.paidAmount`) — cột đã tồn
-- tại từ trước và nay có đúng một nguồn sinh ra nó.

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "discountAmount" INTEGER NOT NULL DEFAULT 0;

-- Nhập theo % thì GIỮ LẠI con số % đã gõ, không chỉ giữ số tiền quy ra: mở lại đơn để
-- soát mà thấy "240.000đ" thay vì "10%" là mất mất ý định của người bán. Cùng lý do
-- `Order.discountPercent` tồn tại. NULL = nhập theo số tiền tuyệt đối.
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "discountPercent" INTEGER;

-- Giải trình của RIÊNG dòng. Cơ chế DUYỆT giảm giá đã gỡ 14/09; dấu vết bằng chữ chính
-- là thứ thay thế nó, nên nó theo dòng chứ không theo đơn — hai em được giảm vì hai lý
-- do khác nhau là ca thường, không phải ngoại lệ.
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "discountReason" TEXT;
