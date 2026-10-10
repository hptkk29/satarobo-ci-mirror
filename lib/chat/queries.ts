// lib/chat/queries.ts — US-08 + US-09 (+ US-07 AC2/AC5): TẦNG ĐỌC của module chat.
//
// Một chỗ duy nhất trả dữ liệu chat cho mọi bề mặt (portal PH / admin / site GV).
// Thuần server, KHÔNG UI, KHÔNG Server Action: mọi hàm nhận `actorUserId` TƯỜNG MINH
// nên test được bằng script/vitest mà không cần request hay `auth()`. Lớp gọi
// (Server Action / route) vẫn phải `auth()` trước — file này không tự lấy phiên.
//
// ⚠️ KHÔNG `import "server-only"` — CÓ CHỦ ĐÍCH, đúng tiền lệ lib/chat/sync-membership.ts
// và lib/chat/reconcile-membership.ts: gói `server-only` chỉ resolve được trong Next
// (ngoài Next nó ném ngay lúc import), trong khi module này phải chạy được dưới `tsx`
// cho ZZTEST (scripts/_zztest-chat-us08.ts) và cron. Chốt chặn "không lọt xuống client"
// là import `@/lib/db` (Prisma) — bundler nổ ngay nếu ai lỡ import từ Client Component.
//
// ⚠️ ĐỌC BẰNG `db` TRẦN, KHÔNG `scopedDb` — CÓ CHỦ ĐÍCH (luật E-bis #5 + delta E.3):
// phạm vi đọc chat là **participant-based** (ConversationParticipant tại thời điểm
// request), KHÔNG center-based. `Conversation` ∈ SCOPE_EXEMPT (lib/db-scope.ts) vì DM
// có `centerId = null`; còn `Class`/`Student`/`Enrollment` ∈ SCOPED_MODELS — đi qua
// scopedDb thì GV dạy chéo cơ sở (TS-01.5) hoặc học viên đã chuyển cơ sở mà còn học lớp
// cũ sẽ BIẾN MẤT khỏi kết quả, tức người dùng hợp lệ bị chặn im lặng. Cách ly ở đây do
// chính điều kiện `participant.leftAt IS NULL` bảo đảm — chặt hơn centerId.
import type { DerivedFrom, MessageKind, ParticipantRole } from "@prisma/client";
import { db } from "@/lib/db";
// Luật PII chung của repo — nguồn sự thật DUY NHẤT cho "ai được xem SĐT/email phụ huynh".
// File này là ma trận tĩnh (không DB, không phiên) nên import được cả trong tsx/ZZTEST.
import { canViewParentContact } from "@/lib/auth/permissions";
import { redactContactsInText } from "@/lib/lead/pii";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";

// ─── Hằng dùng chung ────────────────────────────────────────────────────────

/** US-12 AC3 — text thay thế cho tin đã gỡ; body thật KHÔNG bao giờ rời DB. */
export const DELETED_MESSAGE_TEXT = "Tin nhắn đã được gỡ";
/** US-08 AC4 — nhãn cạnh tên hội thoại đã lưu trữ. */
export const ARCHIVED_LABEL = "Đã lưu trữ";
/** US-09 AC1 — 30 tin mỗi trang. */
export const DEFAULT_PAGE_SIZE = 30;
/**
 * **BR-04** — sau khi hội thoại chuyển ARCHIVED, PH còn đọc lịch sử thêm 90 ngày;
 * GV/QLCS/Admin KHÔNG hết hạn (nghĩa vụ lưu vết). permissions.md, "Trạng thái đè lên
 * tất cả": `ARCHIVED → Đọc ✅ (PH hết hạn sau 90 ngày …)`. TS-08 bước 2.
 */
export const ARCHIVED_PARENT_READ_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 100;
const DEFAULT_CONVERSATION_LIMIT = 100;
export const MAX_CONVERSATION_LIMIT = 500;
const PREVIEW_MAX_LENGTH = 120;

/**
 * Lỗi tầng đọc chat. Mã EN + thông điệp VI (quy ước API contract Doc 15).
 * `NOT_PARTICIPANT` cũng dùng cho hội thoại KHÔNG TỒN TẠI — cố ý không phân biệt để
 * không ai dò được id hội thoại người khác (TS-01.2/01.4b/01.7 chỉ đòi "403 ngay").
 */
export class ChatQueryError extends Error {
  constructor(
    readonly code: "NOT_PARTICIPANT",
    message: string,
  ) {
    super(message);
    this.name = "ChatQueryError";
  }
}

function notParticipant(): never {
  throw new ChatQueryError(
    "NOT_PARTICIPANT",
    "Bạn không còn là thành viên của hội thoại này.",
  );
}

// ─── PHẦN THUẦN (không DB — unit test ở queries.test.ts) ────────────────────

/** Khoá sắp xếp danh sách hội thoại. */
export type ConversationSortable = {
  conversationId: string;
  lastMessageAt: Date | null;
};

