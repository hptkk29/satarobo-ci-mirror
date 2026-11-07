// lib/chat/admin.ts — US-15: trang quản trị hội thoại (F-AUDIT + F-LOCK).
//
// Ba việc, một chỗ:
//   1. `listAdminConversations`  — tra cứu METADATA (lớp/cơ sở/người). KHÔNG nội dung.
//   2. `adminLookupConversationAsActor` — mở NỘI DUNG hội thoại mình không thuộc về:
//      bắt buộc `reason`, ghi AuditLog **TRƯỚC** khi đọc/trả nội dung (F-AUDIT bước 4).
//   3. `setConversationLockAsActor` — khoá/mở khoá + broadcast để client đang mở vô hiệu
//      ô nhập NGAY (F-LOCK).
//
// ⚠️ KHÔNG `"use server"` (luật E-bis #1): file này export schema + hằng + type cho test.
// Cửa cho Client Component là `lib/chat/_actions.ts`.
//
// ⚠️ KHÔNG `import "server-only"` — cùng lý do đã ghi ở `lib/chat/queries.ts`/`dm.ts`:
// module phải chạy được dưới vitest node + `tsx`. Chốt chặn "không lọt xuống client" là
// import `@/lib/db`.
//
// ⚠️ ĐỌC BẰNG `db` TRẦN, KHÔNG `scopedDb` (luật E-bis #5 + delta E.3): `Conversation` ∈
// SCOPE_EXEMPT (DM có `centerId = null`, đưa vào SCOPED_MODELS thì null bị hiểu sai), còn
// `Class` ∈ SCOPED_MODELS — đi qua scopedDb thì lớp của cơ sở khác biến mất khỏi màn tra
// cứu của Admin HO, tức chức năng hỏng chứ không phải an toàn hơn. Cổng thật của mọi hàm
// trong file này là `can(actor, "chat:admin")` — quyền đó CHỈ SUPER_ADMIN có
// (prisma/seed-roles.ts; QLCS cố ý không có — US-15 AC5).
//
// ⚠️ VÌ SAO `adminLookupConversationAsActor` KHÔNG dùng `runAction` (đọc trước khi "sửa
// lại cho đúng chuẩn"): `runAction` ghi audit ở **bước 5**, tức SAU khi handler đã chạy
// xong. Toàn bộ giá trị của US-15 nằm ở thứ tự ngược lại — "AuditLog … trước khi nội dung
// trả về" (flows.md F-AUDIT). Ở đây audit là ĐIỀU KIỆN để đọc, không phải dấu vết để lại
// sau khi đọc: `writeAudit` hỏng ⇒ KHÔNG một dòng tin nào được truy vấn. Đường khoá/mở
// (mutation bình thường) thì vẫn đi `runAction` như mọi action ghi khác.
import { z } from "zod";
import type { ConversationStatus, ConversationType, Prisma } from "@prisma/client";
import type { Actor, Target } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import {
  runAction,
  actionFail,
  ActionError,
  type ActionConfig,
  type ActionResult,
} from "@/lib/actions/factory";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { broadcastMessages, conversationBroadcast } from "@/lib/chat/broadcast";
import { decodeCursor, encodeCursor } from "@/lib/chat/queries";

// ─── Hằng số ────────────────────────────────────────────────────────────────

/**
 * Lý do phải là CÂU CÓ NGHĨA. Dài hơn ngưỡng của `chat:moderate` (5) có chủ đích: gỡ một
 * tin là thao tác trong nhóm mình, còn đọc trộm hội thoại người khác là việc phải giải
 * trình được với chủ dự án nhiều tháng sau — "ok", "xem" không giải trình được gì.
 */
export const ADMIN_REASON_MIN_LENGTH = 10;
export const ADMIN_REASON_MAX_LENGTH = 500;

/** Số tin mỗi lượt tra cứu. Mỗi lượt "xem thêm" là MỘT lần xem ⇒ MỘT dòng audit. */
export const ADMIN_TRANSCRIPT_PAGE_SIZE = 50;
/** Trần số dòng của màn tra cứu metadata. */
export const ADMIN_CONVERSATION_LIST_LIMIT = 50;

/** Sự kiện realtime: hợp đồng đã khai ở `lib/chat/broadcast.ts` (`ChatBroadcastEvent`). */
const LOCK_EVENT = "conversation.locked" as const;

