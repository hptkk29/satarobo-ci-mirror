// lib/chat/announcements.ts — US-10: gửi & theo dõi ANNOUNCEMENT (F-ANN,
// docs/chat-realtime/flows.md · docs/chat-realtime/backlog · permissions.md).
//
// Bốn việc, một chỗ:
//   1. `sendAnnouncement`      — GV/QLCS/Admin gửi thông báo ghim (AC1) + quota 10/ngày/lớp (AC2)
//   2. `markAnnouncementRead`  — PH đưa thông báo vào viewport → ghi mốc đã đọc (AC3)
//   3. `getAnnouncementReadStats` — "đã đọc 12/30" + ai chưa đọc (AC4)
//   4. `listAnnouncements`     — màn "Xem tất cả thông báo" (US-09 AC2)
//
// ⚠️ AC5 (ANNOUNCEMENT đẩy push tới mọi PH **kể cả đã mute**) KHÔNG làm ở đây.
// Hạ tầng push chưa tồn tại trên repo (0 service worker / 0 VAPID — delta mục D) và
// việc đó là **US-14, Đợt 2**. Chỗ này chỉ để lại ĐIỂM MÓC: mỗi thông báo ghi xong
// publish DomainEvent `chat.announcement_created` vào outbox (`lib/events`) NGAY TRONG
// transaction. Khi US-14 lên, handler chỉ cần `on("chat.announcement_created", …)` —
// KHÔNG phải sửa file này, và không có nguy cơ "gửi push cho tin đã rollback".
// TUYỆT ĐỐI không tự gọi push/ZNS từ đây (luật E.7: side-effect ngoài đi outbox).
// Sự kiện chưa có handler là AN TOÀN: `getHandlers()` trả [] ⇒ dispatcher đánh DONE.
//
// ⚠️ VÌ SAO KHÔNG `defineAction` / KHÔNG `"use server"`: y hệt `lib/chat/messages.ts`
// (đọc khối đầu file đó). Tóm tắt: target của `can()` phụ thuộc dữ liệu ĐỌC TỪ DB nên
// không dựng được bằng hàm đồng bộ chỉ nhận `input`; và luật E-bis #1 cấm export non-async
// trong module `"use server"` (file này export schema + 4 hàm THUẦN cho test). Khi UI cần
// gọi từ Client Component thì tạo `_actions.ts` có `"use server"` rồi re-export.
//
// ⚠️ ĐỌC BẰNG `db` TRẦN, KHÔNG `scopedDb` (luật E-bis #5, cùng lý do đã ghi ở
// `lib/chat/queries.ts`): tư cách thành viên là dữ kiện MỨC HỆ THỐNG. Đi qua scope thì
// GV dạy chéo cơ sở / học viên chuyển cơ sở bị hiểu nhầm là "không phải thành viên".
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor, resolveActorUncached, type Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import {
  runAction,
  actionFail,
  ActionError,
  type ActionConfig,
  type ActionResult,
} from "@/lib/actions/factory";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import {
  broadcastMessages,
  broadcastToConversation,
  conversationBroadcast,
  userBumpBroadcasts,
} from "@/lib/chat/broadcast";
// Guard "participant hiệu lực → trạng thái hội thoại" của F-ANN GIỐNG HỆT F-SEND
// (flows.md: "Khác F-SEND ở: guard vai; quota; push xuyên mute"). Dùng lại đúng hàm
// đó thay vì chép: bảng mã lỗi NOT_PARTICIPANT / CONVERSATION_ARCHIVED /
// CONVERSATION_LOCKED chỉ được phép có MỘT định nghĩa.
import { checkConversationSendable, type SendContext } from "@/lib/chat/messages";
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  isArchivedReadExpired,
  redactContactLike,
  toMessageView,
  type ChatMessageView,
} from "@/lib/chat/queries";
import { rateLimit } from "@/lib/rate-limit";
import { vnAddDays, vnParts, vnStartOfDay } from "@/lib/time/vn";

/** AC2 — trần thông báo mỗi NGÀY (giờ VN) cho mỗi LỚP. */
export const ANNOUNCEMENT_DAILY_QUOTA = 10;

