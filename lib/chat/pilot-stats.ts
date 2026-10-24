// lib/chat/pilot-stats.ts — US-16 AC4: số đo pilot theo TỪNG LỚP.
//
// Trả lời đúng 2 câu hỏi của cổng Đợt 2, cộng 1 câu phái sinh của US-16 AC2:
//   1. % phụ huynh trong nhóm lớp ĐÃ KÍCH HOẠT tài khoản;
//   2. % ĐÃ ĐỌC thông báo ĐẦU TIÊN của nhóm trong vòng 48 giờ;
//   3. % đã bấm đồng ý quy định sử dụng chat (bản đang phát hành).
//
// ⚠️ ĐỌC BẰNG `db` TRẦN, cách ly cơ sở FILTER TAY theo `getVisibleCenterIds(actor)`
// (luật E-bis #5 + delta E.3): `Conversation` ∈ SCOPE_EXEMPT còn `Class` ∈ SCOPED_MODELS —
// đi qua `scopedDb` thì nửa dữ liệu biến mất im lặng và bảng số ra sai mà không ai biết.
//
// ⚠️ KHÔNG `"use server"` / KHÔNG `import "server-only"` — cùng lý do các module chat khác
// (phải chạy được dưới vitest node + `tsx`). Chốt chặn không lọt xuống client là `@/lib/db`.
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { getVisibleCenterIds } from "@/lib/auth/can";
import { isAnnouncementRecipient } from "@/lib/chat/announcements";
import { getChatPolicyAcceptedUserIds } from "@/lib/chat/policy";

/** Cổng Đợt 2 đo "đọc trong 48h" — hằng của KR2, không phải tham số cấu hình. */
export const PILOT_READ_WINDOW_HOURS = 48;
const PILOT_READ_WINDOW_MS = PILOT_READ_WINDOW_HOURS * 60 * 60 * 1000;

/** Trần số lớp mỗi lần xem — pilot vài chục lớp; trần chỉ để trang không tự sát. */
export const PILOT_CLASS_LIMIT = 200;

// ─── PHẦN THUẦN (không DB — unit test được) ─────────────────────────────────

export type PilotParent = {
  userId: string;
  /** `ConversationParticipant.derivedFrom` — thắng vai tài khoản khi có. */
  derivedFrom?: string | null;
  role?: string | null;
  roles?: readonly string[] | null;
  /** `User.accountStatus` — "ACTIVE" = đã qua bước kích hoạt (hoặc tạo trước cụm A1). */
  accountStatus?: string | null;
  /** `User.lastLoginAt` — tín hiệu THẬT rằng phụ huynh đã vào được hệ thống. */
  lastLoginAt?: Date | null;
};

export type PilotClassInput = {
  conversationId: string;
  classId: string | null;
  className: string;
  centerName: string | null;
  conversationStatus: string;
  /** Toàn bộ participant còn hiệu lực — hàm tự lọc ra PH bằng `isAnnouncementRecipient`. */
  participants: readonly PilotParent[];
  firstAnnouncement: { messageId: string; createdAt: Date } | null;
  /** `AnnouncementRead` của ĐÚNG thông báo đầu tiên. */
  firstAnnouncementReads: readonly { userId: string; readAt: Date }[];
  acceptedPolicyUserIds: ReadonlySet<string>;
  now: Date;
};

export type PilotClassStats = {
  conversationId: string;
  classId: string | null;
  className: string;
  centerName: string | null;
  conversationStatus: string;
  /** Mẫu số của mọi tỉ lệ: số PH đang là thành viên nhóm. */
  parentCount: number;
  activatedCount: number;
  loggedInCount: number;
  policyAcceptedCount: number;
  firstAnnouncementAt: Date | null;
  /** Đã đọc thông báo đầu TRONG 48h (chỉ đếm PH — GV/QLCS xem cũng sinh AnnouncementRead). */
  readWithinWindowCount: number;
  /** Đã đọc, không giới hạn thời gian — để thấy "muộn còn hơn không". */
  readTotalCount: number;
  /**
   * 48h kể từ thông báo đầu đã trôi qua chưa. `false` = con số CÒN CHẠY, đừng đem đi
   * kết luận cổng Đợt 2 (đây đúng là chỗ một dashboard vô tâm báo "12% đã đọc" cho một
   * thông báo mới đăng 20 phút trước).
   */
  windowClosed: boolean;
};

/** Tỉ lệ phần trăm; mẫu số 0 → `null` (hiển thị "—", KHÔNG phải 0%). */
export function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/**
 * Dựng số đo của MỘT lớp. Hàm THUẦN.
 *
 * Mẫu số dùng chung `isAnnouncementRecipient` với màn "đã đọc x/N" của giáo viên
 * (lib/chat/announcements.ts) — hai chỗ đếm hai kiểu thì GV và BGĐ cãi nhau bằng hai
 * con số cùng tên. Hệ quả cố ý: GV/QLCS/trợ giảng KHÔNG nằm trong mẫu số.
 */
