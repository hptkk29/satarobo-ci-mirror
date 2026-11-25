-- BẢO MẬT (NGOÀI phạm vi chat — phát hiện khi audit module chat 09/08/2026).
--
-- Migration 20260617000000 bật RLS cho MỌI bảng public tồn tại lúc đó, cố ý
-- deny-all với anon/authenticated (Prisma là owner nên bypass). Nhưng nó là
-- thao tác MỘT LẦN: mọi bảng tạo SAU đó ra đời với RLS OFF, trong khi Supabase
-- cấp sẵn anon + authenticated đủ SELECT/INSERT/UPDATE/DELETE trên schema public.
--
-- Đo trên DB dev 09/08/2026: 31 bảng public có rowsecurity=false. 7 bảng chat đã
-- xử ở migration 20260809130000; 24 bảng còn lại nằm dưới đây — gồm cả bảng tiền
-- (BankTransaction, PaymentRequest, PaymentAllocation, CreditBalance,
-- RefundRequest), bảng quyền (PermissionGrant, PermissionDescriptor) và chat cũ
-- (ConversationMessage).
--
-- Cho tới nay lỗ này NGỦ YÊN vì app chưa từng đẩy anon key ra trình duyệt
-- (NEXT_PUBLIC_SUPABASE_ANON_KEY để rỗng, không code nào đọc). Module chat bắt
-- đầu dùng anon key ⇒ phải đóng trước khi Đợt 1 lên.
--
-- An toàn: chỉ ENABLE, KHÔNG FORCE ⇒ owner (Prisma/service_role) không đổi hành
-- vi; đúng y tiền lệ 20260617000000 đã chạy trên prod. Đảo ngược bằng
-- ALTER TABLE ... DISABLE ROW LEVEL SECURITY.
--
-- DO-block + to_regclass: bảng nào chưa có ở môi trường đó thì bỏ qua, không chết.

DO $mig$
DECLARE
  t text;
  ds text[] := ARRAY[
    'Affiliate',
    'AssignmentAttachment',
    'AssignmentSubmissionFile',
    'AssignmentTemplate',
    'AssignmentTemplateQuestion',
    'BankTransaction',
    'ClassSchedulePhase',
    'ClassSchedulePhaseSlot',
    'ClassScheduleSlot',
    'ConversationMessage',
    'CourseCompletionRequest',
    'CreditBalance',
    'LeadTrialHistory',
    'PaymentAllocation',
    'PaymentRequest',
    'PermissionDescriptor',
    'PermissionGrant',
    'QrSession',
    'RefundRequest',
    'RevenueTarget',
    'ScormAttempt',
    'StudentBirthdayGreeting',
    'TrialRubricEval',
    'WorkRequest'
  ];
BEGIN
  FOREACH t IN ARRAY ds LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END
$mig$;
