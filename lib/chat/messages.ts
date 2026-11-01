// lib/chat/messages.ts — US-06: gửi tin CHAT (F-SEND, docs/chat-realtime/flows.md).
//
// Đi qua pipeline chuẩn của `lib/actions/factory.ts`:
//   auth → resolveActor → zod → can() → scopedDb → mutation → writeAudit
//
// ⚠️ VÌ SAO KHÔNG GỌI THẲNG `defineAction` (đọc trước khi "sửa lại cho đúng chuẩn"):
// `defineAction` tự resolve Actor BÊN TRONG rồi mới gọi `runAction`, mà `runAction`
// suy `Target` cho `can()` bằng một hàm ĐỒNG BỘ chỉ nhận `input`
// (`target?: (input) => Target`). Quyền chat lại là **participant-based** và target
// của nó phụ thuộc CẢ hội thoại (đọc DB) LẪN chính actor:
//   • PARENT có `chat:send` scope OWN ⇒ chỉ khớp khi `target.createdById === actor.userId`
//     (docs/chat-realtime/permissions.md + lib/auth/chat-permissions.test.ts:170 —
//     "hội thoại CỦA MÌNH"; nhóm lớp thì `Conversation.createdById` là NULL).
//   • TEACHER scope ASSIGNED cần `classId` của lớp, QLCS scope CENTER cần `centerId`
//     — cả hai chỉ có sau khi đọc `Conversation`.
// ⇒ Không có target đồng bộ nào đúng cho cả ba vai. Nên file này tự làm đúng 3 việc
// mà `defineAction` làm (auth → resolveActor → runAction; KHÔNG có revalidatePath vì
// luồng chat cập nhật bằng realtime), rồi giao TOÀN BỘ phần còn lại cho `runAction`.
// Việc kiểm quyền vẫn đi qua DUY NHẤT `can()` (luật Nền Hệ thống #1) — không có
// điều kiện quyền viết tay ở đây.
// Hướng dọn nợ (ngoài phạm vi US-06): cho `ActionConfig.target` nhận thêm `actor` và
// cho phép async, khi đó file này quay về `defineAction` một dòng.
//
// ⚠️ VÌ SAO KHÔNG CÓ `"use server"` Ở ĐẦU FILE: luật E-bis #1 — module `"use server"`
// chỉ được export async function (mọi export khác bị loader biến thành action rỗng ⇒
// ReferenceError lúc eval, chết cả module). File này còn export schema + 2 hàm THUẦN
// cho test. Khi màn hình chat cần gọi từ Client Component, tạo `_actions.ts` có
// `"use server"` rồi `export { sendChatMessage } from "@/lib/chat/messages"`.
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
import { rateLimit } from "@/lib/rate-limit";
import {
  broadcastMessages,
  conversationBroadcast,
  userBumpBroadcasts,
} from "@/lib/chat/broadcast";
// US-11 — CHỈ dùng phần THUẦN của `lib/chat/attachments.ts` (luật key + gói cắt định dạng).
// KHÔNG chạm R2 ở file này: việc ký URL đã xong ở bước 1 của F-FILE.
import { CHAT_IMAGE_RULES, buildChatAttachmentKey } from "@/lib/chat/attachments";
// US-13 — lớp làm chứng của hội thoại 1-1, nguồn DUY NHẤT của `target.classId` cho DM.
import { dmWitnessClassId } from "@/lib/chat/dm";

/** AC1 — 20 tin/phút/user. */
export const CHAT_SEND_RATE_MAX = 20;
const CHAT_SEND_RATE_WINDOW_MS = 60_000;
/** AC5 — trần độ dài nội dung, chặn ở CẢ server (không tin client). */
export const CHAT_BODY_MAX = 4000;

/**
 * Một ảnh đã upload xong ở bước 2 của F-FILE, client khai lại để server ghi
 * `MessageAttachment`. `storagePath` là key R2 lấy TỪ TICKET server đã cấp —
 * nhưng vẫn bị kiểm lại (xem `checkAttachmentPaths`): mọi thứ đi qua client đều
 * là lời khai, kể cả thứ chính server vừa phát ra.
 */
