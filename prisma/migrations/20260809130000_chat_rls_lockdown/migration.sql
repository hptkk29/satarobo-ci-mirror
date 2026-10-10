-- BẢO MẬT — bịt 2 lỗ do audit runtime-only phát hiện 09/08/2026 (module chat).
--
-- LỖ 1: 7 bảng chat tạo mới KHÔNG bật RLS. Migration 20260617000000 bật RLS cho
-- MỌI bảng public TỒN TẠI LÚC ĐÓ; bảng tạo sau không kế thừa. Trong khi đó
-- Supabase cấp sẵn anon + authenticated quyền SELECT/INSERT/UPDATE/DELETE trên
-- mọi bảng schema public (đo trên DB dev 09/08: cả 2 role có đủ 7 quyền).
-- Trước Đợt 0 chuyện này ngủ yên vì app chưa bao giờ đẩy anon key ra trình duyệt;
-- US-02 bắt đầu đẩy ⇒ từ Đợt 1 (có UI chat) là bất kỳ ai cầm anon key đọc/ghi
-- được TOÀN BỘ tin nhắn, thành viên, tệp đính kèm của mọi lớp/cơ sở qua Data API.
-- Vá: bật RLS (KHÔNG tạo policy) = deny-all cho anon/authenticated, y hệt tiền lệ
-- 20260617000000. Prisma là owner nên bypass (chỉ ENABLE, không FORCE) → app
-- không đổi hành vi.
--
-- LỖ 2: hàm chat_is_participant_of_topic đặt ở schema `public` (schema Data API
-- expose) + SECURITY DEFINER + có EXECUTE cho anon lẫn authenticated (đo trên
-- dev: acl = anon=X | authenticated=X) VÀ nhận `_user_id` từ người gọi ⇒ thành
-- RPC oracle: bất kỳ ai gọi POST /rest/v1/rpc/... hỏi "user X có đang trong hội
-- thoại Y không". Vá: dời sang schema `private` (không expose), bỏ tham số
-- `_user_id` — hàm tự đọc claim của CHÍNH người gọi, nên không trả lời hộ ai được
-- nữa; chỉ authenticated + supabase_realtime_admin có EXECUTE.
--
-- Vẫn cần SECURITY DEFINER: sau lỗ 1, ConversationParticipant có RLS, mà policy
-- realtime chạy dưới role authenticated (không có policy trên bảng đó) ⇒ không
-- bọc definer thì EXISTS luôn false và participant hợp lệ mất quyền subscribe.

-- ── LỖ 1: bật RLS cho 7 bảng chat (chạy trên mọi Postgres) ──────────────────
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnnouncementRead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationMembershipDrift" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConversationReconcileRun" ENABLE ROW LEVEL SECURITY;

-- ── LỖ 2 + policy realtime: chỉ có nghĩa trên Supabase ──────────────────────
DO $mig$
DECLARE
  has_realtime boolean := EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'realtime' AND c.relname = 'messages'
  );
  has_auth_role boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF NOT has_auth_role THEN
    RAISE NOTICE 'chat_rls_lockdown: bỏ qua phần Supabase (không có role authenticated)';
    RETURN;
  END IF;

  -- Gỡ policy cũ TRƯỚC khi bỏ hàm cũ (policy phụ thuộc hàm).
  IF has_realtime THEN
    EXECUTE 'DROP POLICY IF EXISTS "participant_can_receive_conversation_broadcast" ON realtime.messages';
  END IF;
  EXECUTE 'DROP FUNCTION IF EXISTS public.chat_is_participant_of_topic(text, text)';

  EXECUTE 'CREATE SCHEMA IF NOT EXISTS private';
  EXECUTE 'REVOKE ALL ON SCHEMA private FROM PUBLIC';
  EXECUTE 'GRANT USAGE ON SCHEMA private TO authenticated';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_realtime_admin') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA private TO supabase_realtime_admin';
  END IF;

  -- plpgsql: thân hàm không resolve tên lúc tạo → an toàn kể cả nơi thiếu auth.jwt().
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION private.chat_is_participant_of_topic(_topic text)
    RETURNS boolean
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $body$
    BEGIN
      RETURN EXISTS (
        SELECT 1
        FROM public."ConversationParticipant" p
        WHERE p."userId" = (auth.jwt() ->> 'app_user_id')
          AND p."leftAt" IS NULL
          AND 'conv:' || p."conversationId" = _topic
      );
    END
    $body$;
  $fn$;

  EXECUTE 'REVOKE ALL ON FUNCTION private.chat_is_participant_of_topic(text) FROM PUBLIC';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION private.chat_is_participant_of_topic(text) FROM anon';
  END IF;
  EXECUTE 'GRANT EXECUTE ON FUNCTION private.chat_is_participant_of_topic(text) TO authenticated';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_realtime_admin') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION private.chat_is_participant_of_topic(text) TO supabase_realtime_admin';
  END IF;

  IF has_realtime THEN
    EXECUTE $pol$
      CREATE POLICY "participant_can_receive_conversation_broadcast"
      ON realtime.messages
      FOR SELECT
      TO authenticated
      USING (
        realtime.messages.extension = 'broadcast'
        AND private.chat_is_participant_of_topic((SELECT realtime.topic()))
      )
    $pol$;
  END IF;
END
$mig$;