/**
 * US-08 AC2 — `lastMessageAt` GIẢM DẦN, hội thoại chưa có tin nào (null) xếp CUỐI,
 * tie-break bằng id để thứ tự tất định (không "nhảy dòng" giữa 2 lần tải).
 * (Hội thoại ARCHIVED KHÔNG bị đẩy xuống ở đây — AC4 do UI xếp theo cờ `isArchived`.)
 */
export function compareConversations(
  a: ConversationSortable,
  b: ConversationSortable,
): number {
  const ta = a.lastMessageAt?.getTime() ?? null;
  const tb = b.lastMessageAt?.getTime() ?? null;
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  return a.conversationId < b.conversationId ? -1 : a.conversationId > b.conversationId ? 1 : 0;
}

const CURSOR_SEP = "|";

/** Cursor US-09 = cặp `(createdAt, id)` — thứ tự TOÀN PHẦN nên không trùng/sót tin. */
export type MessageCursor = { createdAt: Date; id: string };

/** ISO (giữ mili-giây) + id. Id có thể chứa dấu `|` → chỉ tách ở dấu ĐẦU TIÊN. */
export function encodeCursor(cursor: MessageCursor): string {
  return `${cursor.createdAt.toISOString()}${CURSOR_SEP}${cursor.id}`;
}

