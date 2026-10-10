// lib/chat/moderation.ts — US-12: thu hồi & gỡ tin (F-DEL, docs/chat-realtime/flows.md).
//
// Hai cửa, KHÁC NHAU về bản chất — cố ý tách thành hai hàm thay vì một hàm có cờ:
//   • `recallOwnMessage`         — TÁC GIẢ tự thu hồi, chỉ trong 15 phút, không lý do.
//   • `deleteMessageAsModerator` — GV/Admin gỡ tin NGƯỜI KHÁC, không giới hạn thời
//     gian, BẮT BUỘC lý do, có tin SYSTEM + AuditLog.
// Gộp một hàm là mở đường cho "quên nhánh": một tham số truyền sai biến việc gỡ tin
// người khác thành đường thu hồi không cần lý do.
//
// BẤT BIẾN CHUNG (AC3): **LUÔN soft delete**. `Message.body` KHÔNG bao giờ bị sửa/xoá
// — DB giữ nguyên nội dung để đối chất khi có khiếu nại; việc giấu nội dung là của
// tầng đọc (`lib/chat/queries.ts` → `DELETED_MESSAGE_TEXT`). Ở đây chỉ set
// `deletedAt` / `deletedById` / `deletedReason`.
//
// ⚠️ VÌ SAO KHÔNG GỌI `defineAction` (đọc trước khi "sửa lại cho đúng chuẩn"):
// giống hệt lý do đã ghi ở `lib/chat/messages.ts` — `defineAction` suy `Target` cho
// `can()` bằng một hàm ĐỒNG BỘ chỉ nhận `input`, trong khi target của module chat phụ
// thuộc dữ liệu phải ĐỌC DB (hội thoại chứa tin: `classId` cho scope ASSIGNED của GV,
// `centerId` cho scope CENTER của QLCS, tác giả cho scope OWN của PH). File này tự làm
// đúng 3 việc `defineAction` làm (auth → resolveActor → runAction; KHÔNG revalidatePath
// vì luồng chat cập nhật bằng realtime) rồi giao phần còn lại cho `runAction`. Việc
// kiểm quyền vẫn đi qua DUY NHẤT `can()` — không có ma trận vai viết tay ở đây.
//
// ⚠️ VÌ SAO KHÔNG CÓ `"use server"` Ở ĐẦU FILE: luật E-bis #1 — module `"use server"`
// chỉ được export async function; file này còn export hằng, schema và 3 hàm THUẦN cho
// test. Khi màn hình chat cần gọi từ Client Component, tạo `_actions.ts` có
// `"use server"` rồi re-export 2 Server Action ở cuối file này.
//
// BẢNG MÃ LỖI (mã EN + thông điệp VI — quy ước API contract):
//   VALIDATION              400  thiếu/ngắn `reason` (field="reason"), messageId sai dạng
//   PERMISSION_DENIED       403  vai không có action, scope không khớp, hoặc "thu hồi"
//                                tin KHÔNG phải của mình (PH/QLCS gỡ tin người khác)
//   NOT_PARTICIPANT         403  không còn là thành viên hội thoại (chỉ đường thu hồi)
//   RECALL_WINDOW_EXPIRED   403  quá 15 phút — server chặn KỂ CẢ khi UI đã ẩn nút
//   MESSAGE_NOT_FOUND       404  tin không tồn tại
//   MESSAGE_ALREADY_DELETED 409  tin đã bị gỡ trước đó (đua 2 tab / bấm 2 lần)
// Vì sao thiếu lý do là 400 chứ KHÔNG phải 403 (TS-03.6b): người bấm gỡ ĐÃ có quyền —
// cái thiếu là một trường của biểu mẫu. Trả 403 ở đây là bảo GV "anh không có quyền"
// trong khi thật ra chỉ chưa gõ lý do.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import {
  runAction,
  actionFail,
  ActionError,
  type ActionConfig,
  type ActionResult,
} from "@/lib/actions/factory";
import { db } from "@/lib/db";
import {
  broadcastMessages,
  conversationBroadcast,
  userBumpBroadcasts,
} from "@/lib/chat/broadcast";
import { DELETED_MESSAGE_TEXT } from "@/lib/chat/queries";
// US-13 — lớp làm chứng của hội thoại 1-1 (nguồn duy nhất của `target.classId` cho DM).
import { dmWitnessClassId } from "@/lib/chat/dm";