/**
 * F-ANN thừa hưởng **bước 4 của F-SEND**: rate limit 20 thao tác/phút/NGƯỜI
 * (`flows.md` — "Khác F-SEND ở: guard vai; quota; push xuyên mute", tức mọi bước còn
 * lại giữ nguyên). Cùng con số với `CHAT_SEND_RATE_MAX` trong `lib/chat/messages.ts`.
 *
 * ⚠️ Quota 10/ngày/lớp KHÔNG thay thế được cái này: quota đếm theo HỘI THOẠI, nên một
 * GV dạy 10 lớp bắn 10 thông báo trong 2 giây vẫn hợp quota mà vẫn là 10 lượt ghi +
 * 10 lượt broadcast + 10 DomainEvent trong nháy mắt. Rate limit đếm theo NGƯỜI nên bịt
 * đúng khe đó. Bộ đếm riêng (`chat:announce:`), không dùng chung với `chat:send:` —
 * gửi tin thường không được ăn mất lượt gửi thông báo và ngược lại.
 */
export const ANNOUNCEMENT_RATE_MAX = 20;
export const ANNOUNCEMENT_RATE_WINDOW_MS = 60_000;

/** Khoá bộ đếm rate limit — export để test pin đúng định dạng, không chép chuỗi tay. */
export function announcementRateKey(userId: string): string {
  return `chat:announce:${userId}`;
}
/** Trần độ dài, chặn ở CẢ server (không tin client) — cùng mức tin CHAT. */
export const ANNOUNCEMENT_BODY_MAX = 4000;

export const sendAnnouncementSchema = z.object({
  conversationId: z.uuid("Hội thoại không hợp lệ"),
  body: z
    .string()
    .trim()
    .min(1, "Nội dung thông báo không được để trống")
    .max(ANNOUNCEMENT_BODY_MAX, `Thông báo tối đa ${ANNOUNCEMENT_BODY_MAX} ký tự`),
});

export type SendAnnouncementInput = z.infer<typeof sendAnnouncementSchema>;

export type SentAnnouncement = {
  id: string;
  conversationId: string;
  senderId: string | null;
  kind: string;
  body: string;
  createdAt: Date;
};

/** Mã lỗi EN + thông điệp VI (quy ước API contract) — client hiển thị nguyên văn message. */
export type ChatAnnouncementIssue = { code: string; message: string };

/**
 * Lỗi của 3 hàm KHÔNG đi qua `runAction` (mark read / stats / list).
 * Mã theo đúng "QUY ƯỚC MÃ LỖI" chốt 09/08 ở `tests/chat/permission-matrix.spec.ts`:
 *  • `PERMISSION_DENIED` — vai/scope không có quyền (PH xem thống kê đã-đọc).
 *  • `NOT_PARTICIPANT`  — vai ổn nhưng không phải thành viên CÒN HIỆU LỰC của hội
 *    thoại đó. Dùng luôn cho "tin/hội thoại không tồn tại": không xác nhận hộ người
 *    lạ rằng một id có thật hay không.
 *  • `NOT_ANNOUNCEMENT` — id trỏ vào tin CHAT/SYSTEM (chỉ ANNOUNCEMENT mới có sổ đọc).
 */
export class ChatAnnouncementError extends Error {
  constructor(
    readonly code: "NOT_PARTICIPANT" | "PERMISSION_DENIED" | "NOT_ANNOUNCEMENT",
    message: string,
  ) {
    super(message);
    this.name = "ChatAnnouncementError";
  }
}

function notParticipant(): never {
  throw new ChatAnnouncementError(
    "NOT_PARTICIPANT",
    "Bạn không còn là thành viên của hội thoại này.",
  );
}

// ═══ PHẦN THUẦN (không DB — unit test ở announcements.test.ts) ═══════════════

/**
 * AC2 — cửa sổ "hôm nay" theo **lịch Việt Nam**, nửa mở `[start, endExclusive)`.
 *
 * ⚠️ ĐÂY LÀ CHỖ DỄ SAI NHẤT CỦA US-10. Vercel chạy **UTC**, máy dev chạy +07: viết
 * `new Date(y, m, d)` hay `d.getDate()` thì quota reset lúc **07:00 sáng giờ VN** trên
 * prod trong khi ở máy dev reset đúng nửa đêm ⇒ lỗi "chạy máy tôi thì được" y hệt bug
 * sinh buổi học 06/08 (xem khối đầu `lib/time/vn.ts`). Mọi phép tính ở đây đi qua
 * `vnStartOfDay`/`vnAddDays` — số học UTC thuần, KHÔNG đọc TZ tiến trình.
 * `endExclusive` (không phải 23:59:59.999) để không có khe hở mili-giây cuối ngày.
 */
