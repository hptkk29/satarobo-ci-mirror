// components/chat/chat-store.ts — US-07 (+ US-06 AC4/AC6): TẦNG LOGIC THUẦN của luồng chat.
//
// KHÔNG React, KHÔNG mạng, KHÔNG timer, KHÔNG `Date.now()` ẩn trong nhánh quyết định:
// toàn bộ phần khó của US-07 (khử trùng optimistic, hợp nhất tin đến lộn xộn, mốc đã đọc,
// chính sách thử lại khi mất mạng) nằm ở đây để test được bằng vitest thuần. Hook
// `use-chat-channel.ts` chỉ nối các hàm này với kênh realtime SSE + Server Action.
//
// Bất biến của module (BA §7.3 "trùng tin" + TS-10):
//   1. Một tin nhắn ⇒ ĐÚNG MỘT dòng, dù nó tới bằng cả 3 đường (optimistic, broadcast,
//      kết quả Server Action, reconcile) và tới theo BẤT KỲ thứ tự nào.
//   2. Bản server LUÔN thắng bản optimistic; bản optimistic KHÔNG BAO GIỜ đè bản server
//      (race TS-10.3: broadcast về trước khi Server Action trả về).
//   3. Thứ tự hiển thị = `(createdAt, id)` tăng dần — CÙNG quy tắc với ORDER BY của
//      `lib/chat/queries.ts` để trang tải lại và trang đang mở không bao giờ lệch nhau.

/** Trùng `MessageKind` trong prisma/schema.prisma — khai lại để không kéo `@prisma/client` xuống client bundle. */
export type ChatMessageKind = "CHAT" | "ANNOUNCEMENT" | "SYSTEM";

/**
 * Text thay thế cho tin đã gỡ (US-12 AC3).
 *
 * ⚠️ PHẢI khớp `DELETED_MESSAGE_TEXT` trong `lib/chat/queries.ts`. Cố ý khai lại thay vì
 * import: `queries.ts` import `@/lib/db` (Prisma) nên chạm vào nó từ Client Component là
 * kéo cả Prisma vào bundle. Đổi chuỗi ở một nơi thì đổi cả hai.
 */
export const DELETED_MESSAGE_TEXT = "Tin nhắn đã được gỡ";

/**
 * Câu hiện dưới ô nhập khi hội thoại đang bị Admin khoá (US-15 AC3).
 *
 * ⚠️ PHẢI khớp thông điệp của mã `CONVERSATION_LOCKED` trong `lib/chat/messages.ts` —
 * cùng lý do khai lại như `DELETED_MESSAGE_TEXT` ở trên. Người dùng phải nghe một câu
 * giống nhau dù họ gặp nó qua giao diện (khoá ngay lập tức) hay qua lỗi trả về từ server
 * (client cũ chưa nhận broadcast).
 */
export const CONVERSATION_LOCKED_NOTICE =
  "Hội thoại đang bị khoá — vui lòng liên hệ quản trị viên.";

/** Tiền tố id của bản optimistic — id THẬT do server sinh (uuid) không bao giờ có tiền tố này. */
export const OPTIMISTIC_ID_PREFIX = "tmp:";

/** AC6 — số lần TỰ ĐỘNG thử lại sau lần gửi đầu; hết số này mới chuyển "failed" (nút gửi lại tay). */
export const MAX_AUTO_RETRIES = 3;

/** Backoff cho từng lần tự thử lại (ms). Hàm thuần chỉ TRẢ VỀ số ms — không tự `setTimeout`. */
export const SEND_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const;

export type SendStatus = "sending" | "sent" | "failed";

/** Trạng thái gửi của một tin optimistic. Tin đọc từ server không mang trường này (⇒ "sent"). */
export type SendAttempt = {
  status: SendStatus;
  /** Số lần ĐÃ gửi đi (lần đầu = 1). `attempts - 1` = số lần đã tự thử lại. */
  attempts: number;
  /** Chờ bao lâu rồi thử lại; `null` = không thử lại nữa (đã "sent" hoặc đã "failed"). */
  retryDelayMs: number | null;
};

