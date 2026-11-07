-- 02/10/2026 — GỠ HOÀN TOÀN "Cổng dữ liệu cho Agent" (REST + MCP + OAuth + 2FA phiếu + mọi
-- công cụ agent). Quyết định của chủ dự án 02/10/2026. Chính sách khuyến mãi GIỮ NGUYÊN.
--
-- ĐỢT DỌN MỘT LẦN. Viết TAY (CẤM `prisma migrate dev` — drift 14 bảng, CLAUDE.md mục 6).
--
-- Số đo trước khi viết (02/10/2026):
--   · PROD: AgentClient / AgentGrant / AgentToolCall / AgentMcpSession / UserTotp /
--     AgentPhieuHaiLop đều 0 dòng; vai AGENT_CHI_DOC · GIAM_DOC · KY_THUAT · NOI_MCP tồn tại,
--     0 UserOrgRole.
--   · TEST: vài dòng dữ liệu thử ở các bảng cổng.
--   ⇒ DROP không làm mất dữ liệu nghiệp vụ nào. Bảng có dữ liệu (test) vẫn DROP được: thứ tự
--     dưới đây đi từ CON tới CHA, và mọi khoá ngoại tới `User` nằm trên bảng bị DROP (không
--     có khoá ngoại nào từ bảng giữ lại trỏ VÀO bảng cổng).
--
-- GIỮ:
--   · `AuditLog` / `RbacAuditLog` có dòng nói về cổng — là NHẬT KÝ, không xoá.
--   · Vai `GIAM_DOC` — Chính sách khuyến mãi gán `promotions:*` cho nó. Chỉ gỡ quyền agent
--     khỏi vai (seed-roles cũng reset quyền mỗi lần chạy; làm ở đây để DB đúng NGAY cả khi
--     chưa ai bấm seed).
--   · `PermissionDescriptor` khác — chỉ xoá 8 khoá của cổng.
--
-- CHẠY LẠI ĐƯỢC ([MIG-01], `prisma/migration-chay-lai-duoc.test.ts`): mọi DROP có `IF EXISTS`,
-- mọi DELETE tự idempotent, phép đọc cột `isServiceAccount` bọc trong khối kiểm cột có tồn tại.

BEGIN TRANSACTION;

-- ─── 1. Tài khoản DỊCH VỤ của agent: khoá lại TRƯỚC khi bỏ cột đánh dấu ──────────────────
-- Bỏ cột `isServiceAccount` là mất cái cờ `lib/auth.ts` dùng để chặn đăng nhập. User dịch vụ
-- vốn đã `isActive = false`; ép thêm `accountStatus = DISABLED` để hai hàng rào còn lại
-- (isActive + accountStatus) cùng chặn, kể cả nếu ai đó từng lỡ bật lại một trong hai.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'isServiceAccount'
  ) THEN
    UPDATE "User"
    SET "isActive" = false, "accountStatus" = 'DISABLED'
    WHERE "isServiceAccount" = true;
  END IF;
END $$;

-- ─── 2. Bảng của cổng — con trước, cha sau ─────────────────────────────────────────────
DROP TABLE IF EXISTS "AgentMcpToken";
DROP TABLE IF EXISTS "AgentMcpSession";
DROP TABLE IF EXISTS "UserTotp";          -- trỏ AgentPhieuHaiLop (RESTRICT) ⇒ phải trước phiếu
DROP TABLE IF EXISTS "AgentPhieuHaiLop";
DROP TABLE IF EXISTS "AgentDailyRowQuota";
DROP TABLE IF EXISTS "AgentAccessToken";
DROP TABLE IF EXISTS "AgentClientSecret";
DROP TABLE IF EXISTS "AgentGrant";
DROP TABLE IF EXISTS "AgentToolCall";
DROP TABLE IF EXISTS "AgentClient";

-- ─── 3. Enum riêng của cổng (chỉ các bảng vừa DROP dùng) ──────────────────────────────
DROP TYPE IF EXISTS "AgentMcpTokenKind";
DROP TYPE IF EXISTS "AgentAccessMode";
DROP TYPE IF EXISTS "AgentEnvironment";
DROP TYPE IF EXISTS "AgentClientKind";
DROP TYPE IF EXISTS "AgentStatus";

-- ─── 4. Cột đánh dấu user dịch vụ ─────────────────────────────────────────────────────
ALTER TABLE "User" DROP COLUMN IF EXISTS "isServiceAccount";