export function vnDayWindow(now: Date): { start: Date; endExclusive: Date } {
  const start = vnStartOfDay(now);
  return { start, endExclusive: vnAddDays(start, 1) };
}

/** "09/08/2026" theo lịch VN — chỉ để dựng thông điệp cho người dùng. */
function vnDateLabel(d: Date): string {
  const p = vnParts(d);
  return `${String(p.day).padStart(2, "0")}/${String(p.month + 1).padStart(2, "0")}/${p.year}`;
}

/**
 * AC2 — vượt trần thì chặn KÈM GỢI Ý GỘP NỘI DUNG (đúng chữ trong AC: "vượt bị chặn
 * kèm gợi ý gộp nội dung" — GV cần biết phải làm gì tiếp, không phải chỉ biết bị chặn).
 */
export function checkAnnouncementQuota(
  sentToday: number,
  now: Date,
): ChatAnnouncementIssue | null {
  if (sentToday < ANNOUNCEMENT_DAILY_QUOTA) return null;
  return {
    code: "ANNOUNCEMENT_QUOTA_EXCEEDED",
    message:
      `Lớp này đã nhận đủ ${ANNOUNCEMENT_DAILY_QUOTA} thông báo trong ngày ${vnDateLabel(now)}. ` +
      "Vui lòng gộp nội dung vào một thông báo, hoặc gửi tiếp vào ngày mai.",
  };
}

/** Người xét vào mẫu số "đã đọc x/N" (AC4). */
export type RecipientCandidate = {
  /** `ConversationParticipant.derivedFrom` — nguồn sự thật về TƯ CÁCH trong nhóm. */
  derivedFrom?: string | null;
  /** Vai tài khoản (`User.role` / `User.roles`) — chỉ dùng khi derivedFrom trống. */
  role?: string | null;
  roles?: readonly string[] | null;
};

/**
 * AC4 — mẫu số của "đã đọc x/N" là **PH**, không đếm GV/QLCS: họ là người GỬI thông
 * báo, đếm họ vào thì "đã đọc 1/32" luôn lệch và GV mất niềm tin vào con số.
 *
 * `derivedFrom` THẮNG vai tài khoản: một người vừa là GV vừa là PH đứng trong nhóm với
 * đúng MỘT tư cách (sync-membership ưu tiên CLASS_TEACHER) — đếm theo tư cách đó.
 * Participant thêm TAY (`derivedFrom = null`) mới rơi về vai tài khoản; không có nhánh
 * này thì nhóm dựng tay ra "đã đọc 0/0" — con số vô nghĩa. Không nhận ra là gì → KHÔNG
 * đếm (thà mẫu số nhỏ hơn thực tế còn hơn báo nhầm rằng có người chưa đọc).
 */
export function isAnnouncementRecipient(p: RecipientCandidate): boolean {
  if (p.derivedFrom) return p.derivedFrom === "CLASS_STUDENT_PARENT";
  if (p.role === "PARENT") return true;
  return p.roles?.includes("PARENT") ?? false;
}

/** Một người chưa đọc — CHỈ tên hiển thị (BR-30). */
export type UnreadMember = { userId: string; displayName: string };

export type AnnouncementReadStats = {
  messageId: string;
  readCount: number;
  totalRecipients: number;
  unreadMembers: UnreadMember[];
};

/**
 * AC4 + **BR-30** — dựng thống kê từ danh sách người nhận và tập đã đọc.
 *
 * Payload trả về CHỈ có `userId` + `displayName`: không `phone`, không `email`, không
 * `address` — và tên hiển thị còn đi qua `redactContactLike` NGAY CẢ KHI người xem là
 * GV/QLCS. Lý do: `User.name` của tài khoản sinh từ lead cũ thường là "PH 0905123456",
 * nên bỏ cột `phone` khỏi select là CHƯA ĐỦ (đường rò đã bắt được ở US-08/TS-04.4).
 * Đây là danh sách để NHẮC, không phải danh bạ — GV cần số thì mở danh sách thành viên
 * (`getConversationMembers`), nơi quyền xem liên hệ được quyết định đúng một chỗ.
 *
 * `readCount` chỉ đếm giao của "đã đọc" với "người nhận": GV bấm xem thông báo cũng
 * sinh `AnnouncementRead`, đếm cả họ thì có ngày ra "đã đọc 33/32".
 * Thứ tự chưa-đọc tất định (tên → userId) để danh sách không nhảy giữa 2 lần tải.
 */
