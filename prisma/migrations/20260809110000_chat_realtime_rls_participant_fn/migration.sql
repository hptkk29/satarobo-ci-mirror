-- US-02 vá lần 1 — policy realtime chạy role `authenticated` nhưng
-- public."ConversationParticipant" đang RLS deny-all (migration 20260617 bật
-- RLS toàn public, không policy) => EXISTS trong policy luôn false, participant
-- hợp lệ cũng CHANNEL_ERROR (đúng bẫy spike G2 đã cảnh báo).
--
-- Vá chuẩn: bọc check vào function SECURITY DEFINER thuộc owner bảng (owner
-- bypass RLS vì chỉ ENABLE, không FORCE) — KHÔNG tạo policy SELECT trên bảng
-- nghiệp vụ (tránh mở ConversationParticipant ra PostgREST/Data API).
--
-- ⚠️ PORTABILITY: function tạo được trên mọi Postgres, nhưng GRANT role
-- Supabase + policy trên realtime.messages phải guard — CI/DB test local là
-- Postgres trần, thiếu role `authenticated` lẫn schema `realtime`.

CREATE OR REPLACE FUNCTION public.chat_is_participant_of_topic(_topic text, _user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."ConversationParticipant" p
    WHERE p."userId" = _user_id
      AND p."leftAt" IS NULL
      AND 'conv:' || p."conversationId" = _topic
  );
$$;

REVOKE ALL ON FUNCTION public.chat_is_participant_of_topic(text, text) FROM PUBLIC;

DO $mig$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.chat_is_participant_of_topic(text, text) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_realtime_admin') THEN
    -- supabase_realtime_admin chạy check authorize lúc join channel ở một số bản
    -- Realtime — cấp EXECUTE phòng hờ, vô hại.
    GRANT EXECUTE ON FUNCTION public.chat_is_participant_of_topic(text, text) TO supabase_realtime_admin;
  END IF;

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
        AND public.chat_is_participant_of_topic(
          (SELECT realtime.topic()),
          (SELECT auth.jwt() ->> 'app_user_id')
        )
      )
    $pol$;
  ELSE
    RAISE NOTICE 'chat_realtime_rls_participant_fn: bỏ qua policy — không phải Supabase';
  END IF;
END
$mig$;
