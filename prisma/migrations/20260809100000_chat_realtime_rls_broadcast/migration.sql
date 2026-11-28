-- US-02 — RLS cho Supabase Realtime Broadcast (chat realtime, Đợt 0).
--
-- Bối cảnh (docs/chat-realtime/00-dieu-chinh-cho-repo.md mục B):
--   · Repo KHÔNG dùng Supabase Auth — Auth.js v5, User.id là cuid.
--   · Server tự mint JWT HS256 (SUPABASE_JWT_SECRET) với claim `app_user_id`
--     = User.id (cuid). Policy đọc claim này qua auth.jwt() ->> 'app_user_id'.
--   · TUYỆT ĐỐI không dùng auth.uid() — cast cuid → uuid sẽ lỗi.
--
-- Chỉ có policy SELECT (nhận broadcast khi subscribe private channel
-- `conv:{conversationId}`): user phải là participant CÒN HIỆU LỰC
-- (leftAt IS NULL) của đúng conversation đó.
--
-- CỐ Ý KHÔNG tạo policy INSERT nào trên realtime.messages: client không được
-- tự phát tin vào channel (channel.send bị từ chối). Broadcast CHỈ đi từ
-- server bằng service role key (TB3 trong docs/chat-realtime/architecture.md).
--
-- Điều kiện đi kèm (ngoài SQL): "Allow public access" trên Realtime Settings
-- phải TẮT — bật lại là vô hiệu toàn bộ private channel (canary TS-02.5,
-- kiểm bằng scripts/_zztest-chat-us02.ts).
--
-- ⚠️ PORTABILITY: migration này CHỈ có nghĩa trên Supabase. CI và DB test local
-- là Postgres trần — không có schema `realtime` lẫn role `authenticated` —
-- nên toàn bộ được bọc guard: thiếu một trong hai → NOTICE và bỏ qua.
-- (Bài học tổng nghiệm thu Đợt 0: CI đỏ 42704 role "authenticated" not exist.)

DO $mig$
BEGIN
  IF EXISTS (
       SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'realtime' AND c.relname = 'messages'
     )
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
  THEN
    EXECUTE 'DROP POLICY IF EXISTS "participant_can_receive_conversation_broadcast" ON realtime.messages';
    EXECUTE $pol$
      CREATE POLICY "participant_can_receive_conversation_broadcast"
      ON realtime.messages
      FOR SELECT
      TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND EXISTS (
          SELECT 1
          FROM public."ConversationParticipant" p
          WHERE p."userId" = (SELECT auth.jwt() ->> 'app_user_id')
            AND p."leftAt" IS NULL
            AND 'conv:' || p."conversationId" = (SELECT realtime.topic())
        )
      )
    $pol$;
  ELSE
    RAISE NOTICE 'chat_realtime_rls_broadcast: bỏ qua — không phải Supabase (thiếu realtime.messages hoặc role authenticated)';
  END IF;
END
$mig$;