-- ─── 5. Quyền (RBAC v2 đọc từ DB — seed KHÔNG tự xoá dòng cũ) ─────────────────────────
-- 8 khoá chỉ cổng dùng: 4 khoá `agent_gateway:*` + 4 khoá đọc sinh ra cho công cụ agent
-- (grep 02/10/2026: không màn/action nào khác gác bằng chúng).
DELETE FROM "RolePermission"
WHERE "action" IN (
  'agent_gateway:view', 'agent_gateway:manage', 'agent_gateway:approve', 'agent_gateway:mcp_connect',
  'roles:view', 'lead_targets:view', 'inbox_channels:view', 'refunds:view'
);
DELETE FROM "UserPermissionGrant"
WHERE "action" IN (
  'agent_gateway:view', 'agent_gateway:manage', 'agent_gateway:approve', 'agent_gateway:mcp_connect',
  'roles:view', 'lead_targets:view', 'inbox_channels:view', 'refunds:view'
);
DELETE FROM "PermissionGrant"
WHERE "permissionKey" IN (
  'agent_gateway:view', 'agent_gateway:manage', 'agent_gateway:approve', 'agent_gateway:mcp_connect',
  'roles:view', 'lead_targets:view', 'inbox_channels:view', 'refunds:view'
)
   OR ("subjectType" = 'ROLE' AND "subjectId" IN (
     SELECT "id" FROM "RoleDef" WHERE "code" IN ('KY_THUAT', 'AGENT_CHI_DOC', 'NOI_MCP')
   ));
DELETE FROM "PermissionDescriptor"
WHERE "key" IN (
  'agent_gateway:view', 'agent_gateway:manage', 'agent_gateway:approve', 'agent_gateway:mcp_connect',
  'roles:view', 'lead_targets:view', 'inbox_channels:view', 'refunds:view'
);

-- GIAM_DOC GIỮ, nhưng chỉ còn quyền của Chính sách khuyến mãi (khớp `prisma/seed-roles.ts`).
DELETE FROM "RolePermission"
WHERE "roleId" IN (SELECT "id" FROM "RoleDef" WHERE "code" = 'GIAM_DOC')
  AND "action" NOT IN ('promotions:view', 'promotions:manage');
UPDATE "RoleDef"
SET "name" = 'Giám đốc — ban hành chính sách khuyến mãi', "updatedAt" = now()
WHERE "code" = 'GIAM_DOC' AND "name" <> 'Giám đốc — ban hành chính sách khuyến mãi';

-- Ba vai CHỈ của cổng: gỡ mọi chỗ trỏ tới vai (UserOrgRole + PositionRole đều RESTRICT) rồi
-- xoá vai (RolePermission CASCADE theo).
DELETE FROM "UserOrgRole"
WHERE "roleId" IN (SELECT "id" FROM "RoleDef" WHERE "code" IN ('KY_THUAT', 'AGENT_CHI_DOC', 'NOI_MCP'));
DELETE FROM "PositionRole"
WHERE "roleId" IN (SELECT "id" FROM "RoleDef" WHERE "code" IN ('KY_THUAT', 'AGENT_CHI_DOC', 'NOI_MCP'));
DELETE FROM "RoleDef" WHERE "code" IN ('KY_THUAT', 'AGENT_CHI_DOC', 'NOI_MCP');

-- ─── 6. Tham số vận hành của cổng ─────────────────────────────────────────────────────
-- `agentGateway.*` (gồm công tắc `agentGateway.enabled` — khoá đó KHÔNG nằm trong registry)
-- + cặp tỷ lệ mục tiêu chỉ công cụ `kinh_doanh.lay_chi_tieu` đọc.
DELETE FROM "SystemSetting"
WHERE "key" LIKE 'agentGateway.%'
   OR "key" IN ('crm.targetLeadToTrialRate', 'crm.targetTrialToEnrollRate');
DELETE FROM "CenterSetting"
WHERE "key" LIKE 'agentGateway.%'
   OR "key" IN ('crm.targetLeadToTrialRate', 'crm.targetTrialToEnrollRate');

-- ─── 7. Thông báo của cổng — trỏ `/cong-du-lieu-agent` (nay 404) ───────────────────────
DELETE FROM "WebPushOutbox" WHERE "dedupeKey" LIKE 'agent-gateway.%';
DELETE FROM "StaffNotification" WHERE "dedupeKey" LIKE 'agent-gateway.%';

COMMIT TRANSACTION;