export function buildReadStats(input: {
  messageId: string;
  recipients: { userId: string; name: string | null }[];
  readUserIds: Iterable<string>;
}): AnnouncementReadStats {
  const read = new Set(input.readUserIds);
  const unreadMembers = input.recipients
    .filter((r) => !read.has(r.userId))
    .map((r) => {
      const raw = r.name?.trim() ? r.name.trim() : "Thành viên";
      return { userId: r.userId, displayName: redactContactLike(raw) };
    })
    .sort((a, b) =>
      a.displayName === b.displayName
        ? a.userId.localeCompare(b.userId)
        : a.displayName.localeCompare(b.displayName, "vi"),
    );
  return {
    messageId: input.messageId,
    readCount: input.recipients.filter((r) => read.has(r.userId)).length,
    totalRecipients: input.recipients.length,
    unreadMembers,
  };
}

// ═══ PHẦN DB ════════════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Field tin nhắn cần cho `toMessageView` (US-09 AC2). */
const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  kind: true,
  senderId: true,
  body: true,
  replyToId: true,
  clientMsgId: true,
  createdAt: true,
  deletedAt: true,
} as const;

/**
 * Bản sinh đôi của `loadSendContext` trong `lib/chat/messages.ts` (hàm đó không export).
 * Giữ nguyên `$queryRaw` tagged template — Prisma client extension KHÔNG áp lên raw, nên
 * việc này không vỡ nếu mai có ai đưa `Conversation`/`ConversationParticipant` vào
 * `SCOPED_MODELS`. (`$queryRawUnsafe` bị CLAUDE.md cấm.)
 */
