import "server-only";
import { publishViaPgNotify } from "@/lib/chat/realtime-notify";

/**
 * US-06 — Đẩy realtime xuống topic `conv:{id}` / `user:{id}`.
 *
 * Từ 28/09/2026 (prod dời sang VPS) chỉ còn MỘT đường phát: Postgres `NOTIFY`
 * (`lib/chat/realtime-notify.ts`) → hub LISTEN mỗi tiến trình (`lib/chat/realtime-hub.ts`)
 * → route SSE `/api/chat/stream`, kiểm quyền ở MỖI LẦN GIAO (`lib/chat/realtime-authz.ts`).
 * Đường Supabase Realtime Broadcast (REST + service role + RLS `realtime.messages`) đã GỠ
 * cùng cờ `CHAT_REALTIME_PROVIDER` — không còn đường lùi về Supabase.
 *
 * ⚠️ FAIL-AND-FORGET (AC3 + NT1 "Postgres là nguồn sự thật"):
 * hàm này KHÔNG BAO GIỜ throw. Nó chạy SAU khi tin đã commit; một cú throw sẽ
 * biến "tin đã gửi thành công" thành lỗi đỏ trước mặt người dùng trong khi tin
 * vẫn nằm trong DB — mất niềm tin còn tệ hơn mất realtime. Realtime rớt thì
 * client tự bù bằng `fetchMessagesSince` khi kênh về SUBSCRIBED (US-07 AC2).
 *
 * Client KHÔNG BAO GIỜ phát được: chỉ server gọi `pg_notify`; kênh SSE chỉ chiều xuống.
 *
 * ── Topic mức NGƯỜI DÙNG `user:{User.id}` ──────────────────────────────────
 * Kênh `conv:{id}` chỉ tới được người ĐANG MỞ hội thoại đó ⇒ badge chưa đọc và danh
 * sách hội thoại đứng yên khi tin đến ở hội thoại khác. Kênh mức người dùng cho phép
 * server bắn một event NHẸ `conversation.bumped` tới từng người nhận. Cả lô N người nhận
 * đi trong rất ít câu SQL (`publishViaPgNotify` gộp 100 phong bì/câu) — không lặp N lượt
 * đi-về trong đường gửi tin. Topic `user:{id}` chỉ giao cho chính chủ (`realtime-authz.ts`).
 */

export type ChatBroadcastEvent =
  | "message.created"
  | "message.deleted"
  | "participant.removed"
  | "conversation.locked";

/**
 * Event chạy trên topic mức NGƯỜI DÙNG `user:{User.id}`.
 *
 * Thêm event mới ở đây KHÔNG cần migration: cổng quyền SSE (`lib/chat/realtime-authz.ts`)
 * chỉ so topic `user:{id}` với người của kết nối, KHÔNG lọc theo tên event ⇒ ai nghe được
 * topic của mình thì nghe được mọi event trên đó.
 * Nhưng client thì CÓ lọc theo tên (`components/chat/user-channel.ts`) — thêm tên ở đây
 * mà quên mở cửa bên đó là event bị nuốt CÂM, không log, không lỗi.
 */
export type ChatUserBroadcastEvent = "conversation.bumped" | "notification.bumped";

/**
 * Payload `conversation.bumped` — chỉ là TÍN HIỆU "có gì đó mới ở hội thoại X",
 * KHÔNG phải dữ liệu. Client nhận xong đi hỏi lại server (đường đã kiểm quyền) rồi
 * mới vẽ.
 *
 * ⚠️ BR-30: cấm mọi thứ nhận dạng người — không body, không tên/SĐT/email người gửi,
 * không preview. Preview trong danh sách vẫn được DỰNG Ở SERVER (`lib/chat/queries.ts`)
 * sau khi đã lọc tin bị gỡ; nhét preview vào payload là đi vòng qua đúng chỗ đang lọc.
 * Cũng KHÔNG đẩy `unreadCount`: con số là kết quả của một truy vấn có kiểm quyền
 * (lọc `leftAt IS NULL` + BR-04), đẩy qua broadcast là tạo nguồn sự thật thứ hai.
 */
export type ConversationBumpedPayload = {
  /** Hội thoại vừa có tin — client dùng để biết có phải hội thoại đang mở không. */
  conversationId: string;
  /** cuid tin vừa tạo/đổi — CHỈ để khử trùng khi bump tới hai lần. Không hiển thị. */
  messageId: string;
  /** Để sau này ưu tiên push (US-14) mà không phải đổi hợp đồng. */
  kind: "CHAT" | "ANNOUNCEMENT" | "DELETED";
  /** ISO timestamp của sự kiện — client dùng để sắp lại thứ tự cục bộ nếu cần. */
  at: string;
};

