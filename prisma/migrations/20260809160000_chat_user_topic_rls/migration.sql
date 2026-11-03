-- 20260809160000_chat_user_topic_rls
--
-- MÓN NỢ A+B của Đợt 1: badge chưa đọc không có/không nhảy, và danh sách hội thoại
-- không tự cập nhật khi có tin mới. Gốc chung: chỉ tồn tại kênh mức HỘI THOẠI
-- (`conv:{id}`), client chỉ join kênh của hội thoại ĐANG MỞ ⇒ tin đến ở hội thoại KHÁC
-- không có tín hiệu nào tới trình duyệt. Vá: thêm kênh mức NGƯỜI DÙNG `user:{User.id}`
-- để server bắn một event nhẹ `conversation.bumped` tới từng người nhận.
--
-- KHÔNG tạo bảng nào ⇒ không có ENABLE ROW LEVEL SECURITY ở đây (luật E-bis #3 áp cho
-- migration TẠO bảng trong schema public).
--
-- KHÔNG tạo hàm helper ⇒ không đụng luật E-bis #4. Đây là lựa chọn có chủ đích: điều
-- kiện của policy này chỉ so HAI CHUỖI lấy từ chính JWT của người gọi, không đọc bảng
-- nghiệp vụ nào, nên không cần SECURITY DEFINER — khác hẳn `conv:` vốn phải hỏi
-- `ConversationParticipant` (bảng đã bật RLS) nên buộc phải bọc definer. Ít nợ nhất:
-- 0 hàm mới, 0 grant mới, 0 bề mặt PostgREST mới.
--
-- app_user_id = `User.id` (cuid, xem lib/chat/realtime-token.ts). TUYỆT ĐỐI không dùng
-- auth.uid(): ép cuid sang uuid sẽ ném lỗi và làm hỏng cả policy `conv:` đang chạy.
--
-- POLICY LÀ PERMISSIVE ⇒ policy mới OR với `participant_can_receive_conversation_broadcast`.
-- Không nới lỏng policy cũ: USING dưới đây chỉ đúng khi topic có tiền tố `user:` GẮN
-- ĐÚNG id của chính người cầm token, nên không mở thêm được bất kỳ topic `conv:` nào.
--
-- KHÔNG tạo policy INSERT (luật chat #1) — nếu có, trình duyệt tự bơm được
-- `conversation.bumped` giả vào kênh của người khác. Broadcast luôn đi từ server bằng
-- service role.
--
-- LANDMINE CI: CI replay migration trên Postgres TRẦN (không có schema `realtime`, không
-- có role `authenticated`) ⇒ mọi câu đụng hai thứ đó nằm trong DO-block có kiểm tồn tại
-- + `EXECUTE '...'` dạng chuỗi (cùng khuôn 20260809130000_chat_rls_lockdown).
--
-- Rollback: DROP POLICY "user_can_receive_own_user_broadcast" ON realtime.messages;
-- Client mất bump, quay về đúng hành vi hôm nay (badge/danh sách chỉ đổi khi điều
-- hướng) — không mất tin nào, Postgres vẫn là nguồn sự thật.

DO $mig$
DECLARE
  has_realtime boolean := EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'realtime' AND c.relname = 'messages'
  );
  has_auth_role boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF NOT has_auth_role THEN
    RAISE NOTICE 'chat_user_topic_rls: bỏ qua (không có role authenticated)';
    RETURN;
  END IF;
  IF NOT has_realtime THEN
    RAISE NOTICE 'chat_user_topic_rls: bỏ qua (không có realtime.messages)';
    RETURN;
  END IF;

  -- Idempotent: chạy lại, hoặc chạy sau khi ai đó đã tạo tay trên DB dev, đều không vỡ.
  EXECUTE 'DROP POLICY IF EXISTS "user_can_receive_own_user_broadcast" ON realtime.messages';

  EXECUTE $pol$
    CREATE POLICY "user_can_receive_own_user_broadcast"
    ON realtime.messages
    FOR SELECT
    TO authenticated
    USING (
      realtime.messages.extension = 'broadcast'
      AND nullif(auth.jwt() ->> 'app_user_id', '') IS NOT NULL
      AND (SELECT realtime.topic()) = 'user:' || (auth.jwt() ->> 'app_user_id')
    )
  $pol$;
END
$mig$;