/** Một dòng trong luồng chat (đã chuẩn hoá). */
export type ChatMessage = {
  /** Id server (uuid) hoặc id tạm `tmp:<clientMsgId>` khi còn optimistic. */
  id: string;
  conversationId: string;
  kind: ChatMessageKind;
  senderId: string | null;
  body: string;
  deleted: boolean;
  replyToId: string | null;
  /** Khoá khử trùng tầng 2 (US-06 AC4). SYSTEM message không có. */
  clientMsgId: string | null;
  createdAt: Date;
  /** Chỉ có ở bản optimistic; `undefined` ⇒ đã nằm trong DB. */
  send?: SendAttempt;
};

/**
 * Tin "thô" đưa vào store: kết quả Server Action (`createdAt` là `Date`), payload
 * broadcast (`createdAt` là chuỗi ISO), hoặc bản optimistic tự dựng.
 */
export type IncomingMessage = {
  id: string;
  conversationId?: string | null;
  kind?: string | null;
  senderId?: string | null;
  body?: string | null;
  deleted?: boolean | null;
  deletedAt?: Date | string | null;
  replyToId?: string | null;
  clientMsgId?: string | null;
  createdAt: Date | string | number;
  send?: SendAttempt;
};

// ─── Chuẩn hoá ───────────────────────────────────────────────────────────────

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

function toKind(value: unknown): ChatMessageKind {
  return value === "ANNOUNCEMENT" || value === "SYSTEM" ? value : "CHAT";
}

/** `true` khi dòng này mới chỉ tồn tại phía client (chưa có id server). */
export function isOptimistic(message: Pick<ChatMessage, "id">): boolean {
  return message.id.startsWith(OPTIMISTIC_ID_PREFIX);
}

export function optimisticIdFor(clientMsgId: string): string {
  return `${OPTIMISTIC_ID_PREFIX}${clientMsgId}`;
}

export function normalizeIncomingMessage(raw: IncomingMessage): ChatMessage {
  const deleted = raw.deleted === true || (raw.deletedAt != null && raw.deletedAt !== "");
  return {
    id: raw.id,
    conversationId: raw.conversationId ?? "",
    kind: toKind(raw.kind),
    senderId: raw.senderId ?? null,
    // Tin đã gỡ: KHÔNG bao giờ hiển thị body gốc kể cả khi server lỡ trả về.
    body: deleted ? DELETED_MESSAGE_TEXT : (raw.body ?? ""),
    deleted,
    replyToId: raw.replyToId ?? null,
    clientMsgId: raw.clientMsgId ?? null,
    createdAt: toDate(raw.createdAt),
    ...(raw.send ? { send: raw.send } : {}),
  };
}

/** Thứ tự toàn phần `(createdAt, id)` — trùng ORDER BY của `lib/chat/queries.ts`. */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  const at = a.createdAt.getTime();
  const bt = b.createdAt.getTime();
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ─── Hợp nhất + khử trùng 2 tầng ─────────────────────────────────────────────

