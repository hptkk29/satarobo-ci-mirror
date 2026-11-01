-- ════════════════════════════════════════════════════════════════════════════
-- CHẠY THẾ NÀO (người vận hành, KHÔNG phải agent — luật cứng Nền Hệ thống #4)
--
--   0. ĐIỀU KIỆN: `20260906090000_zalocrm_enum_kenh_ca_nhan` phải chạy XONG trước
--      (transaction của nó phải commit thì giá trị enum mới dùng được). Thứ tự thư
--      mục đã đúng nên `migrate deploy` tự lo — đừng chạy tay lệch thứ tự.
--   1. DB dev/test (DÙNG CHUNG một DB với localhost — CLAUDE.md):
--        npx prisma migrate deploy
--   2. PROD: đi qua `deploy.yml` khi merge `test` → `main`, hoặc chạy tay với
--      DIRECT_URL của prod.
--   3. SAU migration: không có seed nào bắt buộc cho HAI BẢNG NÀY (chúng rỗng, dữ
--      liệu do đồng bộ nick sinh ra). Nhưng quyền `zalocrm:use` của cùng đợt thì CÓ:
--      trên PROD phải chạy workflow `seed-prod-roles.yml`, trên dev/test là
--      `pnpm db:seed:roles`. Quên = người mở /zalo-crm bị đá ra KHÔNG kèm lỗi và
--      KHÔNG tái hiện được ở local (local chạy RBAC v1 tĩnh, prod chạy v2 động).
-- ════════════════════════════════════════════════════════════════════════════
--
-- ZALOCRM — 1 enum MỚI + 2 bảng ÁNH XẠ MỚI + index + RLS.
--
-- ── An toàn ─────────────────────────────────────────────────────────────────
-- THUẦN THÊM: không đụng một bảng đang có nào, không đổi kiểu, không xoá, không khoá
-- ngoại tới bảng cũ. Mã đang chạy trên prod không thấy gì khác. Lăn ngược = DROP 2
-- bảng + 1 enum (thứ tự ngược lại); dữ liệu mọi bảng khác nguyên vẹn.
-- Hai bảng ra đời RỖNG ⇒ KHÔNG cần bước backfill `orgUnitId` (tiền lệ
-- `CenterCommissionAssignee`), chỉ cần khai `BACKFILL_SPECS` để ghi kép bật lên.
--
-- ── Vì sao CÓ `centerId` (ngoại lệ có chủ đích với luật cứng #3) ─────────────
-- Đây là bảng ÁNH XẠ HẠ TẦNG, cùng họ `FacebookPageMapping` và `CallExtension` —
-- không phải dữ liệu nghiệp vụ như `Inbox*`. Mang cả hai cột thì được HAI lưới tự
-- động canh sẵn ([A0-04-T12-01] và [US-07-IT-08b]); đi đường "chỉ orgUnitId" thì
-- không có lưới nào và phải viết thêm một bộ scope thủ công thứ hai.
-- 🔴 `scopedDb` KHÔNG cách ly hai bảng này (chúng ở `SCOPE_EXEMPT`):
-- `lib/integrations/zalocrm/nick-admin.ts` lọc TAY theo `actor.visibleCenterIds`,
-- cho cả đường đọc lẫn đường ghi.
--
-- ── Vì sao KHÔNG có khoá ngoại ──────────────────────────────────────────────
-- Không FK sang "Lead"/"User"/"OrgUnit"/"Center"/Inbox*, cùng lý do đã ghi ở
-- `20260827120000_hop_thu_da_kenh`: dữ liệu ĐẾN TỪ MỘT HỆ NGOÀI không được quyền
-- chặn thao tác dọn dẹp của các bảng lõi. Toàn vẹn do tầng ứng dụng giữ.
--
-- ── Vì sao có RLS ───────────────────────────────────────────────────────────
-- Migration 20260617000000 bật RLS cho mọi bảng public tồn tại LÚC ĐÓ; bảng tạo SAU
-- ra đời với RLS OFF, mà Supabase cấp sẵn role anon + authenticated đủ CRUD trên
-- schema public (đúng lỗ mà 20260809140000 phải đi vá lại hàng loạt bảng). Bật ngay
-- từ đầu thì không sinh nợ mới. Chỉ ENABLE, KHÔNG FORCE ⇒ owner (Prisma/service_role)
-- không đổi hành vi.

-- ── Enum ────────────────────────────────────────────────────────────────────
-- CREATE TYPE rồi dùng ngay trong CÙNG transaction là HỢP LỆ (ràng buộc "unsafe use
-- of new value" chỉ áp cho ADD VALUE trên type có sẵn). Đó là lý do enum này ở đây
-- được, còn hai ALTER TYPE của migration trước thì không.
CREATE TYPE "ZaloCrmNickStatus" AS ENUM ('UNKNOWN', 'CONNECTED', 'DISCONNECTED');

-- ── ZaloCrmNick — một nick Zalo cá nhân do ZaloCRM cầm ──────────────────────
-- Bảng CẤU HÌNH: không SĐT, không email, không tên phụ huynh. `displayName` là tên
-- hồ sơ Zalo của chính NHÂN VIÊN.
CREATE TABLE "ZaloCrmNick" (
    "id"            TEXT NOT NULL,
    -- Định danh nick phía ZaloCRM. Khoá đối chiếu DUY NHẤT giữa hai hệ, và cũng là
    -- `InboxIdentity.accountId` / `InboxConversation.accountId` của kênh ZALO_CA_NHAN.
    "zcrmAccountId" TEXT NOT NULL,
    -- Mã Organization bên ZaloCRM. Một org = một nick = một cơ sở, và là đoạn [org]
    -- trên đường webhook /api/webhooks/zalocrm/[org].
    "orgCode"       TEXT NOT NULL,
    -- User.id của Sale sở hữu. NULL = chưa gán chủ / chủ đã rời việc và nick đang chờ
    -- Quản lý cơ sở nhận lại. Trạng thái BÌNH THƯỜNG, không phải lỗi.
    "sataUserId"    TEXT,
    "displayName"   TEXT,
    "status"        "ZaloCrmNickStatus" NOT NULL DEFAULT 'UNKNOWN',
    -- Mốc sự kiện gần nhất. Cặp (status, lastEventAt) là đầu vào cảnh báo "báo
    -- connected nhưng im > zalocrm.idleAlertHours giờ" — nick chết mà không ai biết.
    "lastEventAt"   TIMESTAMPTZ(6),
    -- NULL = orgCode CHƯA ánh xạ được cơ sở (thiếu mục trong setting zalocrm.orgCodes).
    -- Giữ NULL thay vì đoán: gán nhầm cơ sở kéo theo gán nhầm đơn vị cho mọi hội thoại.
    "centerId"      TEXT,
    "orgUnitId"     TEXT,
    "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ(6) NOT NULL,
    -- Xoá MỀM. ⚠️ Bảng này KHÔNG ở SOFT_DELETE_MODELS ⇒ base `db` không tự ẩn dòng
    -- đã xoá: mọi truy vấn phải tự thêm `deletedAt IS NULL`.
    "deletedAt"     TIMESTAMPTZ(6),

    CONSTRAINT "ZaloCrmNick_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ZaloCrmNick_zcrmAccountId_key" ON "ZaloCrmNick"("zcrmAccountId");
CREATE INDEX "ZaloCrmNick_orgCode_idx"    ON "ZaloCrmNick"("orgCode");
CREATE INDEX "ZaloCrmNick_sataUserId_idx" ON "ZaloCrmNick"("sataUserId");
CREATE INDEX "ZaloCrmNick_centerId_idx"   ON "ZaloCrmNick"("centerId");
CREATE INDEX "ZaloCrmNick_orgUnitId_idx"  ON "ZaloCrmNick"("orgUnitId");
-- Phục vụ cảnh báo nick im lặng (quét theo trạng thái + mốc sự kiện).
CREATE INDEX "ZaloCrmNick_status_lastEventAt_idx" ON "ZaloCrmNick"("status", "lastEventAt");

-- ── ZaloCrmThread — ánh xạ một hội thoại ZaloCRM ↔ một phiếu lead ───────────
CREATE TABLE "ZaloCrmThread" (
    "id"                 TEXT NOT NULL,
    -- = InboxConversation.externalThreadId. NULLABLE có chủ đích: dòng "ĐẶT TRƯỚC"
    -- ra đời lúc Sale bấm "Nhắn Zalo", TRƯỚC khi hội thoại tồn tại bên ZaloCRM.
    -- UNIQUE trên cột nullable — Postgres cho nhiều NULL cùng tồn tại, nên nhiều dòng
    -- đặt trước KHÔNG va nhau, còn khi đã có id thì tra ngược là duy nhất.
    "zcrmConversationId" TEXT,
    "orgCode"            TEXT NOT NULL,
    -- Canonical '84XXXXXXXXX' (KHÔNG dấu '+', không '0' đầu). Tra bằng phoneVariants,
    -- ĐỪNG so bằng: DB còn tồn tại cả hai dạng '0…' và '84…'.
    -- Vì sao bảng này được có cột phone trong khi Inbox* bị cấm: lúc "đặt trước", SĐT
    -- là THỨ DUY NHẤT đang cầm trong tay (chưa có conversationId, chưa có contactId).
    -- Số ở đây chỉ để NỐI, không để hiển thị — muốn hiện cho người dùng thì đọc Lead
    -- qua cổng leads:view-pii như mọi chỗ khác. KHÔNG có email, không tên, không nội dung.
    "phone"              TEXT NOT NULL,
    -- NULL = chưa nối được phiếu (hội thoại mồ côi). Trạng thái BÌNH THƯỜNG.
    "leadId"             TEXT,
    -- Contact.id phía ZaloCRM, để gọi PUT /contacts/:id/external-ref chiều ngược.
    "zcrmContactId"      TEXT,
    -- Chép từ nick khi biết. NULL = CHƯA khớp được cơ sở, giữ NULL thay vì đoán.
    "centerId"           TEXT,
    "orgUnitId"          TEXT,
    "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMPTZ(6) NOT NULL,
    -- Xoá MỀM — cùng cảnh báo như ZaloCrmNick ở trên.
    "deletedAt"          TIMESTAMPTZ(6),

    CONSTRAINT "ZaloCrmThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ZaloCrmThread_zcrmConversationId_key"
    ON "ZaloCrmThread"("zcrmConversationId");

-- KHOÁ CỦA VẾ "ĐẶT TRƯỚC". UNIQUE chứ không phải index thường, vì dòng này là một
-- ÁNH XẠ chứ không phải một nhật ký: trong một org, một số điện thoại là một khách,
-- là một phiếu. Có UNIQUE thì đường ghi lúc bấm "Nhắn Zalo" là một upsert idempotent
-- (bấm hai lần / hai tab / webhook song song đều không đẻ dòng thứ hai); không có nó
-- thì tra (orgCode, phone) trả về nhiều dòng và "nhiều ứng viên" ở đây nghĩa là nối
-- hội thoại vào NHẦM phiếu.
-- GIÁ PHẢI TRẢ, nói thẳng: một số THẬT SỰ có hai hội thoại trong cùng org (khách nhắn
-- hai nick) thì chỉ hội thoại đầu ghi được. Đường webhook vì thế TUYỆT ĐỐI không được
-- đè "zcrmConversationId" đang khác NULL.
-- (UNIQUE này đã sinh sẵn index cho việc tra theo (orgCode, phone) — không tạo thêm
--  index trùng cột: chỉ tốn ghi, không nhanh thêm.)
CREATE UNIQUE INDEX "ZaloCrmThread_orgCode_phone_key" ON "ZaloCrmThread"("orgCode", "phone");

CREATE INDEX "ZaloCrmThread_leadId_idx"        ON "ZaloCrmThread"("leadId");
CREATE INDEX "ZaloCrmThread_zcrmContactId_idx" ON "ZaloCrmThread"("zcrmContactId");
CREATE INDEX "ZaloCrmThread_centerId_idx"      ON "ZaloCrmThread"("centerId");
CREATE INDEX "ZaloCrmThread_orgUnitId_idx"     ON "ZaloCrmThread"("orgUnitId");

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE "ZaloCrmNick"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ZaloCrmThread" ENABLE ROW LEVEL SECURITY;