// ─── Lỗi ────────────────────────────────────────────────────────────────────

/**
 * BẢNG MÃ LỖI (mã EN + thông điệp VI — quy ước API contract):
 *   VALIDATION                400  thiếu/ngắn `reason` (field="reason"), id sai dạng
 *   PERMISSION_DENIED         403  không có `chat:admin` (QLCS/GV/PH/Sale — AC5)
 *   CONVERSATION_NOT_FOUND    404  không có hội thoại đó
 *   CONVERSATION_ARCHIVED     409  khoá/mở một hội thoại đã lưu trữ (xem `applyLock`)
 *   CONVERSATION_STATE_CHANGED 409 hai người bấm cùng lúc, trạng thái đã đổi
 *   AUDIT_FAILED              500  KHÔNG ghi được AuditLog ⇒ KHÔNG mở nội dung (F-AUDIT)
 */
export type ChatAdminErrorCode =
  | "VALIDATION"
  | "PERMISSION_DENIED"
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_ARCHIVED"
  | "CONVERSATION_STATE_CHANGED"
  | "AUDIT_FAILED";

export const CHAT_ADMIN_ERROR_STATUS: Record<ChatAdminErrorCode, number> = {
  VALIDATION: 400,
  PERMISSION_DENIED: 403,
  CONVERSATION_NOT_FOUND: 404,
  CONVERSATION_ARCHIVED: 409,
  CONVERSATION_STATE_CHANGED: 409,
  AUDIT_FAILED: 500,
};

// ─── Schema ─────────────────────────────────────────────────────────────────

const reasonSchema = z
  .string("Vui lòng nhập lý do")
  // `.trim()` chạy TRƯỚC `.min()` (ZodString) ⇒ chuỗi toàn khoảng trắng rụng đúng như
  // chuỗi rỗng. Yêu cầu cứng của US-15: lý do là dữ liệu người dùng nhập.
  .trim()
  .min(ADMIN_REASON_MIN_LENGTH, `Lý do phải có ít nhất ${ADMIN_REASON_MIN_LENGTH} ký tự`)
  .max(ADMIN_REASON_MAX_LENGTH, `Lý do tối đa ${ADMIN_REASON_MAX_LENGTH} ký tự`);

export const adminLookupConversationSchema = z.object({
  conversationId: z.uuid("Hội thoại không hợp lệ"),
  reason: reasonSchema,
  /** Cursor `(createdAt, id)` của `lib/chat/queries.ts` — xem thêm tin cũ hơn. */
  cursor: z.string().max(120).nullish(),
});

export type AdminLookupConversationInput = z.infer<typeof adminLookupConversationSchema>;

export const setConversationLockSchema = z.object({
  conversationId: z.uuid("Hội thoại không hợp lệ"),
  /** true = khoá, false = mở khoá. */
  locked: z.boolean(),
  reason: reasonSchema,
});

export type SetConversationLockInput = z.infer<typeof setConversationLockSchema>;

// ─── Metadata hội thoại ─────────────────────────────────────────────────────

export type AdminConversationMeta = {
  conversationId: string;
  /** ConversationType dạng text. */
  type: string;
  /** ConversationStatus dạng text: ACTIVE | ARCHIVED | LOCKED. */
  status: string;
  centerId: string | null;
  orgUnitId: string | null;
  /** subjectId khi là nhóm lớp, null với 1-1. */
  classId: string | null;
  className: string | null;
  centerName: string | null;
  title: string | null;
  createdById: string | null;
  createdAt: Date;
  lastMessageAt: Date | null;
  archivedAt: Date | null;
  participantCount: number;
  messageCount: number;
};

type ConversationMetaRaw = {
  conversationId: string;
  type: string;
  status: string;
  centerId: string | null;
  orgUnitId: string | null;
  subjectType: string;
  subjectId: string | null;
  title: string | null;
  createdById: string | null;
  createdAt: Date;
  lastMessageAt: Date | null;
  archivedAt: Date | null;
  className: string | null;
  centerName: string | null;
  participantCount: bigint;
  messageCount: bigint;
};

/**
 * Metadata của MỘT hội thoại — KHÔNG có nội dung tin, nên gọi được TRƯỚC khi có lý do
 * (trang chi tiết hiện tên lớp + trạng thái + nút, nội dung thì chờ modal).
 *
 * `$queryRaw` tagged template: gộp `Class`/`Center`/2 phép đếm trong MỘT lượt đi-về, và
 * raw không dính client extension nên không bị scopedDb lọc (xem khối đầu file).
 */
