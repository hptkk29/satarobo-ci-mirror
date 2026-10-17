-- GỠ những dòng giao do BACKFILL sinh ra (sự cố prod 24/09/2026).
--
-- ── CHUYỆN GÌ ĐÃ XẢY RA ───────────────────────────────────────────────────────────────
-- `dongBoNick` TỰ ghi `ZaloCrmNick.sataUserId` = `ZaloAccount.ownerUserId` bên ZaloCRM,
-- tức chủ nick do MÁY BÊN KIA ghi nhận — không phải một quyết định phân công của ai.
-- Hồi cột ấy chỉ để hiển thị ("Sale sở hữu") thì vô hại.
--
-- Migration `20260924120000` chép cột ấy sang `ZaloCrmNickGiao` như thể đó là "nick đã
-- giao cho ai". Vì "đã giao ai đó" nghĩa là "những người còn lại KHÔNG được dùng", mỗi
-- nick cắt còn ĐÚNG MỘT người. Đo trên prod ngay sau lượt triển khai: nick Cô Liên chỉ
-- còn Cô Liên, nick Cô Vân chỉ còn Cô Vân, nick CS1 chỉ còn Ms Lộc — và Cô Diệu (CS1)
-- còn 0 nick, tức mở hộp thư ra TRỐNG. Không lỗi nào báo.
--
-- ── MIGRATION NÀY GỠ GÌ, VÀ CỐ Ý KHÔNG GỠ GÌ ─────────────────────────────────────────
-- Gỡ ĐÚNG dòng mang dấu vân tay của lượt backfill, ba điều kiện cùng lúc:
--   ① `sataUserId` của dòng giao TRÙNG `ZaloCrmNick.sataUserId` (cột máy ghi);
--   ② mức là 'chat' — đúng mức backfill đặt;
--   ③ nick đó chỉ có MỘT dòng giao duy nhất.
--
-- ⚠️ Điều kiện ③ là điều kiện quan trọng nhất và phải giữ. Nếu người vận hành ĐÃ vào
-- màn sửa (thêm người thứ hai, đổi mức, gỡ bớt) thì nick có ≠1 dòng, và migration này
-- KHÔNG ĐỤNG TỚI. Gỡ bừa là xoá mất một quyết định của con người để chữa một lỗi của
-- máy — đúng cái sai mà chính sự cố này là ví dụ.
--
-- Sau khi gỡ, nick về trạng thái CHƯA GIAO AI ⇒ cả cơ sở dùng chung ở mức `chat`, đúng
-- hành vi trước lượt triển khai. Lượt đối soát kế tiếp (≤5 phút) đẩy lại sang ZaloCRM.
--
-- Chạy lại được: gỡ xong thì không còn dòng nào khớp, lượt sau không làm gì.
DELETE FROM "ZaloCrmNickGiao" g
 USING "ZaloCrmNick" n
 WHERE g."nickId" = n."id"
   AND n."sataUserId" IS NOT NULL
   AND g."sataUserId" = n."sataUserId"
   AND g."mucQuyen" = 'chat'
   AND (SELECT count(*) FROM "ZaloCrmNickGiao" x WHERE x."nickId" = n."id") = 1;

-- Dọn nốt cột cũ cho những nick vừa gỡ: `dongBoNick` không ghi nó nữa (xem khối 🔴 ở
-- `nick-admin.ts`), nên để lại một giá trị máy đoán chỉ chờ người sau đọc nhầm lần nữa.
-- KHÔNG đụng nick còn dòng giao: ở đó `datGiaoNick` đang giữ cột này đồng bộ có chủ đích
-- (giá trị lùi mã của pha A).
UPDATE "ZaloCrmNick" n
   SET "sataUserId" = NULL
 WHERE n."sataUserId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "ZaloCrmNickGiao" g WHERE g."nickId" = n."id");
