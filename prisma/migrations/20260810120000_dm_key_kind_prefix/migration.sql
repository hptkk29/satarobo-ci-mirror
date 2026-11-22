-- F5 (Đợt 3) — dmKey mang TIỀN TỐ LOẠI.
--
-- VÌ SAO: bản P0 đặt `dmKey = sort(userA,userB)` không có phần loại, kèm chỉ dẫn trong
-- lib/chat/dm.ts: "khi mở DM_SALE_PARENT, nếu CÙNG một cặp user có thể có hai DM khác
-- loại thì thêm phần loại vào khoá + migrate dữ liệu cũ".
--
-- Điều kiện đó nay CÓ THẬT, không phải giả định: repo cho phép đa vai (User.roles[]) nên
-- một nhân sự kiêm TEACHER + SALES_CSM với cùng một phụ huynh sẽ đụng đúng một khoá. Để
-- nguyên thì hai kênh dùng chung một Conversation, và job đối soát archive nó khi HẾT
-- QUAN HỆ DẠY HỌC — cắt luôn kênh tư vấn còn hiệu lực, không một dòng lỗi nào.
--
-- AN TOÀN:
--  • CHỈ chạm dòng type = 'DM_TEACHER_PARENT' có dmKey chưa mang tiền tố;
--  • IDEMPOTENT (điều kiện NOT LIKE 'TP:%') — chạy lại không hỏng gì;
--  • KHÔNG xoá, KHÔNG đổi type, KHÔNG chạm participant/message;
--  • UNIQUE trên dmKey giữ nguyên: phép đổi là đơn ánh (thêm tiền tố cố định) nên không
--    thể sinh trùng khoá.
UPDATE "Conversation"
SET "dmKey" = 'TP:' || "dmKey"
WHERE "type" = 'DM_TEACHER_PARENT'
  AND "dmKey" IS NOT NULL
  AND "dmKey" NOT LIKE 'TP:%'
  AND "dmKey" NOT LIKE 'SP:%';
