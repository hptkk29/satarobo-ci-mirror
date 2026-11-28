-- 06/10/2026 — GỠ HOÀN TOÀN trục gọi điện + ghi âm (OmiCall). Quyết định của chủ dự án
-- 06/10/2026: KHÔNG dùng OmiCall nữa. Gỡ CẢ HAI lớp:
--   · khung 27/08/2026 (`20260827120000_call_axis_omicall`): CallLog · CallExtension ·
--     CallDoNotCall + 7 enum Call*; quyền `calls:*`; tham số `calls.*`; trục ngân sách GOI_DIEN;
--   · tích hợp dùng thử 29/09/2026 (`20260929210000_omicall_trial`): CallIntent · CallHotline ·
--     CallRecordingJob · CallEvent + 3 enum.
--
-- ĐỢT DỌN MỘT LẦN. Viết TAY (CẤM `prisma migrate dev` — drift 14 bảng, CLAUDE.md mục 6).
-- Khuôn: `20261002120000_go_cong_du_lieu_agent`.
--
-- Dữ liệu sẽ mất:
--   · PROD: 0 dòng ở mọi bảng Call* (cờ OMICALL_ENABLED chưa từng bật trên prod).
--   · TEST: chỉ dữ liệu chạy thử (CDR mẫu, máy lẻ thử, ý định gọi thử).
--   ⇒ DROP không làm mất dữ liệu nghiệp vụ nào. Bảy bảng KHÔNG có khoá ngoại nào (không trỏ ra,
--     không bảng nào trỏ vào — schema không khai `@relation`, hai migration gốc không có
--     `REFERENCES`). `CASCADE` chỉ để phòng một ràng buộc ai đó tạo tay ngoài migration.
--
-- GIỮ (không xoá):
--   · `AuditLog` / `RbacAuditLog` / `PermissionGrantAuditLog` — NHẬT KÝ, kể cả dòng nói về cuộc gọi.
--   · `LeadActivity` loại CALL có `metadata.nguon = 'omicall'` — lịch sử chăm sóc khách.
--   · Bảng `OutboundSpendCounter` — DÙNG CHUNG với trục ZALO + CHAM_DIEM_AI. Cột `axis` là TEXT
--     (không phải enum Postgres) ⇒ không có giá trị enum nào phải gỡ; chỉ xoá các dòng trục
--     GOI_DIEN (báo cáo ngân sách đã bỏ qua trục lạ, xoá để sổ sạch).
--   · `ScopeShadowDiff` có `permissionKey` = 'calls:*' — log chẩn đoán, không có khoá ngoại.
--
-- CHẠY LẠI ĐƯỢC ([MIG-01], `prisma/migration-chay-lai-duoc.test.ts`): mọi DROP có `IF EXISTS`,
-- mọi DELETE/UPDATE tự idempotent (chạy lần hai khớp 0 dòng).
--
-- ⚠️ THỨ TỰ DEPLOY: `deploy-vps.yml` chạy migrate TRƯỚC khi đổi image. Trong cửa sổ ~1-2 phút
-- đó mã CŨ còn chạy trên bảng đã DROP: gộp lead (`tx.callLog.updateMany`) và khoá tài khoản /
-- cho nhân sự nghỉ (`dongMayLeCuaNguoiDung`) sẽ ném P2021. Deploy vào giờ vắng.

BEGIN TRANSACTION;

-- ─── 1. Bảng của trục gọi điện ────────────────────────────────────────────────────────
DROP TABLE IF EXISTS "CallRecordingJob" CASCADE;
DROP TABLE IF EXISTS "CallEvent" CASCADE;
DROP TABLE IF EXISTS "CallIntent" CASCADE;
DROP TABLE IF EXISTS "CallHotline" CASCADE;
DROP TABLE IF EXISTS "CallLog" CASCADE;
DROP TABLE IF EXISTS "CallExtension" CASCADE;
DROP TABLE IF EXISTS "CallDoNotCall" CASCADE;

-- ─── 2. Enum riêng của trục (chỉ các bảng vừa DROP dùng) ──────────────────────────────
DROP TYPE IF EXISTS "CallProvider";
DROP TYPE IF EXISTS "CallDirection";
DROP TYPE IF EXISTS "CallTechStatus";
DROP TYPE IF EXISTS "CallOutcome";
DROP TYPE IF EXISTS "CallPurpose";
DROP TYPE IF EXISTS "CallRecordingNotice";
DROP TYPE IF EXISTS "CallDncSource";
DROP TYPE IF EXISTS "CallIntentStatus";
DROP TYPE IF EXISTS "CallRecordingJobStatus";
DROP TYPE IF EXISTS "CallEventLeg";

-- ─── 3. Quyền `calls:*` (RBAC v2 đọc từ DB — seed KHÔNG tự xoá dòng cũ) ──────────────────
-- `seed-permission-registry.ts` chỉ chuyển khoá thừa sang `isActive = false`, không DELETE;
-- `seed-roles.ts` chỉ chạy trên prod khi có người bấm `seed-prod-roles.yml`. Xoá ở đây để DB
-- đúng NGAY sau migrate. Grant trước, descriptor sau (PermissionGrant → PermissionDescriptor
-- là `onDelete: Restrict`).
DELETE FROM "RolePermission"
WHERE "action" IN (
  'calls:make', 'calls:view-own', 'calls:view-all',
  'calls:listen-recording', 'calls:export', 'calls:assign'
);
DELETE FROM "UserPermissionGrant"
WHERE "action" IN (
  'calls:make', 'calls:view-own', 'calls:view-all',
  'calls:listen-recording', 'calls:export', 'calls:assign'
);
DELETE FROM "PermissionGrant"
WHERE "permissionKey" IN (
  'calls:make', 'calls:view-own', 'calls:view-all',
  'calls:listen-recording', 'calls:export', 'calls:assign'
);
DELETE FROM "PermissionDescriptor"
WHERE "key" IN (
  'calls:make', 'calls:view-own', 'calls:view-all',
  'calls:listen-recording', 'calls:export', 'calls:assign'
);

-- Menu gọn theo vai: seed không chứa `/tong-dai`, chỉ phòng vai đã sửa tay trên màn.
UPDATE "RoleDef"
SET "anMenu" = array_remove("anMenu", '/tong-dai')
WHERE '/tong-dai' = ANY("anMenu");

-- ─── 4. Tham số vận hành ──────────────────────────────────────────────────────────────
-- 10 khoá `calls.*` + trần cước gọi `outbound.callMonthlyCapVnd` (trục GOI_DIEN).
DELETE FROM "SystemSetting"
WHERE "key" LIKE 'calls.%' OR "key" = 'outbound.callMonthlyCapVnd';
DELETE FROM "CenterSetting"
WHERE "key" LIKE 'calls.%' OR "key" = 'outbound.callMonthlyCapVnd';

-- ─── 5. Sổ chi ngân sách: chỉ dòng trục GOI_DIEN (bảng giữ cho ZALO + CHAM_DIEM_AI) ───────
DELETE FROM "OutboundSpendCounter" WHERE "axis" = 'GOI_DIEN';

-- ─── 6. Payload webhook thô của OmiCall (chứa SĐT phụ huynh) ───────────────────────────
DELETE FROM "WebhookDelivery" WHERE "source" IN ('omicall-cdr', 'omicall-event');

COMMIT TRANSACTION;
