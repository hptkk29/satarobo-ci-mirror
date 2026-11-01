-- EL-03 · BỔ SUNG 5 CỘT CHỊU LỰC — CHỈ-ADD, toàn bộ nullable.
--
-- Hai bảng vừa tạo ở `el_add_trn_core` thiếu cột mà §3.3 của kế hoạch đòi, và thiếu
-- không phải chuyện trang trí — cả hai luật dưới đây là CHỮ CHẾT nếu không có chỗ lưu:
--
--  1. TrnEvalLinkConfig — `mode = LINKED` chỉ lưu được khi ĐỦ SÁU thứ: decisionDocCode +
--     decisionDocEffectiveAt + effectiveFrom + ≥1 tiêu chí + tổng trọng số 100 + hrApprovedByUserId.
--     Không có 3 cột đó thì bật liên kết đánh giá ↔ lương mà không lưu được số hiệu quyết
--     định lẫn người duyệt — không có căn cứ nào truy được về sau.
--  2. TrnPolicyAcceptance.revokedAt — rút đồng ý là ĐÓNG dòng đang hiệu lực, không xoá nó.
--     Đây là đường `update` DUY NHẤT được phép trên bảng đó.
--
-- VÌ SAO LÀM NGAY, CÙNG PR, thay vì để ticket sau: hai bảng này VẪN CHƯA LÊN PROD
-- (PR chưa merge vào `main`) và đang RỖNG trên dev. Thêm cột nullable lúc này tốn 0 đồng;
-- để sau là migration hai pha trên bảng đã có dữ liệu prod (luật cứng #4).
--
-- KHÔNG sửa migration `el_add_trn_core` đã apply — migration đã apply thì KHÔNG BAO GIỜ được
-- sửa; đường đúng là một migration mới, và đó là tệp này.

-- AlterTable
ALTER TABLE "TrnEvalLinkConfig" ADD COLUMN     "decisionDocCode" TEXT,
ADD COLUMN     "decisionDocEffectiveAt" TIMESTAMPTZ(6),
ADD COLUMN     "hrApprovedByUserId" TEXT,
ADD COLUMN     "updatedByUserId" TEXT;

-- AlterTable
ALTER TABLE "TrnPolicyAcceptance" ADD COLUMN     "revokedAt" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "TrnEvalLinkConfig_mode_effectiveFrom_idx" ON "TrnEvalLinkConfig"("mode", "effectiveFrom");