export function buildPilotClassStats(input: PilotClassInput): PilotClassStats {
  const parents = input.participants.filter((p) => isAnnouncementRecipient(p));
  const parentIds = new Set(parents.map((p) => p.userId));

  const first = input.firstAnnouncement;
  const reads = first
    ? input.firstAnnouncementReads.filter((r) => parentIds.has(r.userId))
    : [];
  const withinWindow = first
    ? reads.filter(
        (r) => r.readAt.getTime() - first.createdAt.getTime() <= PILOT_READ_WINDOW_MS,
      )
    : [];

  return {
    conversationId: input.conversationId,
    classId: input.classId,
    className: input.className,
    centerName: input.centerName,
    conversationStatus: input.conversationStatus,
    parentCount: parents.length,
    activatedCount: parents.filter((p) => p.accountStatus === "ACTIVE").length,
    loggedInCount: parents.filter((p) => p.lastLoginAt != null).length,
    policyAcceptedCount: parents.filter((p) => input.acceptedPolicyUserIds.has(p.userId))
      .length,
    firstAnnouncementAt: first?.createdAt ?? null,
    readWithinWindowCount: withinWindow.length,
    readTotalCount: reads.length,
    windowClosed: first
      ? input.now.getTime() - first.createdAt.getTime() >= PILOT_READ_WINDOW_MS
      : false,
  };
}

export type PilotTotals = {
  classCount: number;
  parentCount: number;
  activatedCount: number;
  loggedInCount: number;
  policyAcceptedCount: number;
  /** Mẫu số riêng: chỉ những lớp ĐÃ có thông báo đầu (lớp chưa có thì không tính vào). */
  classesWithAnnouncement: number;
  announcementRecipientCount: number;
  readWithinWindowCount: number;
};

/** Cộng dồn để hàng "Tổng" không phải trung bình-của-trung-bình (sai với lớp lệch sĩ số). */
export function sumPilotTotals(rows: readonly PilotClassStats[]): PilotTotals {
  const withAnn = rows.filter((r) => r.firstAnnouncementAt !== null);
  return {
    classCount: rows.length,
    parentCount: rows.reduce((s, r) => s + r.parentCount, 0),
    activatedCount: rows.reduce((s, r) => s + r.activatedCount, 0),
    loggedInCount: rows.reduce((s, r) => s + r.loggedInCount, 0),
    policyAcceptedCount: rows.reduce((s, r) => s + r.policyAcceptedCount, 0),
    classesWithAnnouncement: withAnn.length,
    announcementRecipientCount: withAnn.reduce((s, r) => s + r.parentCount, 0),
    readWithinWindowCount: withAnn.reduce((s, r) => s + r.readWithinWindowCount, 0),
  };
}

// ─── PHẦN DB ────────────────────────────────────────────────────────────────

type FirstAnnouncementRow = {
  conversationId: string;
  id: string;
  createdAt: Date;
};

/**
 * Số đo pilot của mọi nhóm lớp trong tầm nhìn của actor.
 *
 * Cách ly cơ sở: lọc TAY theo `getVisibleCenterIds(actor)`. Nhóm lớp có
 * `Conversation.centerId = NULL` (lớp chưa gán cơ sở) bị BỎ QUA — fail-closed, thà thiếu
 * một dòng còn hơn để lớp của cơ sở khác lọt vào bảng số của quản lý cơ sở.
 *
 * 6 truy vấn cố định, không N+1 theo số lớp.
 */
