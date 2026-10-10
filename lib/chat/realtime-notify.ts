import "server-only";
import { db } from "@/lib/db";

/**
 * Đường PHÁT realtime DUY NHẤT của chat (VPS tự host; Supabase Realtime đã gỡ 28/09/2026).
 *
 * Server phát bằng Postgres `NOTIFY` (thay cho REST broadcast của Supabase trước đây). Mọi tiến trình
 * app đang `LISTEN` kênh này (`lib/chat/realtime-hub.ts`) nhận được và rải xuống các kết nối
 * SSE `/api/chat/stream` — sau khi KIỂM QUYỀN TỪNG LẦN GIAO.
 *
 * Hợp đồng giữ nguyên với `broadcastMessages` (NT1 — Postgres là nguồn sự thật):
 *  • KHÔNG BAO GIỜ throw. Hàm chạy SAU khi tin đã commit; phát hỏng chỉ log.
 *  • Client không bao giờ ghi qua kênh này — chỉ server gọi `pg_notify`.
 *
 * Vì sao không cần `after()` như đường Supabase cũ: NOTIFY là một câu SQL vài ms trên chính
 * DB đang dùng, không có độ trễ 0,7s/phần tử của endpoint Supabase (đo 10/08/2026).
 */

/** Tên kênh LISTEN/NOTIFY. Đổi ở đây là phải đổi cả hub — cùng file import hằng này. */
export const CHAT_REALTIME_CHANNEL = "chat_realtime";

/**
 * Trần byte của MỘT phong bì. Postgres chặn payload NOTIFY ở < 8000 byte (mặc định biên dịch);
 * chừa 500 byte biên để không bao giờ chạm lỗi "payload string too long".
 */
export const NOTIFY_MAX_BYTES = 7_500;

/**
 * Event thay thế khi payload gốc quá cỡ: chỉ mang tên event gốc + id. Client nhận event này
 * ⇒ đi hỏi lại server qua đường đã kiểm quyền (reconcile / resync) — không có "event log".
 */
export const RESYNC_EVENT = "realtime.resync";

/** Phong bì đi trong payload NOTIFY — cũng chính là `data:` của SSE. */
export type RealtimeEnvelope = {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
};

/**
 * Hình dạng tối thiểu của một phần tử cần phát — trùng `BroadcastMessage` của
 * `lib/chat/broadcast.ts` về cấu trúc. Khai lại ở đây chứ không import để không tạo vòng
 * `broadcast.ts ↔ realtime-notify.ts` (dependency-cruiser `no-circular`).
 */
export type PublishableMessage = Pick<RealtimeEnvelope, "topic" | "event" | "payload">;

/** Số phong bì trong MỘT câu `pg_notify` — lô lớn chia nhỏ để câu SQL không phình vô hạn. */
const NOTIFY_ROWS_PER_STATEMENT = 100;

/** Khoá id được giữ lại trong phong bì resync. KHÔNG có body/tên/SĐT (BR-30). */
const RESYNC_ID_KEYS = ["id", "conversationId", "messageId"] as const;

/**
 * Builder THUẦN: `BroadcastMessage` → chuỗi JSON đi vào `pg_notify`. Luôn ≤ {@link NOTIFY_MAX_BYTES}.
 * Quá cỡ thì KHÔNG cắt cụt (JSON gãy là client nuốt câm) mà rơi về {@link RESYNC_EVENT}.
 */
export function encodeEnvelope(message: PublishableMessage): string {
  const full = JSON.stringify({
    topic: message.topic,
    event: message.event,
    payload: message.payload,
  } satisfies RealtimeEnvelope);
  if (Buffer.byteLength(full, "utf8") <= NOTIFY_MAX_BYTES) return full;

  const ids: Record<string, unknown> = { event: message.event };
  for (const key of RESYNC_ID_KEYS) {
    const v = message.payload[key];
    if (typeof v === "string" && v.length <= 64) ids[key] = v;
  }
  return JSON.stringify({
    topic: message.topic,
    event: RESYNC_EVENT,
    payload: ids,
  } satisfies RealtimeEnvelope);
}

/**
 * Phát cả lô bằng `pg_notify` — MỘT câu SQL cho mỗi {@link NOTIFY_ROWS_PER_STATEMENT} phong bì
 * (`unnest` mảng tham số), không lặp N lượt đi-về DB trong đường gửi tin.
 *
 * Tagged template `$executeRaw` ⇒ mọi giá trị là tham số bind, không nối chuỗi SQL.
 * @returns true nếu mọi câu chạy được; false nếu có lỗi (đã log). KHÔNG throw.
 */
export async function publishViaPgNotify(
  messages: readonly PublishableMessage[],
): Promise<boolean> {
  if (messages.length === 0) return true;
  let ok = true;
  for (let i = 0; i < messages.length; i += NOTIFY_ROWS_PER_STATEMENT) {
    const chunk = messages.slice(i, i + NOTIFY_ROWS_PER_STATEMENT);
    const payloads = chunk.map(encodeEnvelope);
    try {
      await db.$executeRaw`SELECT pg_notify(${CHAT_REALTIME_CHANNEL}, p) FROM unnest(${payloads}::text[]) AS p`;
    } catch (e) {
      ok = false;
      const topics = chunk.map((m) => m.topic);
      console.warn(
        `[chat/realtime-notify] NOTIFY hỏng — n=${chunk.length} ` +
          `topics=[${topics.slice(0, 10).join(",")}${topics.length > 10 ? `,…+${topics.length - 10}` : ""}] — ` +
          "tin vẫn nằm trong DB, client bù khi nối lại.",
        e,
      );
    }
  }
  return ok;
}