const attachmentInputSchema = z.object({
  storagePath: z.string().min(1).max(512),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(CHAT_IMAGE_RULES.maxSizeBytes, "Ảnh vượt quá dung lượng cho phép"),
});

export const sendChatMessageSchema = z
  .object({
    conversationId: z.uuid("Hội thoại không hợp lệ"),
    // KHÔNG `.min(1)` ở đây nữa: US-11 cho phép tin CHỈ CÓ ẢNH (body rỗng). Luật
    // "rỗng thì phải có ảnh" nằm ở `superRefine` bên dưới để lỗi vẫn gắn vào field
    // `body` (client đang bám `error.field` để tô đỏ ô nhập).
    body: z.string().trim().max(CHAT_BODY_MAX, `Tin nhắn tối đa ${CHAT_BODY_MAX} ký tự`),
    /** Client sinh — khoá idempotency + khử trùng khi broadcast dội về (AC4). */
    clientMsgId: z.uuid("clientMsgId phải là UUID"),
    replyToId: z.uuid("Tin được trả lời không hợp lệ").optional(),
    /** US-11 AC1 — tối đa 5 ảnh/tin, khớp `CHAT_IMAGE_RULES.maxFilesPerMessage`. */
    attachments: z
      .array(attachmentInputSchema)
      .max(
        CHAT_IMAGE_RULES.maxFilesPerMessage,
        `Mỗi tin nhắn tối đa ${CHAT_IMAGE_RULES.maxFilesPerMessage} ảnh`,
      )
      .optional(),
  })
  .superRefine((v, ctx) => {
    // QUYẾT ĐỊNH US-11: tin chỉ có ảnh được phép (gửi ảnh không kèm chữ là hành vi
    // bình thường của nhóm lớp). Tin rỗng HOÀN TOÀN thì không — nó chỉ tạo rác.
    if (v.body.length === 0 && (v.attachments?.length ?? 0) === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "Nội dung tin nhắn không được để trống",
      });
    }
  });

export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

/** Ảnh đã ghi `MessageAttachment` — `id` là thứ client đổi lấy signed GET URL (bước 3 F-FILE). */
export type SentAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type SentChatMessage = {
  id: string;
  conversationId: string;
  senderId: string | null;
  kind: string;
  body: string;
  replyToId: string | null;
  clientMsgId: string | null;
  createdAt: Date;
  /** Theo ĐÚNG thứ tự client gửi lên (thứ tự người dùng chọn ảnh). */
  attachments: SentAttachment[];
};

/** Mã lỗi EN + thông điệp VI (quy ước API contract) — client hiển thị nguyên văn message. */
export type ChatSendError = { code: string; message: string };

// ─── Ngữ cảnh gửi tin: hội thoại + tư cách thành viên của CHÍNH người gửi ────