/**
 * Hợp nhất `incoming` vào `current`, trả danh sách CŨ → MỚI theo `(createdAt, id)`.
 *
 * **Khử trùng 2 tầng** (US-06 AC4 / TS-10):
 *   - tầng 1 theo `id` — cùng một tin tới hai đường (broadcast + reconcile) chỉ còn một;
 *   - tầng 2 theo `clientMsgId` — bản optimistic `tmp:X` bị THAY THẾ bởi bản server có
 *     `clientMsgId = X` (id thật khác id tạm nên tầng 1 không bắt được).
 *
 * Luật một chiều chống race TS-10.3: bản optimistic KHÔNG được đè bản server đã có cùng
 * `clientMsgId` — nếu broadcast về trước lúc UI kịp chèn bản optimistic thì bản optimistic
 * bị BỎ QUA (nếu không, dòng đã "gửi xong" sẽ tụt về trạng thái "đang gửi" vĩnh viễn).
 *
 * Trả về CHÍNH `current` khi không có gì đổi (giữ tham chiếu ⇒ React không render thừa).
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly IncomingMessage[] | IncomingMessage,
): ChatMessage[] {
  const list = Array.isArray(incoming) ? incoming : [incoming];
  if (list.length === 0) return current as ChatMessage[];

  const merged = [...current];
  const indexById = new Map<string, number>();
  const indexByClientMsgId = new Map<string, number>();
  merged.forEach((m, i) => {
    indexById.set(m.id, i);
    if (m.clientMsgId) indexByClientMsgId.set(m.clientMsgId, i);
  });

  let changed = false;

  for (const raw of list) {
    const next = normalizeIncomingMessage(raw);

    // Tầng 1 — cùng id.
    const byId = indexById.get(next.id);
    if (byId !== undefined) {
      merged[byId] = next;
      if (next.clientMsgId) indexByClientMsgId.set(next.clientMsgId, byId);
      changed = true;
      continue;
    }

    // Tầng 2 — cùng clientMsgId (bản optimistic ↔ bản server).
    const byClient = next.clientMsgId ? indexByClientMsgId.get(next.clientMsgId) : undefined;
    if (byClient !== undefined) {
      const existing = merged[byClient];
      if (isOptimistic(next) && !isOptimistic(existing)) {
        // Race TS-10.3: bản server đã tới trước — bỏ qua bản optimistic đến muộn.
        continue;
      }
      indexById.delete(existing.id);
      merged[byClient] = next;
      indexById.set(next.id, byClient);
      changed = true;
      continue;
    }

    merged.push(next);
    indexById.set(next.id, merged.length - 1);
    if (next.clientMsgId) indexByClientMsgId.set(next.clientMsgId, merged.length - 1);
    changed = true;
  }

  if (!changed) return current as ChatMessage[];
  return merged.sort(compareMessages);
}

/**
 * US-07 AC4 — nhận `message.deleted`: đổi TẠI CHỖ thành cờ đã gỡ + text thay thế,
 * KHÔNG reload luồng. Không tìm thấy id (tin nằm ở trang chưa tải) ⇒ trả nguyên
 * `list` — reconcile/phân trang sau đó sẽ lấy bản đã gỡ từ server.
 */
export function applyMessageDeleted(
  list: readonly ChatMessage[],
  messageId: string,
  replacementText: string = DELETED_MESSAGE_TEXT,
): ChatMessage[] {
  const index = list.findIndex((m) => m.id === messageId);
  if (index === -1 || list[index].deleted) return list as ChatMessage[];

  const next = [...list];
  next[index] = { ...list[index], deleted: true, body: replacementText };
  return next;
}

// ─── Mốc đã đọc (AC5) ────────────────────────────────────────────────────────

export type UnreadResetInput = {
  messages: readonly ChatMessage[];
  /** `User.id` người đang xem — tin của chính mình không tính vào chưa đọc. */
  currentUserId: string;
  /** Đã báo đọc tới id nào (kết quả `markConversationRead` gần nhất). */
  lastMarkedMessageId: string | null;
  /** Hội thoại đang mở VÀ tab đang hiện (`document.visibilityState === "visible"`). */
  foreground: boolean;
};

export type UnreadResetDecision = {
  /** Có cần gọi `markConversationRead` không (false ⇒ không chạm server). */
  shouldMark: boolean;
  /** Id truyền vào `markConversationRead`; `null` khi luồng chưa có tin server nào. */
  lastReadMessageId: string | null;
  /** Badge cục bộ sau quyết định này (0 khi vừa đánh dấu đã đọc). */
  unreadCount: number;
};

/**
 * US-07 AC5 — quyết định (thuần) có reset chưa đọc hay không.
 *
 * Chỉ tính trên tin ĐÃ CÓ id server: `markConversationRead` ghi `lastReadMessageId` vào DB,
 * đưa id tạm `tmp:` vào là ghi rác. Idempotent: đã đánh dấu tới tin mới nhất rồi thì
 * `shouldMark = false` (không spam server mỗi lần re-render).
 *
 * Tab ẩn ⇒ `foreground = false` ⇒ không đánh dấu: đọc là hành vi của người đang NHÌN màn
 * hình (và khi tab ẩn, timer/rAF của trình duyệt bị bóp — đừng dựa vào chúng).
 */