export async function getChatPilotStats(
  actor: Actor,
  opts: { centerId?: string | null; now?: Date } = {},
): Promise<PilotClassStats[]> {
  const visible = getVisibleCenterIds(actor);
  const centerIds = opts.centerId
    ? visible.filter((c) => c === opts.centerId)
    : visible;
  if (centerIds.length === 0) return [];

  const now = opts.now ?? new Date();

  // (1) Nhóm lớp trong tầm nhìn.
  const conversations = await db.conversation.findMany({
    where: { type: "CLASS_GROUP", subjectType: "CLASS", centerId: { in: centerIds } },
    select: {
      id: true,
      status: true,
      subjectId: true,
      centerId: true,
      createdAt: true,
      lastMessageAt: true,
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    take: PILOT_CLASS_LIMIT,
  });
  if (conversations.length === 0) return [];

  const conversationIds = conversations.map((c) => c.id);
  const classIds = conversations
    .map((c) => c.subjectId)
    .filter((x): x is string => !!x);
  const centerIdsUsed = [
    ...new Set(conversations.map((c) => c.centerId).filter((x): x is string => !!x)),
  ];

  // (2) Tên lớp + (3) tên cơ sở + (4) participant còn hiệu lực + (5) thông báo ĐẦU TIÊN.
  // `DISTINCT ON` lấy "bản ghi đầu mỗi nhóm" trong MỘT truy vấn (mẫu đã dùng ở
  // listConversationsForUser). Bỏ tin đã gỡ: đo lượt đọc của một thông báo không còn
  // hiển thị là đo cái không tồn tại nữa.
  // `in: []` là truy vấn hợp lệ trả rỗng — dùng thẳng thay vì nhánh `? :` với mảng rỗng
  // ép kiểu tay (kiểu ép tay đó chính là chỗ lệch thầm lặng khi schema đổi cột).
  const [classes, centers, participants, firstAnnouncements] = await Promise.all([
    db.class.findMany({
      where: { id: { in: classIds } },
      select: { id: true, name: true, classCode: true },
    }),
    db.center.findMany({
      where: { id: { in: centerIdsUsed } },
      select: { id: true, name: true },
    }),
    db.conversationParticipant.findMany({
      where: { conversationId: { in: conversationIds }, leftAt: null },
      select: { conversationId: true, userId: true, derivedFrom: true },
    }),
    db.$queryRaw<FirstAnnouncementRow[]>`
      SELECT DISTINCT ON (m."conversationId")
        m."conversationId", m."id", m."createdAt"
      FROM "Message" m
      WHERE m."conversationId" = ANY(${conversationIds}::text[])
        AND m."kind" = 'ANNOUNCEMENT'::"MessageKind"
        AND m."deletedAt" IS NULL
      ORDER BY m."conversationId", m."createdAt" ASC, m."id" ASC
    `,
  ]);

  const userIds = [...new Set(participants.map((p) => p.userId))];
  const firstIds = firstAnnouncements.map((a) => a.id);

  // (6) Vai + trạng thái tài khoản của thành viên · lượt đọc thông báo đầu · mốc đồng ý.
  // Cột lấy về đúng thứ cần đếm: KHÔNG `phone`/`email`/`name` — bảng này là bảng SỐ, tên
  // người không có việc gì ở đây (bài học BR-30: bỏ cột `phone` thôi là chưa đủ, nên
  // đường an toàn là không select thứ mình không hiển thị).
  const [users, reads, acceptedUserIds] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        role: true,
        roles: true,
        accountStatus: true,
        lastLoginAt: true,
      },
    }),
    db.announcementRead.findMany({
      where: { messageId: { in: firstIds } },
      select: { messageId: true, userId: true, readAt: true },
    }),
    getChatPolicyAcceptedUserIds(userIds),
  ]);

  const classById = new Map(classes.map((c) => [c.id, c]));
  const centerById = new Map(centers.map((c) => [c.id, c.name]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const firstByConv = new Map(firstAnnouncements.map((a) => [a.conversationId, a]));

  const participantsByConv = new Map<string, PilotParent[]>();
  for (const p of participants) {
    const u = userById.get(p.userId);
    const list = participantsByConv.get(p.conversationId) ?? [];
    list.push({
      userId: p.userId,
      derivedFrom: p.derivedFrom,
      role: u?.role ?? null,
      roles: u?.roles ?? null,
      accountStatus: u?.accountStatus ?? null,
      lastLoginAt: u?.lastLoginAt ?? null,
    });
    participantsByConv.set(p.conversationId, list);
  }

  const readsByMessage = new Map<string, { userId: string; readAt: Date }[]>();
  for (const r of reads) {
    const list = readsByMessage.get(r.messageId) ?? [];
    list.push({ userId: r.userId, readAt: r.readAt });
    readsByMessage.set(r.messageId, list);
  }

  return conversations.map((c) => {
    const klass = c.subjectId ? classById.get(c.subjectId) : null;
    const first = firstByConv.get(c.id) ?? null;
    return buildPilotClassStats({
      conversationId: c.id,
      classId: c.subjectId,
      className: klass?.name ?? klass?.classCode ?? "(lớp không còn tồn tại)",
      centerName: c.centerId ? (centerById.get(c.centerId) ?? null) : null,
      conversationStatus: c.status,
      participants: participantsByConv.get(c.id) ?? [],
      firstAnnouncement: first ? { messageId: first.id, createdAt: first.createdAt } : null,
      firstAnnouncementReads: first ? (readsByMessage.get(first.id) ?? []) : [],
      acceptedPolicyUserIds: acceptedUserIds,
      now,
    });
  });
}