/** Cursor hỏng/thiếu → null = trang đầu (không ném lỗi ra người dùng). */
export function decodeCursor(raw: string | null | undefined): MessageCursor | null {
  if (!raw) return null;
  const sep = raw.indexOf(CURSOR_SEP);
  if (sep <= 0) return null;
  const id = raw.slice(sep + 1);
  if (!id) return null;
  const createdAt = new Date(raw.slice(0, sep));
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

/**
 * BR-04 — mốc "archive trước thời điểm này thì PH hết hạn đọc". Dùng CHUNG cho cả hai
 * đường: điều kiện SQL trong {@link listConversationsForUser} và hàm thuần
 * {@link isArchivedReadExpired} của cổng chặn — một quy tắc, một chỗ tính.
 */
export function archivedReadCutoff(now: Date): Date {
  return new Date(now.getTime() - ARCHIVED_PARENT_READ_DAYS * DAY_MS);
}

/** Ba mẩu cần để áp BR-04 — nhận rời nhau nên test được không cần DB. */
export type ArchivedReadInput = {
  /** `Conversation.status` */
  status: string;
  /** `Conversation.archivedAt` */
  archivedAt: Date | null;
  /** Tư cách của NGƯỜI ĐỌC trong hội thoại (`ConversationParticipant.derivedFrom`). */
  derivedFrom: string | null;
  now: Date;
};

/**
 * **BR-04** — `true` = PH đã quá hạn 90 ngày đọc lịch sử hội thoại đã lưu trữ.
 *
 * Chỉ áp cho PH: quy tắc phân biệt theo `derivedFrom = CLASS_STUDENT_PARENT` (tư cách
 * TRONG hội thoại) chứ không theo `User.role` — người vừa là GV vừa là PH đứng trong
 * nhóm với đúng một tư cách, và ma trận nói "GV/QLCS/Admin không hết hạn".
 *
 * `archivedAt = null` → KHÔNG hết hạn (fail-open có chủ đích): không có mốc thì không
 * tính được 90 ngày, mà chặn nhầm PH khỏi lịch sử lớp CỦA CON MÌNH là hỏng chức năng
 * chứ không phải rò rỉ. Đường archive thật (`lib/chat/sync-membership.ts` — lớp
 * COMPLETED/CANCELLED) LUÔN ghi `archivedAt`, nên nhánh này chỉ chạm dữ liệu cũ / bản
 * ghi sửa tay.
 *
 * Biên: đúng 90 ngày vẫn ĐỌC ĐƯỢC (`>`, không phải `>=`) — "hết hạn SAU 90 ngày".
 */
export function isArchivedReadExpired(input: ArchivedReadInput): boolean {
  if (input.status !== "ARCHIVED") return false;
  if (input.derivedFrom !== "CLASS_STUDENT_PARENT") return false;
  if (!input.archivedAt) return false;
  return input.archivedAt.getTime() < archivedReadCutoff(input.now).getTime();
}

/**
 * BR-30 — che mọi thứ TRÔNG GIỐNG liên hệ trong một chuỗi tự do.
 * Cần vì `User.name` của tài khoản sinh từ lead cũ hay là "PH 0905123456": chỉ bỏ
 * cột `phone`/`email` khỏi payload là chưa đủ, SĐT vẫn đi lọt qua đường tên hiển thị.
 *
 * ⚠️ 22/08/2026 — hai biểu thức nhận diện đã CHUYỂN sang `lib/lead/pii.ts` và
 * dùng chung với inbox Messenger (Đợt E). Giữ tên hàm này để không phải sửa 6
 * chỗ gọi trong module chat, nhưng LUẬT chỉ còn ở một nơi. Đừng chép regex về lại.
 */
export function redactContactLike(text: string): string {
  return redactContactsInText(text) ?? "";
}

/** Người xem — chỉ 3 mẩu cần để quyết định ẩn liên hệ. */
export type ContactViewer = {
  role?: string | null;
  roles?: readonly string[] | null;
  /** Tư cách của chính người xem trong hội thoại (ConversationParticipant.derivedFrom). */
  derivedFrom?: string | null;
};

/**
 * BR-30 — quyết định "ẩn hay không" nằm ở TẦNG QUERY (permissions.md: PH thấy bản ẩn
 * liên hệ). FAIL-CLOSED: không nhận ra người xem là nhân viên → ẩn. Người vừa là GV
 * vừa là PH cũng ẩn (giữ nguyên văn "người xem có vai PARENT").
 *
 * ⚠️ Đây là tầng 1 — "người xem có được thấy liên hệ của BẤT KỲ AI không". Tầng 2
 * (liên hệ của TỪNG thành viên) ở {@link hidesContactOf}.
 */
export function shouldHideContacts(viewer: ContactViewer): boolean {
  if (viewer.derivedFrom === "CLASS_STUDENT_PARENT") return true;
  if (viewer.role === "PARENT") return true;
  if (viewer.roles?.includes("PARENT")) return true;
  // Nhân viên = có vai chính hoặc vai phụ KHÁC PARENT.
  const staff = [viewer.role, ...(viewer.roles ?? [])].filter(
    (r): r is string => typeof r === "string" && r.length > 0 && r !== "PARENT",
  );
  return staff.length === 0;
}

/** Ba mẩu quyết định liên hệ của MỘT thành viên có được trả về hay không. */
export type ContactVisibilityInput = {
  /** `Conversation.type` dạng text. */
  conversationType: string;
  viewer: ContactViewer;
  /** Tư cách của THÀNH VIÊN đang xét (`ConversationParticipant.derivedFrom`). */
  memberDerivedFrom: string | null;
};

/**
 * **BR-30 (mở rộng 09/08/2026)** — `true` = KHÔNG trả `phone`/`email` của thành viên này.
 *
 *  1. Người xem là PH ⇒ ẩn liên hệ của TẤT CẢ ({@link shouldHideContacts}, luật cũ,
 *     permissions.md: "PH thấy bản ẩn liên hệ").
 *  2. Hội thoại KHÔNG phải nhóm lớp (tức 1-1) ⇒ ẩn với MỌI người xem. Bảng
 *     "1-1 (DM_TEACHER_PARENT)" của `docs/chat-realtime/permissions.md` chỉ có 3 dòng
 *     Tạo/mở · Đọc · Gửi — KHÔNG có dòng "Xem thành viên" nào. Không ô nào cấp quyền thì
 *     mặc định là KHÔNG, chứ không phải "cứ cho vì tiện": màn thành viên của 1-1 vốn chỉ
 *     có đúng hai người, chẳng ai cần tra SĐT ở đó.
 *  3. Người xem KHÔNG nằm trong nhóm vai được xem liên hệ phụ huynh ⇒ ẩn — **kể cả GV**.
 *
 * ⚠️ ĐIỂM 3 LÀ QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN (09/08/2026), đừng vá ngược.
 * Repo từng có HAI luật ngược nhau và chúng ngủ yên vì chưa màn hình nhân viên nào thật sự
 * vẽ liên hệ ra: luật PII chung (`canViewParentContact`, `lib/auth/permissions.ts` — chú
 * thích ghi rõ "P0-3: chống lộ SĐT toàn lớp ở trang tiến độ lớp") CHẶN giáo viên, trong khi
 * module chat lại pin chiều cho phép ở 3 chỗ. Màn "danh sách thành viên nhóm lớp" của US-13
 * đánh thức đúng mâu thuẫn đó. Chủ dự án chốt: theo luật PII chung.
 *
 * ⇒ Nguồn sự thật DUY NHẤT cho câu hỏi này nay là `canViewParentContact`. Đừng chép lại
 * danh sách vai vào đây: hai bản sao là hai luật, và lần trước chính hai bản sao đẻ ra mâu
 * thuẫn này.
 */
export function hidesContactOf(input: ContactVisibilityInput): boolean {
  if (shouldHideContacts(input.viewer)) return true;
  if (input.conversationType !== "CLASS_GROUP") return true;
  return !canViewParentContact({
    role: input.viewer.role,
    roles: input.viewer.roles ? [...input.viewer.roles] : null,
  });
}

/** Tin nhắn thô đọc từ DB (subset của Message). */
export type MessageRow = {
  id: string;
  conversationId: string;
  kind: MessageKind;
  senderId: string | null;
  body: string;
  replyToId: string | null;
  clientMsgId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

/**
 * Tin nhắn trả cho client. `body` của tin đã gỡ LUÔN là {@link DELETED_MESSAGE_TEXT}
 * (US-12 AC3) — không có `deletedReason`/`deletedById` (thông tin của kiểm duyệt).
 * KHÔNG kèm tên người gửi: UI ghép `senderId` với {@link getConversationMembers} để
 * việc ẩn liên hệ BR-30 chỉ có MỘT chỗ quyết định.
 */
export type ChatMessageView = {
  id: string;
  conversationId: string;
  kind: MessageKind;
  senderId: string | null;
  body: string;
  deleted: boolean;
  replyToId: string | null;
  clientMsgId: string | null;
  createdAt: Date;
};

export function toMessageView(row: MessageRow): ChatMessageView {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    kind: row.kind,
    senderId: row.senderId,
    body: deleted ? DELETED_MESSAGE_TEXT : row.body,
    deleted,
    replyToId: row.replyToId,
    clientMsgId: row.clientMsgId,
    createdAt: row.createdAt,
  };
}

/** Tin cuối dùng cho dòng preview trong danh sách hội thoại. */
export type ConversationPreview = {
  id: string;
  kind: MessageKind;
  senderId: string | null;
  createdAt: Date;
  text: string;
  deleted: boolean;
};

export function buildPreview(
  row: Pick<MessageRow, "id" | "kind" | "senderId" | "body" | "createdAt" | "deletedAt"> | null,
): ConversationPreview | null {
  if (!row) return null;
  const deleted = row.deletedAt !== null;
  const flat = row.body.replace(/\s+/g, " ").trim();
  const text = deleted
    ? DELETED_MESSAGE_TEXT
    : flat.length > PREVIEW_MAX_LENGTH
      ? `${flat.slice(0, PREVIEW_MAX_LENGTH)}…`
      : flat;
  return { id: row.id, kind: row.kind, senderId: row.senderId, createdAt: row.createdAt, text, deleted };
}

/** Thành viên thô (participant × user × con của PH trong lớp). */
export type ConversationMemberSource = {
  userId: string;
  role: ParticipantRole;
  derivedFrom: DerivedFrom | null;
  joinedAt: Date;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** Tên các con của PH này đang thuộc lớp — chỉ để dựng nhãn "PH của ...". */
  childNames: string[];
};

/**
 * Thành viên trả cho client. Khoá `contact` **KHÔNG TỒN TẠI** khi người xem là PH —
 * không phải `null`, không phải chuỗi rỗng: payload sạch tuyệt đối (BR-30/TS-04.4).
 * `address` không bao giờ có mặt, kể cả với nhân viên (không phải nhu cầu của màn chat).
 */
export type ConversationMemberView = {
  userId: string;
  displayName: string;
  role: ParticipantRole;
  derivedFrom: DerivedFrom | null;
  roleLabel: string;
  joinedAt: Date;
  contact?: { phone: string | null; email: string | null };
};

function roleLabelOf(derivedFrom: DerivedFrom | null, childNames: string[]): string {
  if (derivedFrom === "CLASS_TEACHER") return "Giáo viên";
  if (derivedFrom === "CENTER_MANAGER") return "Quản lý cơ sở";
  if (derivedFrom === "CLASS_STUDENT_PARENT") {
    return childNames.length > 0 ? `PH của ${childNames.join(", ")}` : "Phụ huynh";
  }
  return "Thành viên";
}

export function toMemberView(
  source: ConversationMemberSource,
  opts: {
    /** Người xem là PH → bôi tên/nhãn VÀ bỏ hẳn `contact` (BR-30 mức hội thoại). */
    hideContacts: boolean;
    /**
     * Riêng liên hệ của THÀNH VIÊN NÀY bị ẩn ({@link hidesContactOf}) — tên/nhãn giữ
     * nguyên. Tách khỏi `hideContacts` vì hai câu hỏi khác nhau: "người xem có phải PH
     * không" (bôi tên) và "người xem có được thấy SĐT của CHÍNH người này không".
     */
    hideContact?: boolean;
  },
): ConversationMemberView {
  // Không rơi về phone/email làm tên khi `name` rỗng — đó chính là đường rò của
  // `displayName()` trong sync-membership (chỗ đó chỉ ghi SYSTEM message nội bộ).
  const rawName = source.name?.trim() ? source.name.trim() : "Thành viên";
  const label = roleLabelOf(source.derivedFrom, source.childNames);
  const base: ConversationMemberView = {
    userId: source.userId,
    displayName: opts.hideContacts ? redactContactLike(rawName) : rawName,
    role: source.role,
    derivedFrom: source.derivedFrom,
    roleLabel: opts.hideContacts ? redactContactLike(label) : label,
    joinedAt: source.joinedAt,
  };
  if (opts.hideContacts || opts.hideContact) return base; // khoá `contact` không được tạo ra
  return { ...base, contact: { phone: source.phone, email: source.email } };
}

// ─── PHẦN DB ────────────────────────────────────────────────────────────────

/** Field tin nhắn cần cho tầng đọc — dùng chung 2 hàm phân trang. */
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

type ActiveParticipant = {
  id: string;
  role: ParticipantRole;
  derivedFrom: DerivedFrom | null;
  unreadCount: number;
  lastReadMessageId: string | null;
};

/**
 * Cổng chặn DUY NHẤT của tầng đọc, HAI điều kiện:
 *
 *  1. Phải là participant CÒN HIỆU LỰC (`leftAt IS NULL`). TS-01.7 — PH đã rời bị chặn
 *     NGAY, không có grace period ở API.
 *  2. **BR-04** — hội thoại ARCHIVED quá 90 ngày thì PH hết quyền đọc; GV/QLCS/Admin
 *     KHÔNG hết hạn (xem {@link isArchivedReadExpired}).
 *
 * Cả hai đều trả `NOT_PARTICIPANT` — đúng "QUY ƯỚC MÃ LỖI" chốt 09/08
 * (`tests/chat/permission-matrix.spec.ts`): tầng đọc KHÔNG gọi `can()`, cổng của nó là
 * tư cách thành viên, nên mọi deny ở đây là NOT_PARTICIPANT chứ không phải
 * PERMISSION_DENIED.
 *
 * `now` tiêm được để test không phụ thuộc đồng hồ máy (TS-08 "tua thời gian +91 ngày").
 */
async function assertActiveParticipant(
  conversationId: string,
  userId: string,
  now: Date = new Date(),
): Promise<ActiveParticipant> {
  const p = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: {
      id: true,
      role: true,
      derivedFrom: true,
      leftAt: true,
      unreadCount: true,
      lastReadMessageId: true,
      // Một lượt đi-về: trạng thái + mốc lưu trữ đi kèm luôn (BR-04), không bắn thêm
      // query cho `Conversation`.
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
  return {
    id: p.id,
    role: p.role,
    derivedFrom: p.derivedFrom,
    unreadCount: p.unreadCount,
    lastReadMessageId: p.lastReadMessageId,
  };
}

/**
 * Phương án B (SSE) — cùng cổng {@link assertActiveParticipant} nhưng trả boolean, cho tầng
 * realtime hỏi "người này còn được NGHE hội thoại này không" ở mỗi lần giao tin
 * (`lib/chat/realtime-authz.ts`). Chỉ nuốt `NOT_PARTICIPANT`; lỗi khác (DB) ném tiếp để phía
 * gọi fail-closed và KHÔNG cache kết quả.
 */
export async function isActiveChatParticipant(
  conversationId: string,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    await assertActiveParticipant(conversationId, userId, now);
    return true;
  } catch (e) {
    if (e instanceof ChatQueryError && e.code === "NOT_PARTICIPANT") return false;
    throw e;
  }
}

/** Một dòng trong danh sách hội thoại (M1). */
export type ConversationListItem = {
  conversationId: string;
  type: string;
  status: string;
  /** US-08 AC4 — UI xếp nhóm này XUỐNG DƯỚI khối ACTIVE. */
  isArchived: boolean;
  /** "Đã lưu trữ" khi ARCHIVED, "Đang khoá" khi LOCKED, còn lại null. */
  statusLabel: string | null;
  /** Nhóm lớp = TÊN LỚP hiện tại (không phải `Conversation.title` đã chụp lúc tạo). */
  displayName: string;
  lastMessageAt: Date | null;
  unreadCount: number;
  muted: boolean;
  participantRole: ParticipantRole;
  lastReadMessageId: string | null;
  lastMessage: ConversationPreview | null;
  centerId: string | null;
  subjectId: string | null;
};

type ConversationRowRaw = {
  conversationId: string;
  type: string;
  status: string;
  title: string | null;
  lastMessageAt: Date | null;
  subjectId: string | null;
  centerId: string | null;
  participantRole: ParticipantRole;
  unreadCount: number;
  muted: boolean;
  lastReadMessageId: string | null;
  className: string | null;
  /** US-13 — tên NGƯỜI CÒN LẠI của hội thoại 1-1 (null với nhóm lớp). */
  peerName: string | null;
};

type PreviewRowRaw = {
  conversationId: string;
  id: string;
  kind: MessageKind;
  senderId: string | null;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
};

function statusLabelOf(status: string): string | null {
  if (status === "ARCHIVED") return ARCHIVED_LABEL;
  if (status === "LOCKED") return "Đang khoá";
  return null;
}

/**
 * US-08 AC1/AC2/AC4 — mọi hội thoại user đang là thành viên CÒN HIỆU LỰC.
 *
 * Phạm vi = `ConversationParticipant.leftAt IS NULL`, KHÔNG lọc theo cơ sở: PH thấy
 * nhóm lớp của con, GV thấy lớp mình dạy (kể cả dạy chéo cơ sở — TS-01.5), QLCS thấy
 * lớp cơ sở mình vì service đồng bộ đã cho họ vào nhóm.
 *
 * **BR-04** — hội thoại ARCHIVED quá 90 ngày BIẾN MẤT khỏi danh sách của PH (GV/QLCS/
 * Admin vẫn thấy). Lọc ngay trong SQL chứ không lọc sau khi trả về: `LIMIT` chạy trước
 * ở tầng DB, lọc sau sẽ ăn mất dòng hợp lệ của trang.
 *
 * HIỆU NĂNG (không N+1 theo số hội thoại): đúng **2 truy vấn** bất kể user có bao
 * nhiêu hội thoại — (1) participant ⨝ conversation ⨝ class, (2) `DISTINCT ON` lấy tin
 * cuối của từng hội thoại (bám index `Message(conversationId, createdAt DESC)`).
 *
 * `withPreview: false` bỏ hẳn truy vấn (2) và trả `lastMessage: null`. Dành cho người
 * gọi CHỈ cần con số (badge chưa đọc) — đường đó chạy ở layout của cả 3 site và ở mỗi
 * lượt `GET /api/chat/unread`, dựng preview cho tới 100 hội thoại rồi vứt đi là lãng phí
 * thấy rõ. Phạm vi hội thoại vẫn do truy vấn (1) quyết định nên **định nghĩa "hội thoại
 * của tôi" không đổi** — badge và màn danh sách vẫn là một nguồn.
 */
export async function listConversationsForUser(
  userId: string,
  opts?: { limit?: number; now?: Date; withPreview?: boolean },
): Promise<ConversationListItem[]> {
  const limit = Math.min(
    Math.max(opts?.limit ?? DEFAULT_CONVERSATION_LIMIT, 1),
    MAX_CONVERSATION_LIMIT,
  );
  // Sinh đôi SQL của `isArchivedReadExpired` — cùng mốc, cùng biên (`<` = đúng 90 ngày
  // vẫn thấy), cùng điều kiện "chỉ PH" và "archivedAt NULL thì không hết hạn".
  const archivedCutoff = archivedReadCutoff(opts?.now ?? new Date());

  // (1) Truy vấn chính. Raw có chủ đích: gộp 3 bảng trong MỘT lượt đi-về (Prisma
  // `include` bắn thêm query cho từng quan hệ), và Postgres cần `NULLS LAST` tường minh
  // cho `DESC` — hội thoại chưa có tin nào phải xuống cuối, không lên đầu.
  // `Class` ∈ SCOPED_MODELS nhưng đây là `db` trần (không extension) → không bị lọc.
  const rows = await db.$queryRaw<ConversationRowRaw[]>`
    SELECT
      c."id"                AS "conversationId",
      c."type"::text        AS "type",
      c."status"::text      AS "status",
      c."title"             AS "title",
      c."lastMessageAt"     AS "lastMessageAt",
      c."subjectId"         AS "subjectId",
      c."centerId"          AS "centerId",
      p."role"::text        AS "participantRole",
      p."unreadCount"       AS "unreadCount",
      p."muted"             AS "muted",
      p."lastReadMessageId" AS "lastReadMessageId",
      cls."name"            AS "className",
      -- US-13: hội thoại 1-1 không có lớp để lấy tên ⇒ tên hiển thị là NGƯỜI CÒN LẠI.
      -- CASE bọc ngoài để truy vấn con KHÔNG chạy với nhóm lớp (đa số dòng).
      -- Dựng tên ở đây thay vì ghi cứng vào Conversation.title lúc tạo: title bị đông
      -- cứng (đổi tên người dùng không cập nhật) và cả hai bên sẽ thấy CÙNG một tên —
      -- tức phụ huynh nhìn thấy tên của chính mình.
      CASE WHEN c."type"::text <> 'CLASS_GROUP' THEN (
        SELECT u."name"
        FROM "ConversationParticipant" pp
        JOIN "User" u ON u."id" = pp."userId"
        WHERE pp."conversationId" = c."id"
          AND pp."userId" <> ${userId}
        ORDER BY pp."leftAt" NULLS FIRST, pp."joinedAt" ASC
        LIMIT 1
      ) END                 AS "peerName"
    FROM "ConversationParticipant" p
    JOIN "Conversation" c ON c."id" = p."conversationId"
    LEFT JOIN "Class" cls
      ON cls."id" = c."subjectId"
     AND c."type"::text = 'CLASS_GROUP'
     AND c."subjectType"::text = 'CLASS'
    WHERE p."userId" = ${userId}
      AND p."leftAt" IS NULL
      AND NOT (
        c."status"::text = 'ARCHIVED'
        AND p."derivedFrom"::text = 'CLASS_STUDENT_PARENT'
        AND c."archivedAt" IS NOT NULL
        AND c."archivedAt" < ${archivedCutoff}
      )
    ORDER BY c."lastMessageAt" DESC NULLS LAST, c."id" ASC
    LIMIT ${limit}
  `;
  if (rows.length === 0) return [];

  // BR-30 — tên người còn lại của một DM rất có thể LÀ liên hệ ("PH 0905123456" với tài
  // khoản sinh từ lead cũ). Người xem có vai PARENT thì che phần trông giống SĐT/email,
  // đúng luật đã áp ở `getConversationMembers`. Chỉ hỏi vai người xem KHI thật sự có DM
  // trong danh sách — đường này còn chạy ở mọi lần dựng badge chưa đọc của cả 3 site.
  const peerNames = rows.filter((r) => (r.peerName ?? "").trim().length > 0);
  let hidePeerContacts = true; // fail-closed: không biết người xem là ai thì che
  if (peerNames.length > 0) {
    const viewer = await db.user.findUnique({
      where: { id: userId },
      select: { role: true, roles: true },
    });
    hidePeerContacts = shouldHideContacts({
      role: viewer?.role ?? null,
      roles: viewer?.roles ?? null,
    });
  }
  const peerDisplayName = (raw: string | null): string | null => {
    const name = (raw ?? "").trim();
    if (!name) return null;
    return hidePeerContacts ? redactContactLike(name) : name;
  };

  // (2) Tin cuối của TỪNG hội thoại trong một truy vấn — `DISTINCT ON` là cách duy
  // nhất trong Postgres lấy "bản ghi đầu mỗi nhóm" mà không phải bắn N query.
  const ids = rows.map((r) => r.conversationId);
  const previews: PreviewRowRaw[] = opts?.withPreview === false
    ? []
    : await db.$queryRaw<PreviewRowRaw[]>`
    SELECT DISTINCT ON (m."conversationId")
      m."conversationId", m."id", m."kind"::text AS "kind", m."senderId",
      m."body", m."createdAt", m."deletedAt"
    FROM "Message" m
    WHERE m."conversationId" = ANY(${ids}::text[])
    ORDER BY m."conversationId", m."createdAt" DESC, m."id" DESC
  `;
  const previewByConv = new Map(previews.map((m) => [m.conversationId, m]));

  return rows
    .map((r) => ({
      conversationId: r.conversationId,
      type: r.type,
      status: r.status,
      isArchived: r.status === "ARCHIVED",
      statusLabel: statusLabelOf(r.status),
      displayName: r.className ?? peerDisplayName(r.peerName) ?? r.title ?? "Hội thoại",
      lastMessageAt: r.lastMessageAt,
      unreadCount: r.unreadCount,
      muted: r.muted,
      participantRole: r.participantRole,
      lastReadMessageId: r.lastReadMessageId,
      lastMessage: buildPreview(previewByConv.get(r.conversationId) ?? null),
      centerId: r.centerId,
      subjectId: r.subjectId,
    }))
    .sort(compareConversations); // cùng quy tắc với ORDER BY — giữ 1 nơi kiểm chứng
}

export type MessagePage = {
  /** MỚI → CŨ (cùng chiều với cursor). UI đảo lại khi render luồng chat. */
  messages: ChatMessageView[];
  hasMore: boolean;
  nextCursor: string | null;
};

/**
 * US-09 AC1 — 30 tin mới nhất, cuộn lên tải tiếp bằng cursor `(createdAt, id)`.
 * KHÔNG OFFSET: tin mới chèn vào trong lúc người dùng cuộn cũng không làm lệch trang.
 * Cặp `(createdAt, id)` là thứ tự TOÀN PHẦN nên nhiều tin trùng `createdAt` tới
 * mili-giây vẫn không trùng/sót ở ranh giới trang.
 */
export async function getMessagesPage(
  conversationId: string,
  userId: string,
  opts?: { cursor?: string | null; limit?: number; now?: Date },
): Promise<MessagePage> {
  await assertActiveParticipant(conversationId, userId, opts?.now);

  const limit = Math.min(Math.max(opts?.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const cursor = decodeCursor(opts?.cursor);
  const rows = await db.message.findMany({
    where: {
      conversationId,
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
    messages: page.map(toMessageView),
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

export type MessagesSincePage = {
  /** CŨ → MỚI, đúng thứ tự để nối vào cuối luồng đang mở. */
  messages: ChatMessageView[];
  hasMore: boolean;
  /** Truyền lại vào `lastSeenMessageId` để lấy trang kế khi `hasMore`. */
  nextSinceMessageId: string | null;
};

/**
 * US-07 AC2 — reconcile sau khi mất mạng: trả các tin SAU `lastSeenMessageId`.
 *
 * `lastSeenMessageId = null` (hoặc id không thuộc hội thoại này — client giữ id cũ của
 * hội thoại khác) → trả từ tin ĐẦU TIÊN. Không ném lỗi: mục tiêu của reconcile là
 * không bao giờ mất tin, và id lạ không lộ gì vì mọi truy vấn đều khoá theo
 * `conversationId` mà người gọi đã qua cổng participant.
 */
export async function fetchMessagesSince(
  conversationId: string,
  userId: string,
  lastSeenMessageId: string | null,
  opts?: { limit?: number; now?: Date },
): Promise<MessagesSincePage> {
  await assertActiveParticipant(conversationId, userId, opts?.now);

  const limit = Math.min(Math.max(opts?.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const anchor = lastSeenMessageId
    ? await db.message.findFirst({
        where: { id: lastSeenMessageId, conversationId },
        select: { id: true, createdAt: true },
      })
    : null;

  const rows = await db.message.findMany({
    where: {
      conversationId,
      ...(anchor
        ? {
            OR: [
              { createdAt: { gt: anchor.createdAt } },
              { createdAt: anchor.createdAt, id: { gt: anchor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: MESSAGE_SELECT,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    messages: page.map(toMessageView),
    hasMore,
    nextSinceMessageId: last?.id ?? null,
  };
}

/**
 * US-08/M4 + **BR-30** — danh sách thành viên còn hiệu lực.
 *
 * Người xem có vai PARENT → payload KHÔNG chứa `phone`/`email`/`address` của BẤT KỲ AI,
 * kể cả GV (permissions.md: "PH thấy bản ẩn liên hệ"). Quyết định nằm ở ĐÂY, không ở
 * UI — mọi bề mặt (server action, route, RSC) gọi hàm này đều nhận cùng một bản đã lọc.
 */
export async function getConversationMembers(
  conversationId: string,
  viewerUserId: string,
  opts?: { now?: Date },
): Promise<ConversationMemberView[]> {
  const viewerParticipant = await assertActiveParticipant(
    conversationId,
    viewerUserId,
    opts?.now,
  );

  const [conversation, participants] = await Promise.all([
    db.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true, subjectType: true, subjectId: true },
    }),
    db.conversationParticipant.findMany({
      where: { conversationId, leftAt: null },
      select: { userId: true, role: true, derivedFrom: true, joinedAt: true },
      orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
    }),
  ]);
  if (participants.length === 0) return [];

  const userIds = participants.map((p) => p.userId);
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, phone: true, email: true, role: true, roles: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const viewer = userById.get(viewerUserId);
  const viewerCtx: ContactViewer = {
    role: viewer?.role ?? null,
    roles: viewer?.roles ?? null,
    derivedFrom: viewerParticipant.derivedFrom,
  };
  // `hideContacts` (mức hội thoại) vẫn quyết định việc BÔI tên/nhãn — tên "PH 0905…"
  // chỉ được che khi người xem là PH. Việc trả `contact` thì xét TỪNG thành viên.
  const hideContacts = shouldHideContacts(viewerCtx);
  const conversationType = conversation?.type ?? "CLASS_GROUP";

  // Nhãn "PH của <tên học viên>": con của từng PH ĐANG thuộc lớp của nhóm này.
  // `Student`/`Enrollment` ∈ SCOPED_MODELS — `db` trần cố ý (xem đầu file); `deletedAt`
  // của quan hệ lồng phải viết tay (extension soft-delete chỉ áp ở truy vấn top-level).
  const childNamesByParent = new Map<string, string[]>();
  const classId =
    conversation?.type === "CLASS_GROUP" && conversation.subjectType === "CLASS"
      ? conversation.subjectId
      : null;
  if (classId) {
    const parentIds = participants
      .filter((p) => p.derivedFrom === "CLASS_STUDENT_PARENT")
      .map((p) => p.userId);
    if (parentIds.length > 0) {
      const students = await db.student.findMany({
        where: {
          parentUserId: { in: parentIds },
          deletedAt: null,
          enrollments: {
            some: {
              classId,
              deletedAt: null,
              status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
            },
          },
        },
        select: { name: true, parentUserId: true },
        orderBy: { name: "asc" },
      });
      for (const s of students) {
        if (!s.parentUserId) continue;
        const list = childNamesByParent.get(s.parentUserId) ?? [];
        list.push(s.name);
        childNamesByParent.set(s.parentUserId, list);
      }
    }
  }

  return participants.map((p) => {
    const u = userById.get(p.userId);
    return toMemberView(
      {
        userId: p.userId,
        role: p.role,
        derivedFrom: p.derivedFrom,
        joinedAt: p.joinedAt,
        name: u?.name ?? null,
        phone: u?.phone ?? null,
        email: u?.email ?? null,
        childNames: childNamesByParent.get(p.userId) ?? [],
      },
      {
        hideContacts,
        hideContact: hidesContactOf({
          conversationType,
          viewer: viewerCtx,
          memberDerivedFrom: p.derivedFrom,
        }),
      },
    );
  });
}

export type MarkReadResult = {
  unreadCount: 0;
  lastReadMessageId: string | null;
  lastReadAt: Date;
};

/**
 * US-07 AC5 — hội thoại đang mở ở foreground: `unreadCount` về 0 + ghi mốc đã đọc.
 * Idempotent: gọi lại với cùng tham số cho cùng kết quả, không sinh bản ghi mới.
 */
export async function markConversationRead(
  conversationId: string,
  userId: string,
  lastReadMessageId: string | null,
  opts?: { now?: Date },
): Promise<MarkReadResult> {
  // BR-04 áp cả ở đây: PH đã hết hạn đọc thì cũng không còn gì để "đánh dấu đã đọc".
  await assertActiveParticipant(conversationId, userId, opts?.now);

  const lastReadAt = new Date();
  await db.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { unreadCount: 0, lastReadMessageId, lastReadAt },
  });
  return { unreadCount: 0, lastReadMessageId, lastReadAt };
}