export function computeUnreadReset(input: UnreadResetInput): UnreadResetDecision {
  const serverMessages = input.messages.filter((m) => !isOptimistic(m));
  const newest = serverMessages[serverMessages.length - 1];
  if (!newest) return { shouldMark: false, lastReadMessageId: input.lastMarkedMessageId, unreadCount: 0 };

  if (input.foreground && newest.id !== input.lastMarkedMessageId) {
    return { shouldMark: true, lastReadMessageId: newest.id, unreadCount: 0 };
  }

  // Không đánh dấu: đếm phần chưa đọc còn lại (SYSTEM không tính — US-09 AC4).
  const markedIndex = input.lastMarkedMessageId
    ? serverMessages.findIndex((m) => m.id === input.lastMarkedMessageId)
    : -1;
  const unreadCount = serverMessages
    .slice(markedIndex + 1)
    .filter((m) => m.kind !== "SYSTEM" && m.senderId !== input.currentUserId).length;

  return { shouldMark: false, lastReadMessageId: input.lastMarkedMessageId, unreadCount };
}

/** Id tin mới nhất đã có trên server — mốc `lastSeenMessageId` cho `fetchMessagesSince` (AC2). */
export function lastSeenMessageId(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!isOptimistic(messages[i])) return messages[i].id;
  }
  return null;
}

// ─── Trạng thái gửi + chính sách thử lại (AC6) ───────────────────────────────

/** Bắt đầu một lượt gửi: dùng cho lần gửi đầu VÀ cho nút "gửi lại" thủ công sau khi failed. */
export function startSend(): SendAttempt {
  return { status: "sending", attempts: 1, retryDelayMs: null };
}

/**
 * AC6 — bước trạng thái gửi. **Hàm thuần**: chỉ TRẢ VỀ `retryDelayMs`, việc hẹn giờ do
 * lớp gọi làm (test không cần fake timer để kiểm chính sách).
 *
 *   - `"ok"`    → "sent".
 *   - `"retry"` → lỗi mạng/tạm thời: còn lượt thì "sending" + `retryDelayMs` theo backoff;
 *                 hết {@link MAX_AUTO_RETRIES} lượt → "failed" (UI hiện nút gửi lại,
 *                 nội dung đã gõ vẫn nằm nguyên trong `ChatMessage.body`).
 *   - `"fatal"` → lỗi nghiệp vụ (403/429/quá 4000 ký tự): thử lại vô ích → "failed" ngay.
 */
export function nextSendState(
  prev: SendAttempt,
  outcome: "ok" | "retry" | "fatal",
): SendAttempt {
  if (outcome === "ok") return { status: "sent", attempts: prev.attempts, retryDelayMs: null };
  if (outcome === "fatal") return { status: "failed", attempts: prev.attempts, retryDelayMs: null };

  const retriesDone = Math.max(prev.attempts - 1, 0);
  if (retriesDone >= MAX_AUTO_RETRIES) {
    return { status: "failed", attempts: prev.attempts, retryDelayMs: null };
  }
  return {
    status: "sending",
    attempts: prev.attempts + 1,
    retryDelayMs: SEND_RETRY_BACKOFF_MS[retriesDone] ?? SEND_RETRY_BACKOFF_MS[SEND_RETRY_BACKOFF_MS.length - 1],
  };
}

/** Dựng bản optimistic để render ngay khi bấm gửi (US-06 AC4). `now` truyền vào để test tất định. */
export function createOptimisticMessage(input: {
  conversationId: string;
  clientMsgId: string;
  senderId: string;
  body: string;
  replyToId?: string | null;
  kind?: ChatMessageKind;
  now?: Date;
}): ChatMessage {
  return {
    id: optimisticIdFor(input.clientMsgId),
    conversationId: input.conversationId,
    kind: input.kind ?? "CHAT",
    senderId: input.senderId,
    body: input.body,
    deleted: false,
    replyToId: input.replyToId ?? null,
    clientMsgId: input.clientMsgId,
    createdAt: input.now ?? new Date(),
    send: startSend(),
  };
}

// ─── Đọc payload broadcast (không tin cấu trúc) ──────────────────────────────

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Payload `message.created` (server phát ở `lib/chat/messages.ts`) → tin chuẩn hoá.
 * Trả `null` khi payload thiếu `id`/`createdAt` — thà bỏ một broadcast dị dạng còn hơn
 * chèn dòng rỗng: reconcile khi re-SUBSCRIBED sẽ lấy lại tin đó từ DB (AC2).
 */
