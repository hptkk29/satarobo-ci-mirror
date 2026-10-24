/**
 * Cổng quyền NHẬN tin realtime qua SSE (`/api/chat/stream`) — tầng realtime duy nhất từ 28/09/2026.
 *
 * Thay cho hai policy RLS trên `realtime.messages` của Supabase (đường Supabase đã gỡ):
 *   • `user:{id}` — chỉ chính chủ (so trọn chuỗi với `User.id` của phiên);
 *   • `conv:{id}` — participant CÒN HIỆU LỰC, đúng cổng đọc của `lib/chat/queries.ts`
 *     (`leftAt IS NULL` + BR-04 lưu trữ quá hạn). Tầng đọc chat là participant-based,
 *     không gọi `can()` — xem 00-dieu-chinh mục E.3 và QUY ƯỚC MÃ LỖI trong queries.ts.
 *
 * KHÁC Supabase ở một điểm có chủ đích: kiểm ở MỖI LẦN GIAO, không chỉ lúc nối. RLS chỉ chạy
 * lúc JOIN nên người bị gỡ nghe tiếp tới hết đời vé JWT (≤ 5', đo 10/08/2026).
 * Ở đây cận trên là {@link PARTICIPANT_CACHE_TTL_MS}.
 *
 * File THUẦN (không import DB) — hàm kiểm participant được tiêm vào, để test chạy không cần DB.
 */

/**
 * Tuổi thọ kết quả kiểm participant trong MỘT kết nối. Là cận trên cửa sổ "đã bị gỡ vẫn nhận":
 * ngắn hơn nhiều so với 5' của đường Supabase, nhưng đủ dài để một nhóm 65 người không bắn 65
 * truy vấn cho MỖI tin.
 */
export const PARTICIPANT_CACHE_TTL_MS = 15_000;

/** Trần số hội thoại một kết nối SSE được xin nghe (client thật chỉ mở 1–2). */
export const MAX_STREAM_CONVERSATIONS = 20;

/** Hình dạng id hội thoại chấp nhận (cuid / uuid). Chặn rác trước khi chạm DB. */
const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type ParticipantCheck = (conversationId: string, userId: string) => Promise<boolean>;

export type TopicAuthorizer = (topic: string) => Promise<boolean>;

type CacheEntry = { at: number; allowed: Promise<boolean> };

/**
 * Tạo cổng quyền cho MỘT kết nối (một người dùng). Cache nằm trong closure ⇒ đóng kết nối là
 * cache chết theo, không có cache dùng chung giữa người dùng.
 */
export function createTopicAuthorizer(opts: {
  userId: string;
  isParticipant: ParticipantCheck;
  ttlMs?: number;
  now?: () => number;
}): TopicAuthorizer {
  const { userId, isParticipant } = opts;
  const ttlMs = opts.ttlMs ?? PARTICIPANT_CACHE_TTL_MS;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();

  return async (topic: string): Promise<boolean> => {
    if (!userId) return false;
    if (topic.startsWith("user:")) return topic === `user:${userId}`;
    if (!topic.startsWith("conv:")) return false;

    const conversationId = topic.slice("conv:".length);
    if (!CONVERSATION_ID_RE.test(conversationId)) return false;

    const t = now();
    const hit = cache.get(conversationId);
    if (hit && t - hit.at < ttlMs) return hit.allowed;

    // Lưu PROMISE (không phải kết quả) ⇒ nhiều phong bì tới cùng lúc chỉ tốn một truy vấn.
    const allowed = isParticipant(conversationId, userId).then(
      (ok) => ok === true,
      (e: unknown) => {
        // Fail-closed: không chắc thì KHÔNG giao. Không cache lỗi — lần sau hỏi lại thật.
        cache.delete(conversationId);
        console.warn("[chat/realtime-authz] Kiểm participant lỗi — không giao phong bì.", e);
        return false;
      },
    );
    cache.set(conversationId, { at: t, allowed });
    return allowed;
  };
}

/**
 * Tham số `conv` của `/api/chat/stream` → danh sách id hợp lệ, khử trùng, cắt ở
 * {@link MAX_STREAM_CONVERSATIONS}. Nhận cả `?conv=a&conv=b` lẫn `?conv=a,b`.
 * Việc có QUYỀN nghe hay không KHÔNG quyết ở đây mà ở {@link createTopicAuthorizer} lúc giao.
 */
export function parseStreamConversationIds(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const id = part.trim();
      if (!CONVERSATION_ID_RE.test(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_STREAM_CONVERSATIONS) return out;
    }
  }
  return out;
}