// ─── Hằng số nghiệp vụ ──────────────────────────────────────────────────────

/** AC1 — cửa sổ tự thu hồi. */
export const RECALL_WINDOW_MINUTES = 15;
export const RECALL_WINDOW_MS = RECALL_WINDOW_MINUTES * 60_000;

/** AC2 — lý do gỡ phải là câu có nghĩa, không phải một dấu chấm cho xong. */
export const MODERATION_REASON_MIN_LENGTH = 5;
const MODERATION_REASON_MAX_LENGTH = 500;

/** AC4 — nội dung tin SYSTEM ghi vào nhóm khi người gỡ ≠ tác giả. */
export const MODERATION_SYSTEM_MESSAGE = "Một tin nhắn đã được quản trị viên gỡ.";

// ─── Lỗi ────────────────────────────────────────────────────────────────────

export type ChatModerationErrorCode =
  | "VALIDATION"
  | "PERMISSION_DENIED"
  | "NOT_PARTICIPANT"
  | "RECALL_WINDOW_EXPIRED"
  | "MESSAGE_NOT_FOUND"
  | "MESSAGE_ALREADY_DELETED";

/**
 * Mã lỗi EN → HTTP status (API contract CLAUDE.md). `ActionResult` không mang status,
 * nên bảng này là chỗ DUY NHẤT route/handler HTTP tra khi cần dựng response — và cũng
 * là chỗ test pin được "thiếu lý do = 400, không được phép = 403".
 */
export const CHAT_MODERATION_ERROR_STATUS: Record<ChatModerationErrorCode, number> = {
  VALIDATION: 400,
  PERMISSION_DENIED: 403,
  NOT_PARTICIPANT: 403,
  RECALL_WINDOW_EXPIRED: 403,
  MESSAGE_NOT_FOUND: 404,
  MESSAGE_ALREADY_DELETED: 409,
};

export type ChatModerationError = { code: ChatModerationErrorCode; message: string };

// ─── Ngữ cảnh: tin + hội thoại chứa nó + tư cách của người thao tác ─────────

