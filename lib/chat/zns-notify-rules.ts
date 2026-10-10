// lib/chat/zns-notify-rules.ts — US-14: LUẬT THUẦN của việc báo tin nhắn mới qua ZNS.
//
// Tách khỏi `zns-notify.ts` (bản có DB + `server-only`) để test được trực tiếp bằng
// vitest node: mọi quyết định "có gửi không / gửi vì tin nào" nằm ở đây, phần kia chỉ
// còn đọc-ghi DB và gọi provider.
//
// Ba cổng cứng do chủ dự án chốt 09/08/2026 (thắng bản US-14 gốc trong backlog — kênh
// là ZNS chứ KHÔNG phải Web Push):
//   1. Hội thoại phải là CLASS_GROUP — **nhắn riêng (DM) TUYỆT ĐỐI KHÔNG GỬI**.
//      Cổng này nằm ở tầng query của `zns-notify.ts` (lọc `type = CLASS_GROUP`).
//   2. Người gửi phải là GV hoặc quản lý cơ sở — tin của phụ huynh khác trong nhóm
//      KHÔNG kích hoạt (`isStaffSender`).
//   3. Phụ huynh phải CHƯA ĐỌC quá ngưỡng (mặc định 6 tiếng) — `pickAnchorMessage`.
//
// ⚠️ Ngưỡng là ĐỘ TRỄ ⇒ không thể làm bằng handler sự kiện lúc tin được tạo (lúc đó
// chưa biết 6 tiếng nữa phụ huynh đã đọc chưa). Vì vậy US-14 là CRON QUÉT, và cũng vì
// vậy `lib/chat/announcements.ts` cố ý KHÔNG tự gọi ZNS: sự kiện `chat.announcement_created`
// trong outbox không mang được thông tin "đã đọc hay chưa" ở thời điểm đáng gửi.
import { vnParts } from "@/lib/time/vn";

// ── Khung cấm của Zalo cho tin CSKH (mã lỗi -133) ───────────────────────────
// KHÔNG đưa vào SystemSetting: đây là ràng buộc của Zalo, nới ra không tiết kiệm
// được đồng nào mà tin sẽ bị từ chối. Ngưỡng/trần ĐỤNG TIỀN thì nằm ở registry.
export const VN_QUIET_START_HOUR = 22;
export const VN_QUIET_END_HOUR = 6;

/**
 * `true` khi thời điểm `at` rơi vào 22:00–05:59 giờ VN.
 *
 * Dùng `vnParts` chứ không `getHours()`: Vercel chạy UTC, máy dev chạy +07 ⇒ so giờ
 * bằng đồng hồ tiến trình là bug "chạy máy tôi thì được" (lib/time/vn.ts).
 */
export function isVnQuietHour(at: Date): boolean {
  const { hour } = vnParts(at);
  return hour >= VN_QUIET_START_HOUR || hour < VN_QUIET_END_HOUR;
}

/** Người gửi — đủ 3 mẩu để quyết định "có phải nhân sự đứng lớp không". */
export type SenderIdentity = {
  /** Tư cách trong hội thoại (`ConversationParticipant.derivedFrom`). */
  derivedFrom?: string | null;
  /** Vai tài khoản (`User.role`) — chỉ dùng khi `derivedFrom` trống. */
  role?: string | null;
  roles?: readonly string[] | null;
};

const STAFF_DERIVED = new Set(["CLASS_TEACHER", "CENTER_MANAGER"]);
const STAFF_ROLES = new Set(["TEACHER", "CENTER_MANAGER"]);

/**
 * Cổng 2 — chỉ tin của GV / quản lý cơ sở mới đáng 400đ.
 *
 * `derivedFrom` THẮNG vai tài khoản (cùng quy ước `isAnnouncementRecipient`): một người
 * vừa là GV vừa là PH đứng trong nhóm với đúng MỘT tư cách. Participant thêm TAY
 * (`derivedFrom` trống) mới rơi về vai tài khoản.
 *
 * FAIL-CLOSED: không nhận ra là gì → KHÔNG phải nhân sự → không gửi. Thà bỏ sót một
 * lời nhắc còn hơn bắn ZNS cho mọi câu "dạ vâng ạ" của phụ huynh khác trong nhóm.
 */
export function isStaffSender(p: SenderIdentity): boolean {
  if (p.derivedFrom) return STAFF_DERIVED.has(p.derivedFrom);
  if (p.role && STAFF_ROLES.has(p.role)) return true;
  return p.roles?.some((r) => STAFF_ROLES.has(r)) ?? false;
}

/** Tin nhắn ứng viên — đã kèm sẵn kết luận "người gửi có phải nhân sự không". */
export type AnchorCandidate = {
  id: string;
  kind: string;
  createdAt: Date;
  senderIsStaff: boolean;
};

export type PickAnchorInput = {
  /** Tin trong hội thoại, ĐÃ sắp xếp tăng dần theo `createdAt`. */
  messages: readonly AnchorCandidate[];
  /** `ConversationParticipant.lastReadAt` — `null` = chưa mở hội thoại lần nào. */
  lastReadAt: Date | null;
  /** `ConversationParticipant.muted`. */
  muted: boolean;
  now: Date;
  /** Ngưỡng chưa đọc cho tin thường (ms). */
  chatDelayMs: number;
  /** Ngưỡng chưa đọc cho THÔNG BÁO (ms) — hạ được xuống 30 phút mà không cần deploy. */
  announcementDelayMs: number;
};

/**
 * Cổng 3 — chọn tin "mốc" để nhắc: tin CŨ NHẤT mà phụ huynh chưa đọc và đã quá ngưỡng.
 *
 * Vì sao CŨ NHẤT chứ không phải mới nhất: đó chính là tin đã chờ đủ 6 tiếng. Nó cũng
 * là mốc TẤT ĐỊNH — hai lượt cron cách nhau 30 phút chọn cùng một `messageId`, nên khoá
 * UNIQUE `(conversationId, userId, messageId)` của sổ gửi mới chặn được trùng. Lấy tin
 * mới nhất thì mốc trôi theo từng lượt quét và sổ mất tác dụng chống trùng.
 *
 * `muted` (US-14 AC2): tin thường bị bỏ qua, THÔNG BÁO thì vẫn gửi — phụ huynh tắt
 * chuông chat vẫn phải nhận thông báo chính thức của lớp.
 *
 * SYSTEM bị loại: tin hệ thống ("A đã vào nhóm") không bump `unreadCount` và không phải
 * việc đáng đánh thức phụ huynh.
 */
export function pickAnchorMessage(input: PickAnchorInput): AnchorCandidate | null {
  for (const m of input.messages) {
    if (!m.senderIsStaff) continue;
    if (m.kind !== "CHAT" && m.kind !== "ANNOUNCEMENT") continue;
    if (m.kind === "CHAT" && input.muted) continue;
    if (input.lastReadAt && m.createdAt.getTime() <= input.lastReadAt.getTime()) continue;
    const delay = m.kind === "ANNOUNCEMENT" ? input.announcementDelayMs : input.chatDelayMs;
    if (input.now.getTime() - m.createdAt.getTime() < delay) continue;
    return m;
  }
  return null;
}