/**
 * Payload `notification.bumped` — tín hiệu "chuông của bạn vừa có gì đó mới", dùng để badge
 * chuông nhảy ngay thay vì đợi vòng poll 60s.
 *
 * ⚠️ BR-30, chặt hơn cả `conversation.bumped`: KHÔNG tiêu đề, KHÔNG `href`, KHÔNG tên/SĐT/
 * email/preview — thông báo nhân sự mang nội dung nghiệp vụ (tên học viên, tên lớp), mà kênh
 * `user:{id}` chỉ chứng minh được "đúng người", KHÔNG chứng minh được "đúng quyền xem nội
 * dung đó". Cũng KHÔNG đẩy số chưa đọc: con số là kết quả một truy vấn CÓ KIỂM QUYỀN, đẩy
 * qua broadcast là dựng nguồn sự thật thứ hai rồi hai bên lệch nhau.
 * Client nhận tín hiệu xong đi hỏi lại server (đường đã kiểm quyền) rồi mới vẽ.
 */
export type NotificationBumpedPayload = {
  /** ISO timestamp của sự kiện — chỉ để client khử trùng / bỏ tín hiệu cũ. */
  at: string;
};

/** Một phong bì cần phát — cùng hình dạng `PublishableMessage` của `realtime-notify.ts`. */
export type BroadcastMessage = {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
};

/** Builder THUẦN (không I/O) cho topic `conv:{id}`. */
export function conversationBroadcast(
  conversationId: string,
  event: ChatBroadcastEvent | string,
  payload: Record<string, unknown>,
): BroadcastMessage {
  return { topic: `conv:${conversationId}`, event, payload };
}

/**
 * Builder THUẦN: 1 phần tử `conversation.bumped` cho MỖI người nhận, topic
 * `user:{userId}`. Đã khử trùng userId + bỏ chuỗi rỗng (một người có mặt hai lần
 * trong danh sách thì cũng chỉ nhận một bump).
 */
export function userBumpBroadcasts(
  userIds: readonly string[],
  payload: ConversationBumpedPayload,
): BroadcastMessage[] {
  const seen = new Set<string>();
  const out: BroadcastMessage[] = [];
  for (const id of userIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      topic: `user:${id}`,
      event: "conversation.bumped" satisfies ChatUserBroadcastEvent,
      payload: { ...payload },
    });
  }
  return out;
}

/**
 * Builder THUẦN: 1 phần tử `notification.bumped` cho MỖI người nhận, topic `user:{userId}`.
 * Cùng khuôn `userBumpBroadcasts` (khử trùng userId + bỏ chuỗi rỗng) — một người nhận hai
 * thông báo cùng lúc thì cũng chỉ cần một tín hiệu, vì client sẽ đi đếm lại chứ không cộng dồn.
 *
 * Payload dựng LẠI từng khoá thay vì `{ ...payload }`: nơi gọi thường có sẵn cả object
 * StaffNotification trong tay, và spread là đường ngắn nhất để tên học viên / `href` lọt ra
 * kênh realtime (BR-30). Ở đây chỉ `at` đi được ra ngoài, dù người gọi có đưa gì thêm.
 */
export function notificationBumpBroadcasts(
  userIds: readonly string[],
  payload: NotificationBumpedPayload,
): BroadcastMessage[] {
  const seen = new Set<string>();
  const out: BroadcastMessage[] = [];
  for (const id of userIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      topic: `user:${id}`,
      event: "notification.bumped" satisfies ChatUserBroadcastEvent,
      payload: { at: payload.at },
    });
  }
  return out;
}

/**
 * Primitive DUY NHẤT phát realtime. Nhận NHIỀU topic trong cùng một lời gọi ⇒ fan-out N
 * người nhận chỉ tốn vài câu `pg_notify` (xem `publishViaPgNotify`).
 *
 * @returns true nếu mọi câu NOTIFY chạy được; false nếu có lỗi (đã log).
 *          KHÔNG throw trong mọi trường hợp (xem hợp đồng đầu file).
 */
export async function broadcastMessages(
  messages: readonly BroadcastMessage[],
): Promise<boolean> {
  if (messages.length === 0) return true;
  try {
    return await publishViaPgNotify(messages);
  } catch (e) {
    // `publishViaPgNotify` vốn đã tự nuốt lỗi — lớp này chỉ là lưới cuối cho hợp đồng
    // "không bao giờ throw" (vd lỗi dựng câu SQL trước khi vào try của nó).
    console.warn("[chat/broadcast] Không phát được qua NOTIFY — tin vẫn nằm trong DB.", e);
    return false;
  }
}

/**
 * Đẩy 1 event xuống topic `conv:{conversationId}`.
 * @returns true nếu NOTIFY chạy được; false nếu lỗi. KHÔNG throw trong mọi trường hợp.
 */
export async function broadcastToConversation(
  conversationId: string,
  event: ChatBroadcastEvent | string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  return broadcastMessages([conversationBroadcast(conversationId, event, payload)]);
}