async function loadAnnouncementContext(
  conversationId: string,
  userId: string,
): Promise<SendContext | null> {
  const rows = await db.$queryRaw<SendContext[]>`
    SELECT c."id"                AS "conversationId",
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

/**
 * Target cho `can()`.
 *
 * KHÁC `sendTargetOf` của tin CHAT ở chỗ **cố ý KHÔNG có `createdById`**: quyền
 * ANNOUNCEMENT là quyền theo VAI (permissions.md — GV/QLCS/Admin ✅, PH ❌), không bao
 * giờ là "hội thoại của mình". Bỏ `createdById` đi thì một grant `chat:announce` scope
 * OWN cấp nhầm cho PH cũng KHÔNG mở được cửa — fail-closed.
 * `classId` phục vụ scope ASSIGNED (GV), `centerId` phục vụ scope CENTER (QLCS).
 */
function announceTargetOf(ctx: SendContext | null) {
  return {
    classId: ctx?.subjectType === "CLASS" ? (ctx.subjectId ?? null) : null,
    centerId: ctx?.centerId ?? null,
  };
}

function buildSendAnnouncementConfig(
  ctx: SendContext | null,
  actor: Actor,
): ActionConfig<SendAnnouncementInput, SentAnnouncement> {
  return {
    name: "chat.sendAnnouncement",
    permission: "chat:announce",
    schema: sendAnnouncementSchema,
    target: () => announceTargetOf(ctx),
    module: "chat",
    entityType: "Message",
    auditAction: "CREATE",
    handler: async ({ input }) => {
      // ── F-ANN: participant hiệu lực → trạng thái hội thoại (dùng lại guard F-SEND) ──
      const guard = checkConversationSendable(ctx);
      if (guard) throw new ActionError(guard.code, guard.message);
      const conv = ctx as SendContext;

      // ── F-ANN kế thừa F-SEND bước 4: rate limit 20/phút/NGƯỜI ──
      // Đặt TRƯỚC transaction (và trước quota) có chủ đích: chặn ở đây thì không mở
      // transaction, không đếm quota, không ghi gì — rẻ nhất và không để lại rác.
      const limit = await rateLimit({
        key: announcementRateKey(actor.userId),
        max: ANNOUNCEMENT_RATE_MAX,
        windowMs: ANNOUNCEMENT_RATE_WINDOW_MS,
      });
      if (!limit.success) {
        const giay = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
        throw new ActionError(
          "RATE_LIMITED",
          `Bạn gửi thông báo quá nhanh (tối đa ${ANNOUNCEMENT_RATE_MAX} thông báo/phút). Vui lòng thử lại sau ${giay} giây.`,
        );
      }

      const now = new Date();
      const day = vnDayWindow(now);

      // ── Transaction (E-bis #2: timeout 30s/maxWait 10s — trần 5s mặc định của Prisma
      // đứt giữa chừng khi pooler chậm ⇒ tin mất mà UI báo thành công) ──
      // ActionError ném từ trong tx (quota) đi thẳng ra `runAction` → ActionResult lỗi,
      // và tx tự rollback ⇒ không có tin nào lọt qua hàng rào quota.
      let sentTodayBefore = 0;
      let recipientIds: string[] = [];
      const created: SentAnnouncement = await db.$transaction(
          async (tx) => {
            // AC2 — quota tính TRÊN HỘI THOẠI, mà nhóm lớp ↔ lớp là 1-1
            // (`Conversation @@unique(type, subjectType, subjectId)`) nên đếm theo
            // conversationId CHÍNH LÀ "10/ngày/lớp".
            // Đếm cả tin đã GỠ có chủ đích: thông báo đã bắn đi rồi, cho phép gỡ để lấy
            // lại lượt là biến quota thành hàng rào giấy.
            // Đếm TRONG tx thu hẹp cửa sổ đua 2 tab, nhưng READ COMMITTED không khoá —
            // đây là hàng rào chống spam, không phải bất biến tiền bạc, nên không đẩy
            // lên SERIALIZABLE (đắt) chỉ vì tình huống bấm-đúp.
            sentTodayBefore = await tx.message.count({
              where: {
                conversationId: input.conversationId,
                kind: "ANNOUNCEMENT",
                createdAt: { gte: day.start, lt: day.endExclusive },
              },
            });
            const quota = checkAnnouncementQuota(sentTodayBefore, now);
            if (quota) throw new ActionError(quota.code, quota.message);

            const msg = await tx.message.create({
              data: {
                conversationId: input.conversationId,
                senderId: actor.userId,
                kind: "ANNOUNCEMENT",
                body: input.body,
              },
              select: {
                id: true,
                conversationId: true,
                senderId: true,
                kind: true,
                body: true,
                createdAt: true,
              },
            });

            await tx.conversation.update({
              where: { id: input.conversationId },
              data: { lastMessageAt: msg.createdAt },
            });

            // +1 cho MỌI thành viên còn hiệu lực TRỪ người gửi — như tin thường.
            await tx.conversationParticipant.updateMany({
              where: {
                conversationId: input.conversationId,
                leftAt: null,
                userId: { not: actor.userId },
              },
              data: { unreadCount: { increment: 1 } },
            });

            // Người nhận bump = ĐÚNG tập vừa được +1, đọc SAU `updateMany` trong CÙNG
            // tx: `updateMany` đã khoá các dòng đó nên một tx khác đang set `leftAt`
            // phải chờ ta commit ⇒ người vừa bị gỡ không lọt vào danh sách bump.
            // `tx` của `db` TRẦN (không scopedDb) — luật E-bis #5.
            const recipients = await tx.conversationParticipant.findMany({
              where: {
                conversationId: input.conversationId,
                leftAt: null,
                userId: { not: actor.userId },
              },
              select: { userId: true },
            });
            recipientIds = recipients.map((r) => r.userId);

            // AC5 — ĐIỂM MÓC push/ZNS "xuyên mute" (US-14, Đợt 2). Trong tx ⇒ rollback
            // tin thì không còn event; `dedupeKey` ⇒ retry không đẻ event trùng.
            await publishEvent(
              "chat.announcement_created",
              {
                messageId: msg.id,
                conversationId: msg.conversationId,
                senderId: msg.senderId,
                classId: conv.subjectType === "CLASS" ? conv.subjectId : null,
                centerId: conv.centerId,
                createdAt: msg.createdAt.toISOString(),
              },
              { tx, dedupeKey: `chat.announcement_created:${msg.id}` },
            );

            return {
              id: msg.id,
              conversationId: msg.conversationId,
              senderId: msg.senderId,
              kind: msg.kind,
              body: msg.body,
              createdAt: msg.createdAt,
            };
          },
          { timeout: 30_000, maxWait: 10_000 },
      );

      // ── Broadcast SAU commit, NGOÀI transaction, fail-and-forget (AC3) ──
      // `broadcastMessages` đã cam kết không throw; bọc thêm một lớp để dù hợp
      // đồng đó bị phá thì thông báo ĐÃ commit cũng không biến thành lỗi đỏ.
      // MỘT POST mang cả kênh hội thoại lẫn N kênh `user:{id}`.
      // ⚠️ Bump KHÔNG thay `publishEvent("chat.announcement_created")` ở trên: outbox là
      // đường của push/ZNS (US-14), realtime KHÔNG bao giờ đi qua outbox.
      try {
        await broadcastMessages([
          conversationBroadcast(created.conversationId, "announcement.created", {
            id: created.id,
            conversationId: created.conversationId,
            senderId: created.senderId,
            kind: created.kind,
            body: created.body,
            createdAt: created.createdAt.toISOString(),
          }),
          ...userBumpBroadcasts(recipientIds, {
            conversationId: created.conversationId,
            messageId: created.id,
            kind: "ANNOUNCEMENT",
            at: created.createdAt.toISOString(),
          }),
        ]);
      } catch (err) {
        console.warn("[chat/sendAnnouncement] broadcast lỗi — thông báo vẫn đã lưu:", err);
      }

      return {
        entityId: created.id,
        data: created,
        // KHÔNG ghi nội dung vào AuditLog (nhật ký quản trị không phải bản sao hội thoại).
        newValues: {
          conversationId: created.conversationId,
          kind: created.kind,
          bodyLength: created.body.length,
          sentTodayBefore,
        },
        orgUnitId: conv.orgUnitId,
      };
    },
  };
}

function extractConversationId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = (raw as { conversationId?: unknown }).conversationId;
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

/** Lõi THUẦN NGỮ CẢNH — nhận Actor đã resolve, không chạm `auth()`/HTTP (test gọi thẳng). */
export async function sendAnnouncementAsActor(
  actor: Actor,
  actorName: string,
  rawInput: unknown,
): Promise<ActionResult<SentAnnouncement>> {
  const conversationId = extractConversationId(rawInput);
  const ctx = conversationId
    ? await loadAnnouncementContext(conversationId, actor.userId)
    : null;
  const { res } = await runAction(
    buildSendAnnouncementConfig(ctx, actor),
    actor,
    rawInput,
    { actorName },
  );
  return res;
}

/**
 * Server Action gửi ANNOUNCEMENT (F-ANN). Không revalidatePath: luồng chat cập nhật
 * bằng realtime + optimistic render.
 */
export async function sendAnnouncement(
  rawInput: unknown,
): Promise<ActionResult<SentAnnouncement>> {
  const session = await auth();
  if (!session?.user?.id) return actionFail("AUTH", "Chưa đăng nhập");
  const actor = await resolveActor(session.user.id);
  const actorName = session.user.name ?? session.user.email ?? session.user.id;
  return sendAnnouncementAsActor(actor, actorName, rawInput);
}

// ─── AC3: đánh dấu đã đọc ───────────────────────────────────────────────────

export type AnnouncementReadReceipt = {
  messageId: string;
  userId: string;
  readAt: Date;
  /** true = đã có mốc từ trước; gọi lại KHÔNG đổi `readAt` (idempotent). */
  alreadyRead: boolean;
};

/** Tin + hội thoại tối thiểu để quyết định quyền — dùng chung mark-read và stats. */
type AnnouncementRef = {
  messageId: string;
  conversationId: string;
  kind: string;
  centerId: string | null;
  subjectType: string;
  subjectId: string | null;
};

async function loadAnnouncementRef(messageId: string): Promise<AnnouncementRef | null> {
  const msg = await db.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      conversationId: true,
      kind: true,
      conversation: { select: { centerId: true, subjectType: true, subjectId: true } },
    },
  });
  if (!msg) return null;
  return {
    messageId: msg.id,
    conversationId: msg.conversationId,
    kind: msg.kind,
    centerId: msg.conversation.centerId,
    subjectType: msg.conversation.subjectType,
    subjectId: msg.conversation.subjectId,
  };
}

/**
 * Cổng chặn chung: phải là thành viên CÒN HIỆU LỰC (`leftAt IS NULL`) của hội thoại.
 * Người đã rời bị chặn NGAY, không ân hạn (TS-01.7).
 *
 * **BR-04** áp y hệt tầng đọc (`lib/chat/queries.ts`): hội thoại ARCHIVED quá 90 ngày
 * thì PH hết quyền đọc — kể cả đường thông báo. Không lặp lại quy tắc ở đây, gọi thẳng
 * `isArchivedReadExpired` để chỉ có MỘT định nghĩa của "quá hạn".
 */
async function assertActiveParticipant(
  conversationId: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const p = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: {
      leftAt: true,
      derivedFrom: true,
      conversation: { select: { status: true, archivedAt: true } },
    },
  });
  if (!p || p.leftAt !== null) notParticipant();
  if (
    isArchivedReadExpired({
      status: p.conversation.status,
      archivedAt: p.conversation.archivedAt,
      derivedFrom: p.derivedFrom,
      now,
    })
  ) {
    notParticipant();
  }
}

/**
 * AC3 — ghi mốc "PH đã đọc thông báo". UI gọi khi thông báo vào **viewport**, không
 * phải lúc mở app (F-ANN) — server không tự suy ra được điều đó nên đây là hợp đồng
 * của tầng gọi.
 *
 * **Idempotent**: gọi lại giữ NGUYÊN `readAt` cũ. Không dùng `upsert` với `update: {}`
 * mà đọc-rồi-ghi có chủ đích — cần biết lần này có THỰC SỰ mới hay không để không
 * broadcast lại mỗi lần PH cuộn qua thông báo (30 PH × mỗi lần cuộn = bão event).
 * Đua 2 tab → P2002 → đọc lại bản ghi đã có, không ném lỗi ra người dùng.
 */
export async function markAnnouncementRead(
  messageId: string,
  userId: string,
): Promise<AnnouncementReadReceipt> {
  const ref = await loadAnnouncementRef(messageId);
  if (!ref) notParticipant(); // không lộ tin có tồn tại hay không
  await assertActiveParticipant(ref.conversationId, userId);
  if (ref.kind !== "ANNOUNCEMENT") {
    throw new ChatAnnouncementError(
      "NOT_ANNOUNCEMENT",
      "Chỉ thông báo mới có sổ theo dõi đã đọc.",
    );
  }

  const existing = await db.announcementRead.findUnique({
    where: { messageId_userId: { messageId, userId } },
    select: { readAt: true },
  });
  if (existing) {
    return { messageId, userId, readAt: existing.readAt, alreadyRead: true };
  }

  let readAt: Date;
  try {
    const row = await db.announcementRead.create({
      data: { messageId, userId },
      select: { readAt: true },
    });
    readAt = row.readAt;
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002") {
      const raced = await db.announcementRead.findUnique({
        where: { messageId_userId: { messageId, userId } },
        select: { readAt: true },
      });
      if (raced) return { messageId, userId, readAt: raced.readAt, alreadyRead: true };
    }
    throw err;
  }

  // AC4 "cập nhật không cần reload": báo cho GV/QLCS đang mở bảng thống kê. Chỉ bắn ở
  // lần đọc ĐẦU TIÊN. Fail-and-forget — mốc đã đọc đã nằm trong DB.
  try {
    await broadcastToConversation(ref.conversationId, "announcement.read", {
      messageId,
      userId,
      readAt: readAt.toISOString(),
    });
  } catch (err) {
    console.warn("[chat/markAnnouncementRead] broadcast lỗi — mốc đọc vẫn đã lưu:", err);
  }

  return { messageId, userId, readAt, alreadyRead: false };
}

// ─── AC4: thống kê đã đọc ───────────────────────────────────────────────────

/**
 * AC4 — "đã đọc 12/30" + danh sách ai chưa đọc.
 *
 * Cổng quyền là `chat:announce` (permissions.md, hàng "Xem đã-đọc ANNOUNCEMENT":
 * GV/QLCS/Admin ✅, **PH ❌**) — cùng một quyền với việc gửi, vì đây là mặt sau của
 * chính thao tác đó. Thứ tự kiểm: participant TRƯỚC, quyền SAU — nhờ vậy PH trong
 * nhóm nhận đúng `PERMISSION_DENIED` ("bạn không có quyền này") chứ không phải
 * `NOT_PARTICIPANT` ("bạn không còn trong nhóm"), hai câu rất khác nhau với phụ huynh.
 */
export async function getAnnouncementReadStatsAsActor(
  actor: Actor,
  messageId: string,
): Promise<AnnouncementReadStats> {
  const ref = await loadAnnouncementRef(messageId);
  if (!ref) notParticipant();
  await assertActiveParticipant(ref.conversationId, actor.userId);
  if (ref.kind !== "ANNOUNCEMENT") {
    throw new ChatAnnouncementError(
      "NOT_ANNOUNCEMENT",
      "Chỉ thông báo mới có sổ theo dõi đã đọc.",
    );
  }
  if (
    !can(actor, "chat:announce", {
      classId: ref.subjectType === "CLASS" ? ref.subjectId : null,
      centerId: ref.centerId,
    })
  ) {
    throw new ChatAnnouncementError(
      "PERMISSION_DENIED",
      "Bạn không có quyền xem thống kê đã đọc của thông báo này.",
    );
  }

  const participants = await db.conversationParticipant.findMany({
    where: { conversationId: ref.conversationId, leftAt: null },
    select: { userId: true, derivedFrom: true },
  });
  if (participants.length === 0) {
    return { messageId, readCount: 0, totalRecipients: 0, unreadMembers: [] };
  }

  const users = await db.user.findMany({
    where: { id: { in: participants.map((p) => p.userId) } },
    // CHỈ 4 cột — `phone`/`email` không được phép rời DB trong luồng này (BR-30).
    select: { id: true, name: true, role: true, roles: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const recipients = participants
    .filter((p) => {
      const u = userById.get(p.userId);
      return isAnnouncementRecipient({
        derivedFrom: p.derivedFrom,
        role: u?.role ?? null,
        roles: u?.roles ?? null,
      });
    })
    .map((p) => ({ userId: p.userId, name: userById.get(p.userId)?.name ?? null }));

  const reads = await db.announcementRead.findMany({
    where: { messageId, userId: { in: recipients.map((r) => r.userId) } },
    select: { userId: true },
  });

  return buildReadStats({
    messageId,
    recipients,
    readUserIds: reads.map((r) => r.userId),
  });
}

/**
 * Bản tiện dụng cho tầng gọi chỉ có `userId`. Dùng `resolveActorUncached` (không phải
 * bản bọc `React.cache`) để hàm này chạy được cả NGOÀI request Next — script ZZTEST,
 * cron, tác vụ nền; cache-theo-request chỉ có nghĩa trong RSC.
 * Tầng gọi vẫn phải `auth()` trước: hàm này KHÔNG tự lấy phiên.
 */
export async function getAnnouncementReadStats(
  messageId: string,
  viewerUserId: string,
): Promise<AnnouncementReadStats> {
  const actor = await resolveActorUncached(viewerUserId);
  return getAnnouncementReadStatsAsActor(actor, messageId);
}

// ─── US-09 AC2: danh sách thông báo ─────────────────────────────────────────

export type AnnouncementPage = {
  /** MỚI → CŨ (cùng chiều với cursor). */
  announcements: ChatMessageView[];
  hasMore: boolean;
  nextCursor: string | null;
};

const MAX_PAGE_SIZE = 100;

/**
 * US-09 AC2 — màn "Xem tất cả thông báo": lọc `kind=ANNOUNCEMENT`, mới nhất trước,
 * phân trang cursor `(createdAt, id)` GIỐNG `getMessagesPage` (không OFFSET: thông báo
 * mới chèn vào giữa lúc cuộn cũng không làm lệch trang). Bám index
 * `Message(conversationId, kind, createdAt DESC)` đã có sẵn trong schema.
 *
 * Tin đã gỡ VẪN nằm trong danh sách nhưng `body` là "Tin nhắn đã được gỡ"
 * (`toMessageView`, US-12 AC3) — giữ đúng một quy tắc hiển thị với luồng chính.
 */
export async function listAnnouncements(
  conversationId: string,
  userId: string,
  opts?: { cursor?: string | null; limit?: number },
): Promise<AnnouncementPage> {
  await assertActiveParticipant(conversationId, userId);

  const limit = Math.min(Math.max(opts?.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor = decodeCursor(opts?.cursor);
  const rows = await db.message.findMany({
    where: {
      conversationId,
      kind: "ANNOUNCEMENT",
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: MESSAGE_SELECT,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    announcements: page.map(toMessageView),
    hasMore,
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}