export function parseBroadcastMessage(payload: Record<string, unknown>): IncomingMessage | null {
  const id = str(payload.id);
  const createdAt = payload.createdAt;
  if (!id) return null;
  if (typeof createdAt !== "string" && typeof createdAt !== "number" && !(createdAt instanceof Date)) {
    return null;
  }
  const parsed = new Date(createdAt as string | number | Date);
  if (Number.isNaN(parsed.getTime())) return null;

  return {
    id,
    conversationId: str(payload.conversationId),
    kind: str(payload.kind),
    senderId: str(payload.senderId),
    body: typeof payload.body === "string" ? payload.body : "",
    deleted: payload.deletedAt != null,
    replyToId: str(payload.replyToId),
    clientMsgId: str(payload.clientMsgId),
    createdAt: parsed,
  };
}

/** Payload `message.deleted` → id tin bị gỡ (chấp cả `messageId` lẫn `id`). */
export function parseMessageDeleted(payload: Record<string, unknown>): string | null {
  return str(payload.messageId) ?? str(payload.id);
}

/** Payload `participant.removed` → `User.id` bị gỡ (AC3 so với chính mình). */
export function parseParticipantRemoved(payload: Record<string, unknown>): string | null {
  return str(payload.userId);
}

/**
 * US-15 AC3 — payload `conversation.locked` → trạng thái mới của hội thoại.
 *
 * MỘT event cho cả hai chiều: cờ `locked` quyết định khoá hay mở khoá (server chỉ khai
 * `conversation.locked` trong `ChatBroadcastEvent`). Đọc `locked` trước, `status` chỉ là
 * đường dự phòng — payload lạ (thiếu cả hai) trả `null` để client GIỮ NGUYÊN trạng thái
 * server đã render, thay vì đoán bừa rồi mở ô nhập của một hội thoại đang khoá.
 */
export function parseConversationLocked(
  payload: Record<string, unknown>,
): { locked: boolean; status: string } | null {
  const status = str(payload.status);
  if (typeof payload.locked === "boolean") {
    return { locked: payload.locked, status: status ?? (payload.locked ? "LOCKED" : "ACTIVE") };
  }
  if (status === "LOCKED") return { locked: true, status };
  if (status === "ACTIVE") return { locked: false, status };
  return null;
}

/**
 * Tín hiệu `conversation.bumped` đã chuẩn hoá (topic mức NGƯỜI DÙNG `user:{id}`).
 *
 * ⚠️ Đây KHÔNG phải dữ liệu để hiển thị — nó chỉ nói "hội thoại X vừa có gì đó mới".
 * Mọi thứ vẽ ra màn hình vẫn phải hỏi lại server (đường đã kiểm quyền): badge qua
 * `GET /api/chat/unread`, danh sách qua RSC. Payload cố ý KHÔNG mang body/tên/SĐT (BR-30).
 */
export type ConversationBump = {
  conversationId: string;
  /** cuid tin vừa tạo/đổi — chỉ để khử trùng khi cùng một bump tới hai lần. */
  messageId: string;
  /** "CHAT" | "ANNOUNCEMENT" | "DELETED" (union server có thể mở rộng ⇒ nhận string). */
  kind: string | null;
  at: Date;
};

/**
 * Payload `conversation.bumped` → bump chuẩn hoá; `null` nếu payload dị dạng.
 *
 * Nghiêm ngặt có chủ đích (giống `parseBroadcastMessage`): thà bỏ một tín hiệu hỏng còn
 * hơn đoán bừa — lần `SUBSCRIBED` kế tiếp phát `resync`, client hỏi lại server là đủ bù.
 */
export function parseConversationBumped(
  payload: Record<string, unknown>,
): ConversationBump | null {
  const conversationId = str(payload.conversationId);
  const messageId = str(payload.messageId);
  if (!conversationId || !messageId) return null;

  const at = payload.at;
  if (typeof at !== "string" && typeof at !== "number" && !(at instanceof Date)) return null;
  const parsed = new Date(at as string | number | Date);
  if (Number.isNaN(parsed.getTime())) return null;

  return { conversationId, messageId, kind: str(payload.kind), at: parsed };
}