export type SendContext = {
  conversationId: string;
  /** ConversationType dạng text: CLASS_GROUP | DM_TEACHER_PARENT | … */
  type: string;
  /** ConversationStatus dạng text: ACTIVE | ARCHIVED | LOCKED. */
  status: string;
  centerId: string | null;
  orgUnitId: string | null;
  /** ConversationSubjectType dạng text: CLASS | NONE. */
  subjectType: string;
  subjectId: string | null;
  createdById: string | null;
  /** null = người gửi CHƯA từng là thành viên hội thoại này. */
  participantId: string | null;
  /** khác null = đã rời nhóm. */
  participantLeftAt: Date | null;
  /**
   * Hội thoại 1-1: lớp làm chứng cho quan hệ dạy học của CHÍNH người gửi
   * ({@link dmWitnessClassId}). `null` với nhóm lớp (đã có `subjectId`) và với 1-1 hết
   * quan hệ. KHÔNG đọc trong `loadSendContext` — nạp riêng ở {@link sendChatMessageAsActor}
   * để nhóm lớp (đa số lượt gửi) không phải trả thêm một truy vấn nào.
   */
  dmClassId?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Đọc hội thoại + participant của người gửi. **KHÔNG đi qua `scopedDb`** — cùng lý do
 * đã ghi ở `lib/chat/sync-membership.ts` (BẪY scopedDb, luật E-bis #5): tư cách thành
 * viên là dữ kiện MỨC HỆ THỐNG, không phải dữ liệu cần cách ly theo cơ sở. `Conversation`
 * nằm trong `SCOPE_EXEMPT` và `ConversationParticipant` không thuộc `SCOPED_MODELS`, tức
 * hiện tại đi Prisma API cũng không bị lọc — nhưng dùng `$queryRaw` (client extension
 * KHÔNG áp lên raw) để việc này không vỡ nếu mai có ai đưa 2 model đó vào diện scoped:
 * lúc đó GV dạy chéo cơ sở / PH có con chuyển cơ sở sẽ bị hiểu nhầm là "không phải thành
 * viên" và mất quyền nhắn tin mà không có lỗi nào nổi lên.
 * (`$queryRaw` tagged template — KHÔNG dùng `$queryRawUnsafe`, CLAUDE.md cấm.)
 */
async function loadSendContext(
  conversationId: string,
  userId: string,
): Promise<SendContext | null> {
  const rows = await db.$queryRaw<SendContext[]>`
    SELECT c."id"                AS "conversationId",
           c."type"::text        AS "type",
           c."status"::text      AS "status",
           c."centerId",
           c."orgUnitId",
           c."subjectType"::text AS "subjectType",
           c."subjectId",
           c."createdById",
           p."id"                AS "participantId",
           p."leftAt"            AS "participantLeftAt"
    FROM "Conversation" c
    LEFT JOIN "ConversationParticipant" p
      ON p."conversationId" = c."id" AND p."userId" = ${userId}
    WHERE c."id" = ${conversationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ─── PHẦN THUẦN (không DB — unit test được) ─────────────────────────────────

/**
 * Guard F-SEND bước 2 + 3, theo ĐÚNG thứ tự đó.
 *
 * Mã lỗi phải PHÂN BIỆT được (AC1 / TS-03.7): "lớp đã kết thúc" khác hẳn "bạn không
 * còn trong nhóm" — client hiện 2 câu khác nhau, gộp mã là bắt phụ huynh đoán.
 * Hội thoại không tồn tại cũng trả NOT_PARTICIPANT: không xác nhận hộ người lạ rằng
 * một conversationId có tồn tại hay không.
 */
export function checkConversationSendable(ctx: SendContext | null): ChatSendError | null {
  if (!ctx || !ctx.participantId || ctx.participantLeftAt !== null) {
    return {
      code: "NOT_PARTICIPANT",
      message: "Bạn không còn là thành viên của hội thoại này.",
    };
  }
  if (ctx.status === "ARCHIVED") {
    return {
      code: "CONVERSATION_ARCHIVED",
      message: "Lớp đã kết thúc — hội thoại chỉ còn đọc, không gửi tin được.",
    };
  }
  if (ctx.status === "LOCKED") {
    return {
      code: "CONVERSATION_LOCKED",
      message: "Hội thoại đang bị khoá — vui lòng liên hệ quản trị viên.",
    };
  }
  return null;
}

/**
 * Tiền tố key R2 hợp lệ của MỘT hội thoại — **suy ra từ chính `buildChatAttachmentKey`**
 * chứ không chép lại chuỗi `"chat-attachments/<id>/"`.
 *
 * Layout key (và bucket) do `lib/chat/attachments.ts` sở hữu; giữ một bản chép tay ở đây
 * là hẹn giờ cho ngày hai bên lệch nhau — lúc đó MỌI ảnh gửi lên đều bị từ chối mà không
 * ai hiểu vì sao. `null` = không suy được tiền tố ⇒ caller phải TỪ CHỐI (fail-closed),
 * thà chặn hết còn hơn nhận key của hội thoại khác.
 */
export function chatAttachmentPrefix(conversationId: string): string | null {
  let probe: string;
  try {
    probe = buildChatAttachmentKey({
      conversationId,
      mime: "image/jpeg",
      objectId: "probe",
      now: new Date(0),
    });
  } catch {
    return null; // conversationId không qua nổi SAFE_ID của attachments.ts
  }
  const marker = `/${conversationId}/`;
  const at = probe.indexOf(marker);
  return at === -1 ? null : probe.slice(0, at + marker.length);
}

/**
 * ⚠️ CHỐT CHẶN CỦA US-11 — vì sao phải kiểm lại thứ chính server vừa cấp:
 *
 * Bước 1 của F-FILE cấp ticket kèm `storagePath`, bước 3 đổi `MessageAttachment.id` lấy
 * signed GET URL và guard ở đó là "người xin có phải participant của hội thoại CHỨA ảnh".
 * Nếu ở đây tin lời khai, một người là thành viên của CẢ hai nhóm chỉ cần dán key ảnh của
 * nhóm B vào tin gửi ở nhóm A: ảnh đó lập tức thuộc về một tin của nhóm A ⇒ **mọi thành
 * viên nhóm A đọc được ảnh riêng của nhóm B**, và guard bước 3 vẫn xanh vì nó đọc
 * `Message.conversationId` (đã là A). Không có cửa nào khác bắt được việc này.
 *
 * Vì vậy: `storagePath` phải nằm dưới tiền tố của ĐÚNG hội thoại đang gửi, và mime phải
 * thuộc gói cắt (heic/pdf/exe khai bừa rụng tại đây, dù bước 1 đã sniff magic bytes).
 */
export function checkAttachmentPaths(
  conversationId: string,
  attachments: readonly { storagePath: string; mimeType: string }[],
): ChatSendError | null {
  if (attachments.length === 0) return null;

  const prefix = chatAttachmentPrefix(conversationId);
  if (prefix === null) {
    return {
      code: "ATTACHMENT_PATH_MISMATCH",
      message: "Ảnh đính kèm không hợp lệ — vui lòng chọn lại.",
    };
  }

  for (const a of attachments) {
    if (!a.storagePath.startsWith(prefix) || a.storagePath.includes("..")) {
      return {
        code: "ATTACHMENT_PATH_MISMATCH",
        message: "Ảnh đính kèm không thuộc hội thoại này.",
      };
    }
    if (!(CHAT_IMAGE_RULES.allowedMimes as readonly string[]).includes(a.mimeType)) {
      return {
        code: "ATTACHMENT_UNSUPPORTED_TYPE",
        message: "Định dạng chưa hỗ trợ — chỉ nhận ảnh JPG, PNG hoặc WEBP.",
      };
    }
  }
  return null;
}

/** Reply 1 cấp: tin gốc phải nằm trong CHÍNH hội thoại đang gửi (không trích chéo nhóm). */
export function checkReplyTarget(
  conversationId: string,
  reply: { conversationId: string } | null,
): ChatSendError | null {
  if (!reply || reply.conversationId !== conversationId) {
    return {
      code: "REPLY_NOT_IN_CONVERSATION",
      message: "Tin được trả lời không thuộc hội thoại này.",
    };
  }
  return null;
}

/** P2002 (unique) — nhận diện theo `code` để không phụ thuộc instanceof (test mock được). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

function toSent(row: {
  id: string;
  conversationId: string;
  senderId: string | null;
  kind: string;
  body: string;
  replyToId: string | null;
  clientMsgId: string | null;
  createdAt: Date;
  attachments?: SentAttachment[] | null;
}): SentChatMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    kind: row.kind,
    body: row.body,
    replyToId: row.replyToId,
    clientMsgId: row.clientMsgId,
    createdAt: row.createdAt,
    attachments: row.attachments ?? [],
  };
}

const ATTACHMENT_SELECT = {
  id: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
} as const;

/** Tin đã gửi với đúng `clientMsgId` này (khoá idempotency `@@unique([conversationId, senderId, clientMsgId])`). */
async function findByClientMsgId(
  conversationId: string,
  senderId: string,
  clientMsgId: string,
): Promise<SentChatMessage | null> {
  const row = await db.message.findFirst({
    where: { conversationId, senderId, clientMsgId },
    select: {
      id: true,
      conversationId: true,
      senderId: true,
      kind: true,
      body: true,
      replyToId: true,
      clientMsgId: true,
      createdAt: true,
      // Gửi lại cùng `clientMsgId` phải trả ĐÚNG tin cũ, kèm ảnh của nó — nếu không,
      // client lặp lượt gửi (mạng chập) sẽ thấy tin mất ảnh và tưởng upload hỏng.
      attachments: { select: ATTACHMENT_SELECT },
    },
  });
  return row ? toSent(row) : null;
}

// ─── ActionConfig ───────────────────────────────────────────────────────────

/**
 * Target cho `can()`. Đọc kèm khối "VÌ SAO KHÔNG GỌI defineAction" ở đầu file.
 *
 * `createdById = actor.userId` khi người gọi CÓ bản ghi participant — tức hội thoại này
 * là "của mình" theo đúng nghĩa participant-based của module chat (permissions.md; PARENT
 * chỉ có scope OWN nên đây là ô duy nhất khớp cho phụ huynh trong nhóm lớp). Cố ý KHÔNG
 * xét `leftAt` ở đây: người đã rời vẫn qua cổng vai để nhận đúng mã `NOT_PARTICIPANT` từ
 * guard, thay vì `PERMISSION_DENIED` chung chung.
 * `classId`/`centerId` phục vụ scope ASSIGNED (GV) và CENTER (QLCS).
 *
 * ⚠️ NHÓM LỚP LẤY `classId` TỪ `subjectId`, 1-1 LẤY TỪ LỚP LÀM CHỨNG (`dmClassId`) —
 * đừng rút gọn về một nguồn. 1-1 có `subjectType = NONE` nên nếu chỉ đọc `subjectId`
 * thì `classId = null` và GV (scope ASSIGNED) bị `PERMISSION_DENIED` ngay ở cổng vai,
 * trong khi PH gửi được (scope OWN) — đúng bug "hộp câm một chiều" đo được 09/08.
 * Xem `dmWitnessClassId` (lib/chat/dm.ts) để biết vì sao lớp làm chứng là câu trả lời
 * đúng thay vì nới ma trận quyền.
 */
function sendTargetOf(ctx: SendContext | null, actor: Actor) {
  return {
    createdById: ctx?.participantId ? actor.userId : (ctx?.createdById ?? null),
    classId:
      ctx?.subjectType === "CLASS" ? (ctx.subjectId ?? null) : (ctx?.dmClassId ?? null),
    centerId: ctx?.centerId ?? null,
  };
}

function buildSendChatMessageConfig(
  ctx: SendContext | null,
  actor: Actor,
): ActionConfig<SendChatMessageInput, SentChatMessage> {
  return {
    name: "chat.sendMessage",
    permission: "chat:send",
    schema: sendChatMessageSchema,
    target: () => sendTargetOf(ctx, actor),
    module: "chat",
    entityType: "Message",
    auditAction: "CREATE",
    handler: async ({ input }) => {
      // ── F-SEND bước 2 + 3: participant hiệu lực → trạng thái hội thoại ──
      const guard = checkConversationSendable(ctx);
      if (guard) throw new ActionError(guard.code, guard.message);
      const conv = ctx as SendContext;

      // ── F-SEND bước 4: rate limit 20 tin/phút/user ──
      const limit = await rateLimit({
        key: `chat:send:${actor.userId}`,
        max: CHAT_SEND_RATE_MAX,
        windowMs: CHAT_SEND_RATE_WINDOW_MS,
      });
      if (!limit.success) {
        const giay = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
        throw new ActionError(
          "RATE_LIMITED",
          `Bạn gửi tin quá nhanh (tối đa ${CHAT_SEND_RATE_MAX} tin/phút). Vui lòng thử lại sau ${giay} giây.`,
        );
      }

      // ── AC4: gửi lại cùng clientMsgId → trả CHÍNH tin cũ ──
      // Kiểm TRƯỚC transaction có chủ đích: bắt P2002 *bên trong* tx là vô nghĩa vì
      // Postgres đánh dấu transaction hỏng ngay khi một câu lệnh lỗi, mọi truy vấn sau
      // đó trong tx đều chết ("current transaction is aborted").
      const replay = await findByClientMsgId(
        input.conversationId,
        actor.userId,
        input.clientMsgId,
      );
      if (replay) {
        return {
          entityId: replay.id,
          data: replay,
          newValues: {
            conversationId: input.conversationId,
            clientMsgId: input.clientMsgId,
            idempotentReplay: true,
          },
          orgUnitId: conv.orgUnitId,
        };
      }

      // ── US-11: ảnh đính kèm phải thuộc CHÍNH hội thoại này (đọc `checkAttachmentPaths`) ──
      const attachments = input.attachments ?? [];
      const attErr = checkAttachmentPaths(input.conversationId, attachments);
      if (attErr) throw new ActionError(attErr.code, attErr.message, "attachments");

      // ── Reply 1 cấp: tin gốc phải cùng hội thoại ──
      if (input.replyToId) {
        const reply = await db.message.findUnique({
          where: { id: input.replyToId },
          select: { conversationId: true },
        });
        const replyErr = checkReplyTarget(input.conversationId, reply);
        if (replyErr) throw new ActionError(replyErr.code, replyErr.message, "replyToId");
      }

      // ── F-SEND bước 5: transaction (message + lastMessageAt + unreadCount) ──
      // timeout 30s/maxWait 10s theo luật E-bis #2 (trần 5s mặc định của Prisma đứt
      // giữa chừng khi pooler chậm ⇒ tin mất mà UI báo thành công).
      let created: SentChatMessage;
      let recipientIds: string[];
      try {
        const tx0 = await db.$transaction(
          async (tx) => {
            const msg = await tx.message.create({
              data: {
                conversationId: input.conversationId,
                senderId: actor.userId,
                kind: "CHAT",
                body: input.body,
                replyToId: input.replyToId ?? null,
                clientMsgId: input.clientMsgId,
              },
              select: {
                id: true,
                conversationId: true,
                senderId: true,
                kind: true,
                body: true,
                replyToId: true,
                clientMsgId: true,
                createdAt: true,
              },
            });

            // ⚠️ `MessageAttachment` ghi TRONG CHÍNH transaction gửi tin (F-FILE bước 3
            // cần `attachmentId` để cấp signed GET URL). Ghi ngoài tx thì tin rollback mà
            // hàng attachment còn lại = rác trỏ vào messageId không tồn tại, và không có
            // ai đi dọn. Tạo tuần tự (≤5 ảnh) thay vì `createMany` vì cần `id` trả về
            // ĐÚNG THỨ TỰ người dùng chọn ảnh.
            const savedAttachments: SentAttachment[] = [];
            for (const a of attachments) {
              const row = await tx.messageAttachment.create({
                data: {
                  messageId: msg.id,
                  storagePath: a.storagePath,
                  fileName: a.fileName,
                  mimeType: a.mimeType,
                  sizeBytes: a.sizeBytes,
                },
                select: ATTACHMENT_SELECT,
              });
              savedAttachments.push(row);
            }

            await tx.conversation.update({
              where: { id: input.conversationId },
              data: { lastMessageAt: msg.createdAt },
            });

            // +1 cho MỌI thành viên còn hiệu lực TRỪ người gửi (AC2).
            await tx.conversationParticipant.updateMany({
              where: {
                conversationId: input.conversationId,
                leftAt: null,
                userId: { not: actor.userId },
              },
              data: { unreadCount: { increment: 1 } },
            });

            // Danh sách người nhận bump = ĐÚNG tập vừa được +1. Đặt SAU `updateMany`
            // có chủ đích: `updateMany` đã khoá đúng các dòng đó, nên một transaction
            // khác đang set `leftAt` (chuyển lớp / gỡ phân công / syncConversationMembership)
            // phải chờ ta commit ⇒ `findMany` trong CÙNG tx thấy đúng tập đã tăng,
            // không có cửa sổ đua "người vừa bị gỡ vẫn nhận bump".
            // Đọc bằng `tx` của `db` TRẦN (không scopedDb) — luật E-bis #5: dẫn xuất
            // thành viên là thao tác mức hệ thống; qua scopedDb thì GV dạy chéo cơ sở
            // biến mất im lặng.
            const recipients = await tx.conversationParticipant.findMany({
              where: {
                conversationId: input.conversationId,
                leftAt: null,
                userId: { not: actor.userId },
              },
              select: { userId: true },
            });

            return {
              sent: toSent({ ...msg, attachments: savedAttachments }),
              recipientIds: recipients.map((r) => r.userId),
            };
          },
          { timeout: 30_000, maxWait: 10_000 },
        );
        created = tx0.sent;
        recipientIds = tx0.recipientIds;
      } catch (err) {
        // Đua 2 tab cùng clientMsgId → unique chặn; đọc lại và trả tin đã có (AC4).
        if (isUniqueViolation(err)) {
          const raced = await findByClientMsgId(
            input.conversationId,
            actor.userId,
            input.clientMsgId,
          );
          if (raced) {
            return {
              entityId: raced.id,
              data: raced,
              newValues: {
                conversationId: input.conversationId,
                clientMsgId: input.clientMsgId,
                idempotentReplay: true,
              },
              orgUnitId: conv.orgUnitId,
            };
          }
        }
        throw err;
      }

      // ── F-SEND bước 6: broadcast SAU commit, NGOÀI transaction (AC3) ──
      // `broadcastMessages` đã cam kết không throw; bọc thêm một lớp ở đây để
      // dù hợp đồng đó có bị phá thì tin ĐÃ commit cũng không biến thành lỗi đỏ.
      // Payload mang `clientMsgId` để client khử trùng với bản optimistic (AC4).
      // MỘT POST duy nhất mang cả kênh hội thoại lẫn N kênh `user:{id}` ⇒ số lời gọi
      // HTTP trong đường gửi tin KHÔNG tăng, độ trễ gửi tin không đổi.
      try {
        await broadcastMessages([
          conversationBroadcast(created.conversationId, "message.created", {
            id: created.id,
            conversationId: created.conversationId,
            senderId: created.senderId,
            kind: created.kind,
            body: created.body,
            replyToId: created.replyToId,
            clientMsgId: created.clientMsgId,
            createdAt: created.createdAt.toISOString(),
            // Người nhận cần biết tin CÓ ảnh ngay lúc broadcast; URL đọc thì họ tự đổi
            // bằng `attachmentId` (bước 3 F-FILE) — không bao giờ đẩy URL đã ký qua kênh
            // broadcast, nó sống 5 phút và ai nghe được topic cũng dùng được.
            attachments: created.attachments,
          }),
          // Tín hiệu nhẹ cho badge + danh sách của người KHÔNG mở hội thoại này.
          // KHÔNG có nội dung tin (BR-30) — client tự hỏi lại server.
          ...userBumpBroadcasts(recipientIds, {
            conversationId: created.conversationId,
            messageId: created.id,
            kind: "CHAT",
            at: created.createdAt.toISOString(),
          }),
        ]);
      } catch (err) {
        console.warn("[chat/sendMessage] broadcast lỗi — tin vẫn đã lưu:", err);
      }

      return {
        entityId: created.id,
        data: created,
        // KHÔNG ghi nội dung tin vào AuditLog (nhật ký quản trị không phải bản sao hội thoại).
        newValues: {
          conversationId: created.conversationId,
          kind: created.kind,
          clientMsgId: created.clientMsgId,
          replyToId: created.replyToId,
          bodyLength: created.body.length,
          attachmentCount: created.attachments.length,
        },
        orgUnitId: conv.orgUnitId,
      };
    },
  };
}

// ─── Lõi + Server Action ────────────────────────────────────────────────────

/**
 * conversationId lấy từ input THÔ (preload chạy trước zod của `runAction`) — chỉ nhận
 * dạng UUID, đúng dạng `Conversation.id` sinh ra. Sai dạng → bỏ qua preload, để zod
 * báo VALIDATION như thường.
 */
function extractConversationId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = (raw as { conversationId?: unknown }).conversationId;
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

/**
 * Lõi THUẦN NGỮ CẢNH — nhận Actor đã resolve, không chạm `auth()`/HTTP.
 * Test gọi thẳng hàm này với actor seed (như `runAction` của factory).
 */
export async function sendChatMessageAsActor(
  actor: Actor,
  actorName: string,
  rawInput: unknown,
): Promise<ActionResult<SentChatMessage>> {
  const conversationId = extractConversationId(rawInput);
  const ctx = conversationId ? await loadSendContext(conversationId, actor.userId) : null;
  // 1-1 KHÔNG có `subjectId` để làm `target.classId` ⇒ hỏi thêm lớp làm chứng, nếu không
  // GV rụng ở cổng vai (xem `sendTargetOf`). Chỉ chạy cho hội thoại KHÁC nhóm lớp, nên
  // đường gửi tin nhóm lớp — đường nóng nhất — không tốn thêm truy vấn nào.
  if (ctx && ctx.subjectType !== "CLASS") {
    ctx.dmClassId = await dmWitnessClassId(ctx.conversationId, actor.userId);
  }
  const { res } = await runAction(
    buildSendChatMessageConfig(ctx, actor),
    actor,
    rawInput,
    { actorName },
  );
  return res;
}

/**
 * Server Action gửi tin CHAT (F-SEND). Không revalidatePath: luồng chat cập nhật
 * bằng realtime + optimistic render, revalidate cả trang sẽ giật màn hình.
 */
export async function sendChatMessage(
  rawInput: unknown,
): Promise<ActionResult<SentChatMessage>> {
  const session = await auth();
  if (!session?.user?.id) return actionFail("AUTH", "Chưa đăng nhập");
  const actor = await resolveActor(session.user.id);
  const actorName = session.user.name ?? session.user.email ?? session.user.id;
  return sendChatMessageAsActor(actor, actorName, rawInput);
}

// ─── US-11: tra ảnh của một mớ tin (cho tầng hiển thị) ──────────────────────

/** Một ảnh gắn với tin nào — client đổi `id` lấy signed GET URL qua /api/chat/attachment-url. */
export type ChatAttachmentRef = {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

/** Trần số tin hỏi một lượt — chặn client hỏi cả nghìn id trong một round-trip. */
export const CHAT_ATTACHMENT_LOOKUP_MAX = 60;

/**
 * Ảnh của các tin đã cho, TRONG một hội thoại.
 *
 * Vì sao có hàm này thay vì để `lib/chat/queries.ts` trả kèm: tầng đọc trả `ChatMessageView`
 * dùng chung cho danh sách/preview/thông báo, và tuyệt đại đa số tin không có ảnh — gắn
 * thêm một join vào mọi đường đọc là trả giá ở chỗ không cần. Ở đây tra một lượt theo lô
 * id, chỉ cho những tin thật sự đang hiển thị.
 *
 * Guard: không phải participant hiệu lực → trả **mảng rỗng** (không ném): hàm này chỉ nói
 * "tin nào có ảnh", cửa chặn thật là bước 3 của F-FILE (`getChatAttachmentReadUrl`) — nó
 * kiểm participant + tin đã gỡ trước khi ký URL. Trả rỗng cũng không xác nhận hộ người lạ
 * rằng một messageId có tồn tại hay không.
 *
 * Tin đã gỡ bị loại: `deletedAt IS NULL` — ảnh của tin đã gỡ không được hiện lại (US-12 AC5).
 */
export async function listChatAttachments(
  conversationId: string,
  userId: string,
  messageIds: readonly string[],
): Promise<ChatAttachmentRef[]> {
  const ids = Array.from(new Set(messageIds.filter((id) => typeof id === "string" && id.length > 0)));
  if (ids.length === 0) return [];

  // ⚠️ ĐỌC KHÔNG QUA scopedDb — cùng lý do đã ghi ở `loadSendContext` (luật E-bis #5).
  const rows = await db.$queryRaw<{ leftAt: Date | null }[]>`
    SELECT p."leftAt"
    FROM "ConversationParticipant" p
    WHERE p."conversationId" = ${conversationId} AND p."userId" = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0 || rows[0]?.leftAt !== null) return [];

  const found = await db.messageAttachment.findMany({
    where: {
      messageId: { in: ids.slice(0, CHAT_ATTACHMENT_LOOKUP_MAX) },
      // Chặn hỏi chéo hội thoại: id tin của nhóm khác rơi ra khỏi kết quả.
      message: { conversationId, deletedAt: null },
    },
    select: { ...ATTACHMENT_SELECT, messageId: true },
    // Thứ tự chọn ảnh KHÔNG lưu được (không có cột `order`); sắp theo id để hai lần tải
    // cùng một tin luôn ra cùng thứ tự, thay vì nhảy loạn theo thứ tự Postgres trả về.
    orderBy: [{ messageId: "asc" }, { id: "asc" }],
  });
  return found;
}