export async function loadAdminConversationMeta(
  conversationId: string,
): Promise<AdminConversationMeta | null> {
  const rows = await db.$queryRaw<ConversationMetaRaw[]>`
    SELECT c."id"                AS "conversationId",
           c."type"::text        AS "type",
           c."status"::text      AS "status",
           c."centerId",
           c."orgUnitId",
           c."subjectType"::text AS "subjectType",
           c."subjectId",
           c."title",
           c."createdById",
           c."createdAt",
           c."lastMessageAt",
           c."archivedAt",
           cls."name"            AS "className",
           ctr."name"            AS "centerName",
           (SELECT COUNT(*) FROM "ConversationParticipant" p
             WHERE p."conversationId" = c."id" AND p."leftAt" IS NULL) AS "participantCount",
           (SELECT COUNT(*) FROM "Message" m
             WHERE m."conversationId" = c."id")                        AS "messageCount"
    FROM "Conversation" c
    LEFT JOIN "Class" cls
      ON cls."id" = c."subjectId" AND c."subjectType"::text = 'CLASS'
    LEFT JOIN "Center" ctr ON ctr."id" = c."centerId"
    WHERE c."id" = ${conversationId}
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    conversationId: r.conversationId,
    type: r.type,
    status: r.status,
    centerId: r.centerId,
    orgUnitId: r.orgUnitId,
    classId: r.subjectType === "CLASS" ? r.subjectId : null,
    className: r.className,
    centerName: r.centerName,
    title: r.title,
    createdById: r.createdById,
    createdAt: r.createdAt,
    lastMessageAt: r.lastMessageAt,
    archivedAt: r.archivedAt,
    // COUNT(*) của Postgres là bigint → Number() trước khi qua biên RSC (JSON không
    // serialize được BigInt; bỏ sót là màn hình trắng chứ không phải sai số).
    participantCount: Number(r.participantCount),
    messageCount: Number(r.messageCount),
  };
}

/** Target cho `can()` — luôn truyền, kể cả khi action là GLOBAL (luật call-site). */
function adminTargetOf(meta: AdminConversationMeta | null): Target {
  return {
    centerId: meta?.centerId ?? null,
    classId: meta?.classId ?? null,
    createdById: meta?.createdById ?? null,
  };
}

// ─── 1. Tra cứu metadata (AC1 — tìm theo lớp/cơ sở/người) ───────────────────

export type AdminConversationRow = {
  conversationId: string;
  type: string;
  status: string;
  displayName: string;
  centerName: string | null;
  lastMessageAt: Date | null;
  participantCount: number;
  messageCount: number;
};

export type AdminConversationFilters = {
  /** Tên lớp / tên hội thoại / tên hoặc SĐT của một người trong hội thoại. */
  q?: string | null;
  centerId?: string | null;
  /** ConversationType — lọc nhóm lớp / 1-1. */
  type?: string | null;
  status?: string | null;
  limit?: number;
};

/** Trần số id lấy ở bước tra phụ (lớp/người khớp `q`) trước khi lọc hội thoại. */
const MATCH_LOOKUP_LIMIT = 100;

/**
 * Giá trị enum đến từ query string ⇒ là lời khai của người dùng. Lọc theo DANH SÁCH
 * TRẮNG thay vì cast thẳng: chuỗi lạ nhét vào `where` của Prisma làm ném lỗi enum và
 * biến một tham số URL sai thành trang 500.
 */
const CONVERSATION_TYPES: readonly ConversationType[] = [
  "CLASS_GROUP",
  "DM_TEACHER_PARENT",
  "DM_SALE_PARENT",
  "DM_STAFF",
];
const CONVERSATION_STATUSES: readonly ConversationStatus[] = ["ACTIVE", "ARCHIVED", "LOCKED"];

function asType(v: string | null | undefined): ConversationType | null {
  return CONVERSATION_TYPES.find((t) => t === v) ?? null;
}
function asStatus(v: string | null | undefined): ConversationStatus | null {
  return CONVERSATION_STATUSES.find((s) => s === v) ?? null;
}

/**
 * AC1 (nửa đầu) — danh sách hội thoại theo bộ lọc. **KHÔNG trả nội dung tin**: preview
 * của một hội thoại mình không thuộc về cũng là nội dung, mà nội dung chỉ được mở qua
 * đường có lý do + audit.
 *
 * Quyền kiểm NGAY trong hàm (không chỉ ở page.tsx): trang là một cửa, hàm này là cửa còn
 * lại — mai có route/API nào gọi tới thì cổng vẫn đứng đó.
 */
export async function listAdminConversations(
  actor: Actor,
  filters: AdminConversationFilters = {},
): Promise<AdminConversationRow[]> {
  if (!can(actor, "chat:admin", null)) {
    throw new ActionError("PERMISSION_DENIED", "Không có quyền tra cứu hội thoại.");
  }

  const q = filters.q?.trim() ?? "";
  const take = Math.min(Math.max(filters.limit ?? ADMIN_CONVERSATION_LIST_LIMIT, 1), 200);

  // `q` khớp theo 3 đường: tên lớp · tên hội thoại · người trong hội thoại (tên/SĐT).
  // Tra id trước rồi lọc — `Conversation.subjectId` KHÔNG có quan hệ Prisma sang `Class`
  // (BA cố ý, xem schema), nên không join thẳng trong một `where` được.
  let classIds: string[] = [];
  let userIds: string[] = [];
  if (q) {
    const [classes, users] = await Promise.all([
      db.class.findMany({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { classCode: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true },
        take: MATCH_LOOKUP_LIMIT,
      }),
      db.user.findMany({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true },
        take: MATCH_LOOKUP_LIMIT,
      }),
    ]);
    classIds = classes.map((c) => c.id);
    userIds = users.map((u) => u.id);
  }

  const type = asType(filters.type);
  const status = asStatus(filters.status);
  const where: Prisma.ConversationWhereInput = {
    ...(filters.centerId ? { centerId: filters.centerId } : {}),
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            ...(classIds.length > 0 ? [{ subjectId: { in: classIds } }] : []),
            ...(userIds.length > 0
              ? [{ participants: { some: { userId: { in: userIds } } } }]
              : []),
          ],
        }
      : {}),
  };

  const rows = await db.conversation.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    take,
    select: {
      id: true,
      type: true,
      status: true,
      title: true,
      centerId: true,
      subjectType: true,
      subjectId: true,
      lastMessageAt: true,
      _count: { select: { participants: true, messages: true } },
    },
  });
  if (rows.length === 0) return [];

  // Tên lớp + tên cơ sở cho đúng những dòng vừa lấy (2 truy vấn, không N+1).
  const subjectIds = rows
    .filter((r) => r.subjectType === "CLASS" && r.subjectId)
    .map((r) => r.subjectId as string);
  const centerIds = [...new Set(rows.map((r) => r.centerId).filter((x): x is string => !!x))];
  const [classes, centers] = await Promise.all([
    subjectIds.length > 0
      ? db.class.findMany({ where: { id: { in: subjectIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
    centerIds.length > 0
      ? db.center.findMany({ where: { id: { in: centerIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const classById = new Map(classes.map((c) => [c.id, c.name]));
  const centerById = new Map(centers.map((c) => [c.id, c.name]));

  return rows.map((r) => ({
    conversationId: r.id,
    type: r.type,
    status: r.status,
    displayName:
      (r.subjectId ? classById.get(r.subjectId) : null) ??
      r.title ??
      (r.type === "CLASS_GROUP" ? "Nhóm lớp" : "Hội thoại riêng"),
    centerName: r.centerId ? (centerById.get(r.centerId) ?? null) : null,
    lastMessageAt: r.lastMessageAt,
    participantCount: r._count.participants,
    messageCount: r._count.messages,
  }));
}

// ─── 2. Mở nội dung có lý do (AC1 nửa sau + AC2 — F-AUDIT) ──────────────────

export type AdminTranscriptMessage = {
  id: string;
  kind: string;
  senderId: string | null;
  senderName: string | null;
  body: string;
  deleted: boolean;
  deletedAt: Date | null;
  deletedReason: string | null;
  attachmentCount: number;
  createdAt: Date;
};

export type AdminConversationTranscript = {
  conversation: AdminConversationMeta;
  /** MỚI → CŨ (cùng chiều cursor, như `getMessagesPage`). */
  messages: AdminTranscriptMessage[];
  hasMore: boolean;
  nextCursor: string | null;
  /** `AuditLog.id` của chính lượt xem này — hiện lên UI để người xem biết đã bị ghi vết. */
  auditLogId: string;
  viewedAt: Date;
};

/**
 * Đọc tin cho màn tra cứu. Cố ý KHÔNG dùng `getMessagesPage`: hàm đó gác bằng
 * `assertActiveParticipant` (đúng cho người dùng thường), còn ở đây Admin theo định
 * nghĩa KHÔNG phải thành viên — cổng đã là `can("chat:admin")` + lý do + audit.
 *
 * ⚠️ Tin đã gỡ trả NGUYÊN VĂN `body` kèm cờ `deleted` + `deletedReason`. Khác hẳn tầng
 * đọc thường (`DELETED_MESSAGE_TEXT`) — và đó chính là lý do màn này tồn tại: US-12 giữ
 * `body` trong DB "để đối chất khi có khiếu nại", mà người đối chất là Admin HO đang đứng
 * ở đây, sau khi đã nhập lý do và bị ghi vết. Nếu che nốt ở đây thì việc giữ body trong DB
 * thành vô nghĩa.
 */
async function loadTranscript(
  conversationId: string,
  cursor: string | null | undefined,
): Promise<{ messages: AdminTranscriptMessage[]; hasMore: boolean; nextCursor: string | null }> {
  const c = decodeCursor(cursor ?? null);
  const rows = await db.message.findMany({
    where: {
      conversationId,
      ...(c
        ? {
            OR: [
              { createdAt: { lt: c.createdAt } },
              { createdAt: c.createdAt, id: { lt: c.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: ADMIN_TRANSCRIPT_PAGE_SIZE + 1,
    select: {
      id: true,
      kind: true,
      senderId: true,
      body: true,
      createdAt: true,
      deletedAt: true,
      deletedReason: true,
      _count: { select: { attachments: true } },
    },
  });

  const hasMore = rows.length > ADMIN_TRANSCRIPT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, ADMIN_TRANSCRIPT_PAGE_SIZE) : rows;

  const senderIds = [...new Set(page.map((m) => m.senderId).filter((x): x is string => !!x))];
  const users =
    senderIds.length > 0
      ? await db.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, name: true } })
      : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const last = page[page.length - 1];
  return {
    messages: page.map((m) => ({
      id: m.id,
      kind: m.kind,
      senderId: m.senderId,
      // CHỈ tên. KHÔNG SĐT/email: màn tra cứu cần biết AI nói gì, không cần danh bạ —
      // ít PII đi qua biên hơn thì ít chỗ rò hơn (BR-30 tinh thần).
      senderName: m.senderId ? (nameById.get(m.senderId) ?? null) : null,
      body: m.body,
      deleted: m.deletedAt !== null,
      deletedAt: m.deletedAt,
      deletedReason: m.deletedReason,
      attachmentCount: m._count.attachments,
      createdAt: m.createdAt,
    })),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

/**
 * **AC1 + AC2 + F-AUDIT** — mở nội dung một hội thoại. Thứ tự BẤT DI BẤT DỊCH:
 *
 *   zod (thiếu/ngắn lý do → VALIDATION) → hội thoại tồn tại? → can("chat:admin")
 *   → **writeAudit** → mới đọc tin.
 *
 * • Modal ở UI KHÔNG phải chốt chặn (AC1 "không route/API nào vòng qua được"): gọi thẳng
 *   action mà thiếu `reason` rụng ngay ở bước zod, trước khi chạm tới một dòng tin nào.
 * • `writeAudit` ném ⇒ trả `AUDIT_FAILED` và **không truy vấn nội dung**. Không có nhánh
 *   "log lỗi rồi vẫn trả" — với F-AUDIT thì audit là điều kiện, không phải hiệu ứng phụ.
 * • Lý do LƯU NGUYÊN VĂN vào `AuditLog.reason` (không cắt, không chuẩn hoá).
 * • **Lý do bắt buộc kể cả khi Admin TÌNH CỜ là thành viên**: AC nói "hội thoại mình
 *   không phải thành viên", nhưng màn này chỉ có một đường vào và việc tự thêm mình vào
 *   một nhóm là chuyện làm được — nới ở đây là mở sẵn đường vòng. Admin muốn đọc nhóm
 *   mình thuộc về thì vào `/tin-nhan` như mọi người, không qua cửa này.
 */
export async function adminLookupConversationAsActor(
  actor: Actor,
  actorName: string,
  rawInput: unknown,
): Promise<ActionResult<AdminConversationTranscript>> {
  const parsed = adminLookupConversationSchema.safeParse(rawInput);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return actionFail(
      "VALIDATION",
      issue?.message ?? "Dữ liệu không hợp lệ",
      issue?.path.join("."),
    );
  }
  const input = parsed.data;

  const meta = await loadAdminConversationMeta(input.conversationId);
  if (!meta) {
    return actionFail("CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại này.");
  }

  if (!can(actor, "chat:admin", adminTargetOf(meta))) {
    return actionFail("PERMISSION_DENIED", "Không có quyền tra cứu hội thoại.");
  }

  // ── F-AUDIT bước 4: ghi vết TRƯỚC, đọc SAU ──
  const viewedAt = new Date();
  let auditLogId: string;
  try {
    const log = await writeAudit({
      actor: { id: actor.userId, name: actorName },
      module: "chat",
      entityType: "Conversation",
      entityId: meta.conversationId,
      action: "READ",
      // KHÔNG chép nội dung tin vào audit (nhật ký không phải bản sao hội thoại).
      // Chỉ đủ để trả lời "ai / khi nào / hội thoại nào / lý do" — AC2.
      newValues: {
        conversationType: meta.type,
        conversationStatus: meta.status,
        classId: meta.classId,
        centerId: meta.centerId,
        cursor: input.cursor ?? null,
        pageSize: ADMIN_TRANSCRIPT_PAGE_SIZE,
      },
      reason: input.reason, // NGUYÊN VĂN
      // DM có `orgUnitId = null` ⇒ dòng audit này chỉ SUPER_ADMIN (scope "ALL") thấy
      // trong /admin/audit-log. Có chủ đích: US-15 vốn chỉ dành cho SUPER_ADMIN.
      orgUnitId: meta.orgUnitId,
    });
    auditLogId = log.id;
  } catch (err) {
    console.error("[chat/admin] KHÔNG ghi được AuditLog — từ chối mở nội dung:", err);
    return actionFail(
      "AUDIT_FAILED",
      "Không ghi được nhật ký tra cứu nên nội dung không được mở. Vui lòng thử lại.",
    );
  }

  const page = await loadTranscript(meta.conversationId, input.cursor);
  return {
    ok: true,
    data: {
      conversation: meta,
      messages: page.messages,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      auditLogId,
      viewedAt,
    },
  };
}

// ─── 3. Khoá / mở khoá (AC3 — F-LOCK) ───────────────────────────────────────

export type ConversationLockResult = {
  conversationId: string;
  /** Trạng thái SAU thao tác. */
  status: string;
  locked: boolean;
  /** false = vốn đã ở đúng trạng thái đó (bấm hai lần / hai tab) — không phải lỗi. */
  changed: boolean;
};

/**
 * ⭐ QUY TẮC TRẠNG THÁI (đọc trước khi "cho khoá cả hội thoại đã lưu trữ"):
 * `Conversation.status` là MỘT cột, LOCKED sẽ ĐÈ mất ARCHIVED — mở khoá xong không biết
 * đường trả về đâu, và một hội thoại đã kết thúc sẽ sống lại thành ACTIVE. Vì vậy:
 *   • khoá:    ACTIVE → LOCKED (ARCHIVED bị từ chối — nó VỐN đã không gửi được tin,
 *              khoá thêm không đổi gì mà lại làm hỏng trạng thái);
 *   • mở khoá: LOCKED → ACTIVE.
 * Cần "cấm gửi vĩnh viễn" thì đường đúng là ARCHIVED (kết thúc lớp), không phải LOCKED.
 */
async function applyLock(
  meta: AdminConversationMeta,
  locked: boolean,
): Promise<ConversationLockResult> {
  const target = locked ? "LOCKED" : "ACTIVE";
  if (meta.status === target) {
    return { conversationId: meta.conversationId, status: target, locked, changed: false };
  }
  const from = locked ? "ACTIVE" : "LOCKED";
  if (meta.status !== from) {
    throw new ActionError(
      "CONVERSATION_ARCHIVED",
      locked
        ? "Hội thoại đã lưu trữ — vốn đã không gửi tin được, không cần khoá."
        : "Hội thoại đã lưu trữ, không phải đang bị khoá.",
    );
  }
  // `status: from` trong `where` là chốt chống đua (2 tab bấm cùng lúc): người thứ hai
  // được count = 0 và nhận lỗi rõ ràng thay vì ghi đè quyết định của người thứ nhất.
  const res = await db.conversation.updateMany({
    where: { id: meta.conversationId, status: from },
    data: { status: target },
  });
  if (res.count === 0) {
    throw new ActionError(
      "CONVERSATION_STATE_CHANGED",
      "Trạng thái hội thoại vừa thay đổi — vui lòng tải lại trang.",
    );
  }
  return { conversationId: meta.conversationId, status: target, locked, changed: true };
}

/**
 * **AC3** — báo cho MỌI client đang mở hội thoại để ô nhập vô hiệu/bật lại NGAY.
 *
 * Một event duy nhất cho cả hai chiều (`conversation.locked` + cờ `locked` trong payload)
 * — hợp đồng `ChatBroadcastEvent` đã khai đúng tên đó; thêm `conversation.unlocked` là
 * bắt mọi client phải biết hai tên cho một chuyện.
 *
 * ⚠️ KHÔNG đẩy `reason` xuống broadcast: lý do là dữ liệu QUẢN TRỊ (đi vào AuditLog), phụ
 * huynh trong nhóm không phải người nhận nó. Fail-and-forget như mọi broadcast khác
 * (NT1 — Postgres là nguồn sự thật): khoá đã commit thì broadcast hỏng không rollback,
 * client vẫn nhận trạng thái đúng ở lần tải lại kế tiếp, và server vẫn từ chối gửi tin.
 */
async function broadcastLock(result: ConversationLockResult): Promise<void> {
  try {
    await broadcastMessages([
      conversationBroadcast(result.conversationId, LOCK_EVENT, {
        conversationId: result.conversationId,
        status: result.status,
        locked: result.locked,
        at: new Date().toISOString(),
      }),
    ]);
  } catch (err) {
    console.warn("[chat/admin] broadcast khoá lỗi — trạng thái vẫn đã đổi trong DB:", err);
  }
}

function buildLockConfig(
  meta: AdminConversationMeta | null,
): ActionConfig<SetConversationLockInput, ConversationLockResult> {
  return {
    name: "chat.setConversationLock",
    permission: "chat:admin",
    schema: setConversationLockSchema,
    target: () => adminTargetOf(meta),
    // Chốt chặn thứ hai cho lý do bắt buộc (zod đã chặn trước). Giữ lại vì đây là chỗ
    // DUY NHẤT `reason` đi vào `AuditLog.reason` — schema có bị nới thì action vẫn từ chối
    // thay vì ghi audit rỗng (cùng lý lẽ đã ghi ở `lib/chat/moderation.ts`).
    requireReason: true,
    module: "chat",
    entityType: "Conversation",
    auditAction: "UPDATE",
    handler: async ({ input }) => {
      if (!meta) {
        throw new ActionError("CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại này.");
      }
      const result = await applyLock(meta, input.locked);
      if (result.changed) await broadcastLock(result);
      return {
        entityId: meta.conversationId,
        data: result,
        oldValues: { status: meta.status },
        newValues: { status: result.status, locked: result.locked, changed: result.changed },
        orgUnitId: meta.orgUnitId,
      };
    },
  };
}

/** conversationId từ input THÔ (preload chạy trước zod của `runAction`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractConversationId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = (raw as { conversationId?: unknown }).conversationId;
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

/** `reason` cho `runAction` (→ `AuditLog.reason`). Zod vẫn là nơi quyết định hợp lệ. */
function extractReason(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = (raw as { reason?: unknown }).reason;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Lõi THUẦN NGỮ CẢNH — nhận Actor đã resolve, không chạm `auth()`/HTTP (test gọi thẳng).
 * Phần ghép phiên nằm ở `lib/chat/_actions.ts`.
 */
export async function setConversationLockAsActor(
  actor: Actor,
  actorName: string,
  rawInput: unknown,
): Promise<ActionResult<ConversationLockResult>> {
  const conversationId = extractConversationId(rawInput);
  const meta = conversationId ? await loadAdminConversationMeta(conversationId) : null;
  const { res } = await runAction(buildLockConfig(meta), actor, rawInput, {
    actorName,
    reason: extractReason(rawInput),
  });
  return res;
}