export type ModerationContext = {
  messageId: string;
  conversationId: string;
  /** null khi tin là SYSTEM. */
  senderId: string | null;
  /** MessageKind dạng text: CHAT | ANNOUNCEMENT | SYSTEM. */
  kind: string;
  createdAt: Date;
  /** khác null = tin ĐÃ bị gỡ trước đó. */
  deletedAt: Date | null;
  /** ConversationStatus dạng text: ACTIVE | ARCHIVED | LOCKED. */
  status: string;
  centerId: string | null;
  orgUnitId: string | null;
  /** ConversationSubjectType dạng text: CLASS | NONE. */
  subjectType: string;
  subjectId: string | null;
  /** null = người thao tác CHƯA từng là thành viên hội thoại này. */
  participantId: string | null;
  /** khác null = đã rời nhóm. */
  participantLeftAt: Date | null;
  /**
   * Hội thoại 1-1: lớp làm chứng cho quan hệ dạy học của người thao tác
   * ({@link dmWitnessClassId}). Nạp riêng ở `recallOwnMessageAsActor` — đường gỡ tin
   * trong nhóm lớp không tốn thêm truy vấn.
   */
  dmClassId?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Đọc tin + hội thoại + participant của người thao tác trong MỘT lượt đi-về.
 *
 * **KHÔNG đi qua `scopedDb`** — luật E-bis #5 (00-dieu-chinh mục E-bis) và cùng lý do
 * đã ghi ở `lib/chat/messages.ts`: tư cách thành viên là dữ kiện MỨC HỆ THỐNG, không
 * phải dữ liệu cần cách ly theo cơ sở (GV dạy chéo cơ sở, PH có con chuyển cơ sở, DM
 * có `centerId = null`). Dùng `$queryRaw` tagged template (client extension KHÔNG áp
 * lên raw) để việc này không vỡ nếu mai có ai đưa `Message`/`ConversationParticipant`
 * vào `SCOPED_MODELS` — lúc đó người có quyền thật sẽ bị 404/403 oan mà không lỗi nào
 * nổi lên. (KHÔNG dùng `$queryRawUnsafe` — CLAUDE.md cấm.)
 */
async function loadModerationContext(
  messageId: string,
  userId: string,
): Promise<ModerationContext | null> {
  const rows = await db.$queryRaw<ModerationContext[]>`
    SELECT m."id"                AS "messageId",
           m."conversationId",
           m."senderId",
           m."kind"::text        AS "kind",
           m."createdAt",
           m."deletedAt",
           c."status"::text      AS "status",
           c."centerId",
           c."orgUnitId",
           c."subjectType"::text AS "subjectType",
           c."subjectId",
           p."id"                AS "participantId",
           p."leftAt"            AS "participantLeftAt"
    FROM "Message" m
    JOIN "Conversation" c ON c."id" = m."conversationId"
    LEFT JOIN "ConversationParticipant" p
      ON p."conversationId" = m."conversationId" AND p."userId" = ${userId}
    WHERE m."id" = ${messageId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ─── PHẦN THUẦN (không DB — unit test ở moderation.test.ts) ─────────────────

/**
 * AC1 — còn trong cửa sổ 15 phút không.
 *
 * Mốc **UTC thuần** (`Date.now()` và `Date.getTime()`, cả hai là số mili-giây kể từ
 * epoch): hiệu hai instant không phụ thuộc múi giờ máy chạy. KHÔNG dùng
 * `new Date(y,m,d,h,mi)` / `getHours()` — Vercel chạy UTC còn máy dev +07, đó đúng là
 * cái bẫy "chạy máy tôi thì được" đã burn ở lịch buổi học.
 * `<=` chứ không `<`: AC ghi "≤ 15 phút", đúng mốc 15'00"000 vẫn cho thu hồi.
 * Tin có `createdAt` ở tương lai (lệch đồng hồ DB/app) coi như trong hạn — thà cho
 * thu hồi còn hơn chặn oan vì vài giây lệch.
 */
export function isWithinRecallWindow(createdAt: Date, now: number = Date.now()): boolean {
  return now - createdAt.getTime() <= RECALL_WINDOW_MS;
}

function err(code: ChatModerationErrorCode, message: string): ChatModerationError {
  return { code, message };
}

/**
 * Guard đường TỰ THU HỒI (F-DEL nhánh 1). Thứ tự CÓ CHỦ ĐÍCH:
 *
 *  1. không có tin            → MESSAGE_NOT_FOUND
 *  2. không còn trong nhóm    → NOT_PARTICIPANT (mã KHÁC "không có quyền": UI phải
 *                               nói đúng "bạn không còn trong nhóm")
 *  3. KHÔNG phải tác giả      → PERMISSION_DENIED **trước** mọi kiểm tra khác, để
 *                               người ngoài không dò được trạng thái tin người khác
 *                               ("tin này quá hạn"/"tin này đã bị gỡ" cũng là thông tin)
 *  4. tin đã bị gỡ            → MESSAGE_ALREADY_DELETED (không ghi đè dấu vết cũ)
 *  5. quá 15 phút             → RECALL_WINDOW_EXPIRED
 *
 * KHÔNG xét `Conversation.status`: F-DEL chỉ đòi "tác giả + ≤15'". ARCHIVED/LOCKED cấm
 * GỬI, không cấm rút lại lời mình vừa nói — và tin vừa gửi 5 phút trước trong lớp vừa
 * bị khoá là đúng lúc người ta cần thu hồi nhất.
 */
export function checkRecallable(
  ctx: ModerationContext | null,
  actorUserId: string,
  now: number = Date.now(),
): ChatModerationError | null {
  if (!ctx) return err("MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn.");
  if (!ctx.participantId || ctx.participantLeftAt !== null) {
    return err("NOT_PARTICIPANT", "Bạn không còn là thành viên của hội thoại này.");
  }
  if (ctx.senderId !== actorUserId) {
    return err(
      "PERMISSION_DENIED",
      "Bạn chỉ thu hồi được tin của chính mình — tin của người khác phải nhờ giáo viên hoặc quản trị viên gỡ.",
    );
  }
  if (ctx.deletedAt !== null) {
    return err("MESSAGE_ALREADY_DELETED", "Tin nhắn này đã được gỡ trước đó.");
  }
  if (!isWithinRecallWindow(ctx.createdAt, now)) {
    return err(
      "RECALL_WINDOW_EXPIRED",
      `Đã quá ${RECALL_WINDOW_MINUTES} phút nên không thu hồi được tin này nữa.`,
    );
  }
  return null;
}

/**
 * Guard đường KIỂM DUYỆT (F-DEL nhánh 2 + 3). Cố ý KHÔNG có:
 *  • cửa sổ 15 phút — tin vi phạm bị phát hiện muộn vẫn phải gỡ được;
 *  • điều kiện participant — "Admin gỡ mọi nơi" (F-DEL); GV được lọc bằng scope
 *    ASSIGNED của `can()`, tức phải được phân công lớp đó, chứ không phải bằng việc
 *    có mặt trong nhóm.
 * Ai được gọi tới đây là việc của `can(actor, "chat:moderate", target)` ở `runAction`.
 */
export function checkModeratable(
  ctx: ModerationContext | null,
): ChatModerationError | null {
  if (!ctx) return err("MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn.");
  if (ctx.deletedAt !== null) {
    return err("MESSAGE_ALREADY_DELETED", "Tin nhắn này đã được gỡ trước đó.");
  }
  return null;
}

/**
 * AC4 — chỉ ghi tin SYSTEM khi người gỡ KHÁC tác giả. GV tự gỡ tin mình thì cả nhóm
 * không cần biết. Tin SYSTEM (`senderId = null`) bị gỡ cũng rơi vào nhánh "khác tác
 * giả" — chấp nhận: đó là ca hiếm và việc ghi nhận vẫn đúng nghĩa "quản trị viên gỡ".
 */
export function needsSystemNotice(ctx: ModerationContext, actorUserId: string): boolean {
  return ctx.senderId !== actorUserId;
}

// ─── Schema ─────────────────────────────────────────────────────────────────

export const recallOwnMessageSchema = z.object({
  messageId: z.uuid("Tin nhắn không hợp lệ"),
});

export type RecallOwnMessageInput = z.infer<typeof recallOwnMessageSchema>;

export const deleteMessageAsModeratorSchema = z.object({
  messageId: z.uuid("Tin nhắn không hợp lệ"),
  // Thiếu lý do phải rụng Ở ĐÂY (zod chạy đầu tiên trong `runAction`) để mã lỗi là
  // VALIDATION + field "reason" — TS-03.6b đòi 400, KHÔNG phải 403.
  reason: z
    .string("Vui lòng nhập lý do gỡ tin")
    .trim()
    .min(
      MODERATION_REASON_MIN_LENGTH,
      `Lý do gỡ tin phải có ít nhất ${MODERATION_REASON_MIN_LENGTH} ký tự`,
    )
    .max(MODERATION_REASON_MAX_LENGTH, `Lý do tối đa ${MODERATION_REASON_MAX_LENGTH} ký tự`),
});

export type DeleteMessageAsModeratorInput = z.infer<typeof deleteMessageAsModeratorSchema>;

export type DeletedChatMessage = {
  id: string;
  conversationId: string;
  /** Tác giả tin bị gỡ (null khi là tin SYSTEM). */
  senderId: string | null;
  deletedAt: Date;
  deletedById: string;
  /** id tin SYSTEM đã ghi kèm (AC4) — null khi người gỡ chính là tác giả. */
  systemMessageId: string | null;
};

// ─── Target cho can() ───────────────────────────────────────────────────────

/**
 * Đường THU HỒI dùng action `chat:send` — cùng cổng vai với việc gửi tin, vì thu hồi
 * là thao tác trên chính lời mình vừa nói (Sale không có `chat:send` ⇒ tự động rụng,
 * đúng ô "—" của permissions.md).
 * `createdById` = TÁC GIẢ THẬT của tin: nhờ vậy scope OWN của phụ huynh khớp đúng khi
 * và chỉ khi đây là tin của họ — người khác rụng ngay ở `can()`. GV/QLCS/Admin qua được
 * cổng vai bằng ASSIGNED/CENTER/GLOBAL nhưng vẫn bị `checkRecallable` chặn nếu không
 * phải tác giả (cùng mã PERMISSION_DENIED, không lộ thêm gì).
 */
function recallTargetOf(ctx: ModerationContext | null) {
  return {
    createdById: ctx?.senderId ?? null,
    // 1-1 (`subjectType = NONE`) lấy LỚP LÀM CHỨNG — cùng lý do đã ghi ở `sendTargetOf`
    // (lib/chat/messages.ts): thiếu nó thì GV gửi được tin riêng nhưng KHÔNG thu hồi
    // được chính tin đó (scope ASSIGNED trượt trên `classId = null`), còn PH thì thu
    // hồi bình thường nhờ scope OWN.
    classId: ctx?.subjectType === "CLASS" ? (ctx.subjectId ?? null) : (ctx?.dmClassId ?? null),
    centerId: ctx?.centerId ?? null,
  };
}

/**
 * Đường KIỂM DUYỆT dùng action `chat:moderate` — chỉ TEACHER (scope ASSIGNED: đúng lớp
 * mình dạy) và SUPER_ADMIN (GLOBAL) có, theo `prisma/seed-roles.ts`. PARENT và
 * CENTER_MANAGER **không có action này** ⇒ PERMISSION_DENIED (TS-03.6a/6c).
 * Cố ý KHÔNG đưa `createdById` vào target: scope OWN cho hành vi "gỡ tin người khác"
 * là vô nghĩa, để lọt vào đây thì một grant nhầm sẽ mở cửa cho chính tác giả.
 *
 * ⚠️ CỐ Ý KHÔNG dùng lớp làm chứng của 1-1 ở đây (khác `recallTargetOf`): ma trận
 * `docs/chat-realtime/permissions.md`, bảng "1-1 (DM_TEACHER_PARENT)", KHÔNG có ô "gỡ
 * tin người khác" — nên GV giữ nguyên trạng thái rụng ở cổng vai trong hội thoại riêng
 * (fail-closed). Admin vẫn gỡ được nhờ scope GLOBAL. Muốn mở thì sửa ma trận TRƯỚC.
 */
function moderateTargetOf(ctx: ModerationContext | null) {
  return {
    classId: ctx?.subjectType === "CLASS" ? (ctx.subjectId ?? null) : null,
    centerId: ctx?.centerId ?? null,
  };
}

// ─── Hiệu ứng phụ sau commit ────────────────────────────────────────────────

/**
 * Khoá dòng participant rồi ĐỌC danh sách người nhận — chạy TRONG transaction gỡ tin.
 *
 * Bắt chước đúng khuôn của đường gửi tin (`lib/chat/messages.ts`, `updateMany` khoá dòng
 * rồi `findMany` trong cùng tx). Vì sao phải khoá: nếu đọc ngoài transaction thì một tx
 * khác đang set `leftAt` (chuyển lớp / gỡ phân công / `syncConversationMembership`) mà
 * CHƯA commit vẫn để người đó lọt vào danh sách ⇒ người vừa bị gỡ nhận bump. Đã tái hiện
 * TẤT ĐỊNH ở đường gỡ tin, trong khi cùng kịch bản ở đường gửi tin thì KHÔNG — đây là bất
 * biến duy nhất trong module chat từng có hai cách thi hành khác nhau.
 *
 * `increment: 0` KHÔNG phải code chết: đây là câu UPDATE **chỉ để khoá** đúng tập dòng sắp
 * đọc (gỡ tin không có thay đổi nghiệp vụ nào trên participant để mượn khoá). Bỏ nó đi là
 * mất khoá, và lỗi quay lại y như cũ.
 *
 * Đọc bằng `tx` của `db` TRẦN (không scopedDb) — luật E-bis #5: dẫn xuất thành viên là
 * thao tác mức hệ thống; qua scopedDb thì GV dạy chéo cơ sở biến mất im lặng.
 */
async function lockAndReadRecipients(
  tx: Prisma.TransactionClient,
  conversationId: string,
  actorUserId: string,
): Promise<string[]> {
  const where = {
    conversationId,
    leftAt: null,
    userId: { not: actorUserId },
  } as const;
  await tx.conversationParticipant.updateMany({
    where,
    data: { unreadCount: { increment: 0 } },
  });
  const recipients = await tx.conversationParticipant.findMany({
    where,
    select: { userId: true },
  });
  return recipients.map((r) => r.userId);
}

/**
 * Broadcast SAU commit, NGOÀI transaction, fail-and-forget.
 * `broadcastMessages` đã cam kết không throw; bọc thêm một lớp ở đây để dù hợp
 * đồng đó bị phá thì việc gỡ ĐÃ commit cũng không biến thành lỗi đỏ trước mặt người
 * dùng. Payload mang sẵn `body` thay thế để client đổi hiển thị mà không phải tải lại
 * — đúng chuỗi mà `lib/chat/queries.ts` trả về, giữ một nguồn sự thật.
 *
 * Kèm `conversation.bumped` tới topic `user:{id}` của các thành viên CÒN HIỆU LỰC:
 * preview của tin vừa gỡ có thể đang nằm trong danh sách hội thoại của họ, không bump
 * thì nó còn hiển thị tới lần điều hướng kế tiếp. Payload bump KHÔNG mang nội dung
 * (BR-30) — client hỏi lại server, và server đã lọc tin bị gỡ ở `lib/chat/queries.ts`.
 *
 * Danh sách người nhận là tập đã được {@link lockAndReadRecipients} chốt TRONG transaction
 * — hàm này KHÔNG đọc DB nữa.
 */
async function broadcastDeleted(
  msg: DeletedChatMessage,
  recipientIds: readonly string[],
): Promise<void> {
  try {
    await broadcastMessages([
      conversationBroadcast(msg.conversationId, "message.deleted", {
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        body: DELETED_MESSAGE_TEXT,
        deleted: true,
        deletedAt: msg.deletedAt.toISOString(),
      }),
      ...userBumpBroadcasts(recipientIds, {
        conversationId: msg.conversationId,
        messageId: msg.id,
        kind: "DELETED",
        at: msg.deletedAt.toISOString(),
      }),
    ]);
  } catch (e) {
    console.warn("[chat/moderation] broadcast lỗi — tin vẫn đã được gỡ:", e);
  }
}

// ─── ActionConfig: thu hồi ──────────────────────────────────────────────────

function buildRecallConfig(
  ctx: ModerationContext | null,
): ActionConfig<RecallOwnMessageInput, DeletedChatMessage> {
  return {
    name: "chat.recallMessage",
    permission: "chat:send",
    schema: recallOwnMessageSchema,
    target: () => recallTargetOf(ctx),
    module: "chat",
    entityType: "Message",
    auditAction: "DELETE",
    handler: async ({ actor }) => {
      const guard = checkRecallable(ctx, actor.userId);
      if (guard) throw new ActionError(guard.code, guard.message);
      const m = ctx as ModerationContext;

      const deletedAt = new Date();
      // Việc soft delete tự nó atomic, NHƯNG danh sách người nhận bump phải đọc trong
      // CÙNG transaction (xem `lockAndReadRecipients`) nên cả hai đi chung một tx.
      // `deletedAt: null` trong `where` là chốt chống đua (2 tab bấm cùng lúc): người thứ
      // hai được count = 0 và nhận đúng mã MESSAGE_ALREADY_DELETED thay vì ghi đè dấu vết
      // người thứ nhất.
      // ⚠️ KHÔNG đụng `body` (AC3) — DB giữ nguyên nội dung để đối chất.
      // timeout 30s / maxWait 10s theo luật E-bis #2.
      const recipientIds = await db.$transaction(
        async (tx) => {
          const updated = await tx.message.updateMany({
            where: { id: m.messageId, deletedAt: null },
            data: { deletedAt, deletedById: actor.userId },
          });
          if (updated.count === 0) {
            throw new ActionError(
              "MESSAGE_ALREADY_DELETED",
              "Tin nhắn này đã được gỡ trước đó.",
            );
          }
          return lockAndReadRecipients(tx, m.conversationId, actor.userId);
        },
        { timeout: 30_000, maxWait: 10_000 },
      );

      const data: DeletedChatMessage = {
        id: m.messageId,
        conversationId: m.conversationId,
        senderId: m.senderId,
        deletedAt,
        deletedById: actor.userId,
        systemMessageId: null, // AC4: người gỡ CHÍNH là tác giả ⇒ không có tin SYSTEM
      };
      await broadcastDeleted(data, recipientIds);

      return {
        entityId: m.messageId,
        data,
        // KHÔNG ghi nội dung tin vào AuditLog (nhật ký quản trị không phải bản sao hội thoại).
        oldValues: { deletedAt: null },
        newValues: {
          deletedAt: deletedAt.toISOString(),
          conversationId: m.conversationId,
          kind: m.kind,
          selfRecall: true,
        },
        orgUnitId: m.orgUnitId,
      };
    },
  };
}

// ─── ActionConfig: gỡ tin (kiểm duyệt) ──────────────────────────────────────

function buildModerateConfig(
  ctx: ModerationContext | null,
): ActionConfig<DeleteMessageAsModeratorInput, DeletedChatMessage> {
  return {
    name: "chat.deleteMessage",
    permission: "chat:moderate",
    schema: deleteMessageAsModeratorSchema,
    target: () => moderateTargetOf(ctx),
    // Chốt chặn thứ hai cho lý do bắt buộc (zod đã chặn trước — `runAction` chạy zod
    // rồi mới tới đây). Để lại vì nó là chỗ DUY NHẤT `reason` đi vào AuditLog: nếu
    // mai ai đó đổi schema thành optional, action này vẫn từ chối thay vì ghi audit rỗng.
    requireReason: true,
    module: "chat",
    entityType: "Message",
    auditAction: "DELETE",
    handler: async ({ actor, input }) => {
      const guard = checkModeratable(ctx);
      if (guard) throw new ActionError(guard.code, guard.message);
      const m = ctx as ModerationContext;

      const deletedAt = new Date();
      const withNotice = needsSystemNotice(m, actor.userId);

      // Soft delete + tin SYSTEM đi CÙNG MỘT transaction (AC4): không được có trạng
      // thái "đã gỡ mà nhóm không hay biết", cũng không được có thông báo gỡ cho một
      // tin vẫn hiện nguyên.
      // timeout 30s / maxWait 10s theo luật E-bis #2 — trần 5s mặc định của Prisma đứt
      // giữa chừng khi pooler chậm.
      const tx0 = await db.$transaction(
        async (tx) => {
          const updated = await tx.message.updateMany({
            // `deletedAt: null` — chống đua, xem ghi chú ở đường thu hồi.
            // ⚠️ KHÔNG đụng `body` (AC3).
            where: { id: m.messageId, deletedAt: null },
            data: { deletedAt, deletedById: actor.userId, deletedReason: input.reason },
          });
          if (updated.count === 0) {
            throw new ActionError(
              "MESSAGE_ALREADY_DELETED",
              "Tin nhắn này đã được gỡ trước đó.",
            );
          }

          let systemMessageId: string | null = null;
          if (withNotice) {
            const sys = await tx.message.create({
              data: {
                conversationId: m.conversationId,
                kind: "SYSTEM",
                senderId: null,
                body: MODERATION_SYSTEM_MESSAGE,
              },
              select: { id: true },
            });
            // Nhóm vừa có tin mới → danh sách hội thoại phải nổi lên đúng chỗ
            // (cùng cách `lib/chat/sync-membership.ts` xử lý tin SYSTEM của nó).
            await tx.conversation.update({
              where: { id: m.conversationId },
              data: { lastMessageAt: deletedAt },
            });
            systemMessageId = sys.id;
          }

          // ⚠️ ĐẶT SAU `conversation.update` có chủ đích: đường gửi tin khoá theo thứ tự
          // Message → Conversation → ConversationParticipant. Khoá participant TRƯỚC
          // Conversation ở đây là dựng ngược thứ tự ⇒ mở cửa cho deadlock giữa "gửi tin"
          // và "gỡ tin" trên cùng một hội thoại.
          const recipientIds = await lockAndReadRecipients(tx, m.conversationId, actor.userId);
          return { systemMessageId, recipientIds };
        },
        { timeout: 30_000, maxWait: 10_000 },
      );

      const data: DeletedChatMessage = {
        id: m.messageId,
        conversationId: m.conversationId,
        senderId: m.senderId,
        deletedAt,
        deletedById: actor.userId,
        systemMessageId: tx0.systemMessageId,
      };
      await broadcastDeleted(data, tx0.recipientIds);

      return {
        entityId: m.messageId,
        data,
        // `reason` đi vào cột `AuditLog.reason` qua `runAction` (không lặp ở đây).
        oldValues: { deletedAt: null },
        newValues: {
          deletedAt: deletedAt.toISOString(),
          conversationId: m.conversationId,
          kind: m.kind,
          messageAuthorId: m.senderId,
          systemNoticeCreated: tx0.systemMessageId !== null,
        },
        orgUnitId: m.orgUnitId,
      };
    },
  };
}

// ─── Lõi + Server Action ────────────────────────────────────────────────────

/**
 * messageId lấy từ input THÔ (preload chạy trước zod của `runAction`) — chỉ nhận dạng
 * UUID, đúng dạng `Message.id`. Sai dạng → bỏ qua preload, để zod báo VALIDATION.
 */
function extractMessageId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = (raw as { messageId?: unknown }).messageId;
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

/** `reason` cho `runAction` (→ `AuditLog.reason`). Zod vẫn là nơi quyết định hợp lệ. */
function extractReason(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = (raw as { reason?: unknown }).reason;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Lõi THUẦN NGỮ CẢNH — nhận Actor đã resolve, không chạm `auth()`/HTTP.
 * Test/script gọi thẳng hàm này với actor seed (như `runAction` của factory).
 */
export async function recallOwnMessageAsActor(
  actor: Actor,
  actorName: string,
  rawInput: unknown,
): Promise<ActionResult<DeletedChatMessage>> {
  const messageId = extractMessageId(rawInput);
  const ctx = messageId ? await loadModerationContext(messageId, actor.userId) : null;
  // 1-1 không có `subjectId` để làm `target.classId` — xem `recallTargetOf`.
  if (ctx && ctx.subjectType !== "CLASS") {
    ctx.dmClassId = await dmWitnessClassId(ctx.conversationId, actor.userId);
  }
  const { res } = await runAction(buildRecallConfig(ctx), actor, rawInput, { actorName });
  return res;
}

/** Lõi THUẦN NGỮ CẢNH của đường kiểm duyệt — xem ghi chú ở `recallOwnMessageAsActor`. */
export async function deleteMessageAsModeratorAsActor(
  actor: Actor,
  actorName: string,
  rawInput: unknown,
): Promise<ActionResult<DeletedChatMessage>> {
  const messageId = extractMessageId(rawInput);
  const ctx = messageId ? await loadModerationContext(messageId, actor.userId) : null;
  const { res } = await runAction(buildModerateConfig(ctx), actor, rawInput, {
    actorName,
    reason: extractReason(rawInput),
  });
  return res;
}

/**
 * AC1 — tác giả tự thu hồi tin trong 15 phút. Không revalidatePath: luồng chat cập
 * nhật bằng realtime, revalidate cả trang sẽ giật màn hình.
 */
export async function recallOwnMessage(
  rawInput: unknown,
): Promise<ActionResult<DeletedChatMessage>> {
  const session = await auth();
  if (!session?.user?.id) return actionFail("AUTH", "Chưa đăng nhập");
  const actor = await resolveActor(session.user.id);
  const actorName = session.user.name ?? session.user.email ?? session.user.id;
  return recallOwnMessageAsActor(actor, actorName, rawInput);
}

/** AC2 + AC4 — GV/Admin gỡ tin người khác, bắt buộc lý do, có tin SYSTEM + audit. */
export async function deleteMessageAsModerator(
  rawInput: unknown,
): Promise<ActionResult<DeletedChatMessage>> {
  const session = await auth();
  if (!session?.user?.id) return actionFail("AUTH", "Chưa đăng nhập");
  const actor = await resolveActor(session.user.id);
  const actorName = session.user.name ?? session.user.email ?? session.user.id;
  return deleteMessageAsModeratorAsActor(actor, actorName, rawInput);
}
