import "server-only";
import { Prisma, type MessageKind } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { sendZaloNotification } from "@/lib/zalo/service";
import { buildChatNewMessageZnsParams } from "@/lib/zalo/templates";
// Cùng ĐỊNH NGHĨA "ai là phụ huynh trong nhóm này" với màn "đã đọc x/N" của thông báo.
// Chép lại thành hàm thứ hai là mở đường cho hai con số lệch nhau về sau.
import { isAnnouncementRecipient } from "@/lib/chat/announcements";
// `redactContactLike` — `User.name` của tài khoản sinh từ lead cũ hay là "PH 0905123456";
// tên người gửi đi thẳng vào tin ZNS nên phải che (BR-30) trước khi rời hệ thống.
import { redactContactLike } from "@/lib/chat/queries";
import {
  isStaffSender,
  isVnQuietHour,
  pickAnchorMessage,
  type AnchorCandidate,
} from "@/lib/chat/zns-notify-rules";

// =============================================================================
// US-14 — BÁO TIN NHẮN MỚI CHO PHỤ HUYNH QUA ZNS ZALO (chốt chủ dự án 09/08/2026,
// thắng bản US-14 gốc trong backlog: kênh là ZNS, KHÔNG phải Web Push).
//
// CHỈ gửi khi ĐỦ CẢ BA:
//   1. hội thoại là CLASS_GROUP  → **nhắn riêng (DM) TUYỆT ĐỐI KHÔNG GỬI**;
//   2. người gửi là GV hoặc quản lý cơ sở (tin của phụ huynh khác KHÔNG kích hoạt);
//   3. phụ huynh CHƯA ĐỌC quá ngưỡng (mặc định 6 tiếng, ô riêng cho THÔNG BÁO).
//
// Vì sao là CRON QUÉT chứ không phải handler sự kiện: điều kiện 3 là ĐỘ TRỄ — lúc tin
// được tạo thì chưa biết 6 tiếng nữa phụ huynh đã đọc chưa. Hệ quả kèm theo (đúng ý
// chủ dự án): tin rơi vào khung cấm 22:00–06:00 VN được HOÃN chứ không mất, và nếu
// trong lúc chờ phụ huynh đã mở hội thoại thì lượt quét sau không còn thấy tin chưa
// đọc nữa ⇒ **tự huỷ, không gửi, không tốn tiền**.
//
// Tắt an toàn NHIỀU TẦNG, tầng nào rỗng cũng KHÔNG ném lỗi:
//   1. `chat.znsNotifyEnabled` = false            → không gửi, không ghi gì;
//   2. `chat.znsTemplateNewMessage` rỗng          → SKIPPED cả lượt (mẫu chưa duyệt);
//   3. đang trong khung cấm giờ VN                → hoãn sang lượt sau 06:00;
//   4. phụ huynh không có SĐT                     → ghi SKIPPED cho riêng người đó;
//   5. thiếu credential Zalo                      → `sendZaloNotification` tự SKIPPED.
//
// ⚠️ Bẫy SIMULATED: có credential nhưng `ZALO_LIVE`/`zalo.znsLive` tắt thì provider trả
// ok với `providerMessageId = "SIMULATED-…"` mà PHỤ HUYNH KHÔNG NHẬN GÌ. Ghi đúng trạng
// thái SIMULATED thay vì SENT — đọc nhầm là "đã nhắc rồi" thì không ai nhắc nữa. Trên
// `test.satarobo.vn` mọi tin đều SIMULATED (creds Zalo chỉ có ở Production).
//
// ⚠️ ĐỌC BẰNG `db` TRẦN, KHÔNG `scopedDb` (luật E-bis #5): tư cách thành viên là dữ kiện
// MỨC HỆ THỐNG; qua scope thì GV dạy chéo cơ sở / học viên chuyển cơ sở bị hiểu nhầm là
// "không phải thành viên". Job này chạy dưới quyền cron, không có actor.
// =============================================================================

// ─── Trần kỹ thuật ───────────────────────────────────────────────────────────
// ⚠️ BÀI HỌC 09/08/2026 — bản đầu của file này có HAI trần TOÀN CỤC (500 cặp / 2000 tin)
// và cả hai đều BỎ ĐÓI VĨNH VIỄN chứ không "trượt sang lượt sau" như chú thích cũ hứa:
//   • 500 cặp lấy theo `orderBy` TẤT ĐỊNH (conversationId, userId) — hàng đã nhắc rồi
//     vẫn thoả `unreadCount > 0` nên KHÔNG rời truy vấn, cửa sổ 500 không bao giờ trôi
//     ⇒ cặp thứ 501 trở đi không bao giờ được nhắc, mà `due` vẫn báo "hết việc".
//   • 2000 tin lấy GỘP mọi hội thoại theo `createdAt asc` ⇒ vài lớp nhắn nhiều nuốt hết
//     hạn ngạch, lớp nào có tin xếp sau vị trí 2000 thì `pickAnchorMessage` luôn trả null.
// Nay: quét ứng viên theo TRANG (hàng đã nhắc bị bỏ qua rồi ĐI TIẾP), và tin mốc hỏi
// RIÊNG cho từng cặp — không còn hạn ngạch nào chia chung giữa các lớp.
/** Số cặp (hội thoại × phụ huynh) đọc lên mỗi trang. */
const CANDIDATE_PAGE_SIZE = 100;
/**
 * Trần TUYỆT ĐỐI số cặp quét trong một lượt — chống cron chạy vô tận nếu dữ liệu nổ.
 * Chạm trần là BẤT THƯỜNG nên có `console.warn`: im lặng chính là cái bẫy của bản cũ.
 */
const MAX_CANDIDATES_SCANNED = 20_000;
/** Số truy vấn tin mốc chạy song song trong một trang. */
const ANCHOR_QUERY_CONCURRENCY = 10;
/**
 * Số tin đọc lên cho MỘT câu hỏi "tin mốc của cặp này là gì".
 * Truy vấn đã lọc sẵn người gửi + loại tin + ngưỡng trễ + mốc đã đọc ⇒ hàng ĐẦU đã là
 * tin mốc; lấy dư vài dòng chỉ để `pickAnchorMessage` (nguồn sự thật của luật) còn chỗ
 * kiểm lại chứ không phải để dò tìm.
 */
const MAX_ANCHOR_ROWS = 5;
/** Chỉ nhìn lại 7 ngày: tin cũ hơn thế mà vẫn chưa đọc thì nhắc cũng vô nghĩa. */
const LOOKBACK_DAYS = 7;

const MINUTE_MS = 60_000;

export interface ChatZnsRunResult {
  /** Lý do lượt này không gửi gì — có mặt nghĩa là job đã chạy nhưng cố ý đứng im. */
  reason?: "DISABLED" | "QUIET_HOURS" | "NO_TEMPLATE";
  /**
   * Số cặp (hội thoại × phụ huynh) đủ điều kiện sau 3 cổng, trong phần ĐÃ QUÉT của lượt.
   * Khi `cappedAtMax` = true thì đây là CẬN DƯỚI (quét dừng sớm vì hết hạn ngạch gửi).
   */
  due: number;
  sent: number;
  simulated: number;
  skipped: number;
  failed: number;
  /** Đã chạm `chat.znsMaxPerRun` — còn tồn đọng, lượt sau gửi tiếp. */
  cappedAtMax: boolean;
}

const EMPTY: ChatZnsRunResult = {
  due: 0,
  sent: 0,
  simulated: 0,
  skipped: 0,
  failed: 0,
  cappedAtMax: false,
};

/** Đọc setting KHÔNG bao giờ làm hỏng cron: key lạ / DB lỗi → rơi về mặc định an toàn. */
async function setting<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** Một cặp (hội thoại × người) lọt vào tập ứng viên. */
type CandidateRow = {
  conversationId: string;
  userId: string;
  muted: boolean;
  lastReadAt: Date | null;
  derivedFrom: string | null;
  conversation: { title: string | null; subjectType: string | null; subjectId: string | null };
};

type AnchorRow = {
  id: string;
  conversationId: string;
  senderId: string | null;
  kind: string;
  createdAt: Date;
};

/** Mốc thời gian + cấu hình của lượt chạy, dựng một lần rồi truyền xuống. */
interface RunContext {
  now: Date;
  horizonStart: Date;
  cooldownStart: Date;
  /** `now - chatDelayMs` — tin thường cũ hơn mốc này mới đủ "chưa đọc quá ngưỡng". */
  chatCutoff: Date;
  announcementCutoff: Date;
  chatDelayMs: number;
  announcementDelayMs: number;
  templateId: string;
  maxPerRun: number;
}

/**
 * Tin mốc ứng viên của MỘT cặp — hỏi RIÊNG cho từng cặp thay vì chia chung một hạn ngạch.
 *
 * Ba cổng của story được đẩy thẳng xuống SQL nên không nhánh nào phía trên phải tự lọc lại:
 *   • `senderId in staffIds`  → cổng 2 (chỉ tin GV/QLCS kích hoạt);
 *   • `OR` theo loại tin      → ngưỡng RIÊNG cho THÔNG BÁO, và `muted` bỏ hẳn nhánh CHAT;
 *   • `gt: lastReadAt`        → tin phụ huynh đã đọc không bao giờ thành mốc.
 * `orderBy createdAt asc` + `take` nhỏ ⇒ hàng đầu là tin CŨ NHẤT chưa đọc — mốc TẤT ĐỊNH
 * mà khoá UNIQUE của sổ gửi dựa vào để chống trùng.
 */
async function loadAnchorRows(args: {
  conversationId: string;
  staffIds: readonly string[];
  lastReadAt: Date | null;
  muted: boolean;
  ctx: RunContext;
}): Promise<AnchorRow[]> {
  const { ctx } = args;
  const kindWindows: { kind: MessageKind; createdAt: { lte: Date } }[] = [
    { kind: "ANNOUNCEMENT", createdAt: { lte: ctx.announcementCutoff } },
  ];
  // AC2: phụ huynh tắt chuông thì tin thường im, THÔNG BÁO vẫn tới.
  if (!args.muted) kindWindows.push({ kind: "CHAT", createdAt: { lte: ctx.chatCutoff } });

  return db.message.findMany({
    where: {
      conversationId: args.conversationId,
      deletedAt: null,
      senderId: { in: [...args.staffIds] },
      createdAt: {
        gte: ctx.horizonStart,
        ...(args.lastReadAt ? { gt: args.lastReadAt } : {}),
      },
      OR: kindWindows,
    },
    select: { id: true, conversationId: true, senderId: true, kind: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: MAX_ANCHOR_ROWS,
  });
}

const pairKey = (conversationId: string, userId: string) => `${conversationId}:${userId}`;
/** Hai phụ huynh cùng lớp, cùng mốc đã đọc, cùng trạng thái chuông ⇒ CÙNG một câu hỏi. */
const anchorQueryKey = (p: CandidateRow) =>
  `${p.conversationId}|${p.lastReadAt ? p.lastReadAt.getTime() : ""}|${p.muted ? 1 : 0}`;

/**
 * Xử lý MỘT trang ứng viên. Trả về số lượt gửi đã dùng (luỹ kế) để tầng gọi biết khi nào
 * chạm `chat.znsMaxPerRun`; các con số khác cộng thẳng vào `result`.
 */
async function processCandidatePage(
  participants: readonly CandidateRow[],
  ctx: RunContext,
  result: ChatZnsRunResult,
  attemptsSoFar: number,
): Promise<number> {
  let attempts = attemptsSoFar;
  const conversationIds = [...new Set(participants.map((p) => p.conversationId))];

  const [members, recentSends] = await Promise.all([
    // Lấy CẢ người đã rời nhóm: giáo viên nghỉ dạy hôm qua vẫn là người gửi tin hôm kia.
    db.conversationParticipant.findMany({
      where: { conversationId: { in: conversationIds } },
      select: { conversationId: true, userId: true, derivedFrom: true },
    }),
    db.chatZnsNotification.findMany({
      where: { conversationId: { in: conversationIds }, createdAt: { gte: ctx.cooldownStart } },
      select: { conversationId: true, userId: true },
    }),
  ]);

  const userIds = [
    ...new Set([...participants.map((p) => p.userId), ...members.map((m) => m.userId)]),
  ];
  const classIds = [
    ...new Set(
      participants
        .filter((p) => p.conversation.subjectType === "CLASS" && p.conversation.subjectId)
        .map((p) => p.conversation.subjectId as string),
    ),
  ];

  const [users, classes] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, role: true, roles: true, phone: true },
    }),
    classIds.length
      ? db.class.findMany({ where: { id: { in: classIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const classNameById = new Map(classes.map((c) => [c.id, c.name]));
  // Tư cách của MỘT người trong MỘT hội thoại — khoá ghép, vì cùng một người có thể
  // là GV ở lớp này và phụ huynh ở lớp khác.
  const derivedByKey = new Map(members.map((m) => [pairKey(m.conversationId, m.userId), m.derivedFrom]));
  const cooledDown = new Set(recentSends.map((r) => pairKey(r.conversationId, r.userId)));

  /** Cổng 2 tính TRƯỚC theo hội thoại để đẩy được xuống SQL của truy vấn tin mốc. */
  const staffIdsByConversation = new Map<string, string[]>();
  for (const m of members) {
    const u = userById.get(m.userId);
    const staff = isStaffSender({
      derivedFrom: m.derivedFrom,
      role: u?.role ?? null,
      roles: u?.roles ?? null,
    });
    if (!staff) continue;
    const list = staffIdsByConversation.get(m.conversationId);
    if (list) list.push(m.userId);
    else staffIdsByConversation.set(m.conversationId, [m.userId]);
  }

  // ── Lọc trước khi hỏi DB: cửa sổ chống bão + "người nhận là PHỤ HUYNH" + nhóm có
  // nhân sự nào từng nhắn không. Ba cái này không cần truy vấn nào.
  const pending = participants.filter((p) => {
    if (cooledDown.has(pairKey(p.conversationId, p.userId))) return false;
    const parent = userById.get(p.userId);
    // Cổng "người nhận là PHỤ HUYNH" — GV/QLCS trong nhóm không bị nhắc bằng ZNS.
    if (
      !isAnnouncementRecipient({
        derivedFrom: p.derivedFrom,
        role: parent?.role ?? null,
        roles: parent?.roles ?? null,
      })
    ) {
      return false;
    }
    return (staffIdsByConversation.get(p.conversationId)?.length ?? 0) > 0;
  });
  if (pending.length === 0) return attempts;

  // ── Hỏi tin mốc: gộp các cặp hỏi trùng nhau (cả lớp chưa ai đọc = MỘT truy vấn),
  // chạy theo cụm song song để một trang không thành 100 vòng đi-về nối đuôi.
  const anchorRowsByQuery = new Map<string, AnchorRow[]>();
  const uniqueQueries = new Map<string, CandidateRow>();
  for (const p of pending) {
    const k = anchorQueryKey(p);
    if (!uniqueQueries.has(k)) uniqueQueries.set(k, p);
  }
  const queryList = [...uniqueQueries.entries()];
  for (let i = 0; i < queryList.length; i += ANCHOR_QUERY_CONCURRENCY) {
    const chunk = queryList.slice(i, i + ANCHOR_QUERY_CONCURRENCY);
    await Promise.all(
      chunk.map(async ([k, p]) => {
        const rows = await loadAnchorRows({
          conversationId: p.conversationId,
          staffIds: staffIdsByConversation.get(p.conversationId) ?? [],
          lastReadAt: p.lastReadAt,
          muted: p.muted,
          ctx,
        });
        anchorRowsByQuery.set(k, rows);
      }),
    );
  }

  /** Tên người gửi đã che liên hệ, dựng sẵn theo tin — tránh dò lại trong vòng lặp. */
  const senderNameByMessageId = new Map<string, string | null>();
  for (const rows of anchorRowsByQuery.values()) {
    for (const m of rows) {
      if (senderNameByMessageId.has(m.id)) continue;
      const rawName = m.senderId ? userById.get(m.senderId)?.name?.trim() : null;
      senderNameByMessageId.set(m.id, rawName ? redactContactLike(rawName) : null);
    }
  }

  const pendingKeys = new Set(pending.map((p) => pairKey(p.conversationId, p.userId)));

  for (const p of participants) {
    if (!pendingKeys.has(pairKey(p.conversationId, p.userId))) continue;

    const rows = anchorRowsByQuery.get(anchorQueryKey(p)) ?? [];
    // Kết luận "người gửi là nhân sự?" vẫn tính lại ở tầng ứng dụng: truy vấn đã lọc,
    // nhưng luật nằm ở `zns-notify-rules.ts` và phải là nơi DUY NHẤT ra quyết định —
    // ai gỡ bộ lọc `senderId` khỏi SQL thì cổng 2 vẫn đứng.
    const candidates: AnchorCandidate[] = rows.map((m) => {
      const sender = m.senderId ? userById.get(m.senderId) : null;
      return {
        id: m.id,
        kind: m.kind,
        createdAt: m.createdAt,
        senderIsStaff: m.senderId
          ? isStaffSender({
              derivedFrom: derivedByKey.get(pairKey(m.conversationId, m.senderId)) ?? null,
              role: sender?.role ?? null,
              roles: sender?.roles ?? null,
            })
          : false,
      };
    });

    const anchor = pickAnchorMessage({
      messages: candidates,
      lastReadAt: p.lastReadAt,
      muted: p.muted, // AC2: tin thường tôn trọng mute, THÔNG BÁO thì không.
      now: ctx.now,
      chatDelayMs: ctx.chatDelayMs,
      announcementDelayMs: ctx.announcementDelayMs,
    });
    if (!anchor) continue;

    result.due++;

    if (attempts >= ctx.maxPerRun) {
      result.cappedAtMax = true;
      continue;
    }

    // GIÀNH CHỖ TRƯỚC KHI GỬI. Hai lượt cron chồng nhau (Vercel retry, pump trên test)
    // thì lượt sau đâm vào UNIQUE và bỏ qua — không có cửa nào trừ tiền hai lần.
    let ledgerId: string;
    try {
      const row = await db.chatZnsNotification.create({
        data: {
          conversationId: p.conversationId,
          userId: p.userId,
          messageId: anchor.id,
          messageKind: anchor.kind as MessageKind,
        },
        select: { id: true },
      });
      ledgerId = row.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }

    const parent = userById.get(p.userId);
    const phone = parent?.phone?.trim();
    if (!phone) {
      // Ghi SKIPPED thay vì bỏ trống: có vết để trả lời "vì sao phụ huynh này không được
      // nhắc" mà không phải dò lại toàn bộ dữ liệu.
      await db.chatZnsNotification.update({
        where: { id: ledgerId },
        data: { status: "SKIPPED", errorMessage: "Phụ huynh chưa có số điện thoại", sentAt: ctx.now },
      });
      result.skipped++;
      continue;
    }

    attempts++;

    const className =
      (p.conversation.subjectType === "CLASS" && p.conversation.subjectId
        ? classNameById.get(p.conversation.subjectId)
        : null) ??
      p.conversation.title ??
      null;
    const senderName = senderNameByMessageId.get(anchor.id) ?? null;

    // KHÔNG có email dự phòng — khác `birthday-zns.ts` là CỐ Ý: kênh này do chủ dự án
    // chốt là ZNS, và khi thiếu credential (đúng tình trạng của môi trường test) thì
    // fallback sẽ bắn email thật cho phụ huynh thật từ một site UAT.
    const res = await sendZaloNotification({
      toPhone: phone,
      templateKey: ctx.templateId,
      params: buildChatNewMessageZnsParams({ className, senderName, at: anchor.createdAt }),
      fallbackEmail: null,
    });

    let status: "SENT" | "SIMULATED" | "SKIPPED" | "FAILED" = res.status;
    if (res.status === "SENT") {
      const log = await db.zaloMessageLog.findUnique({
        where: { id: res.logId },
        select: { providerMessageId: true },
      });
      if (log?.providerMessageId?.startsWith("SIMULATED-")) {
        status = "SIMULATED";
        console.warn(
          `[chat-zns-notify] ZNS SIMULATED (log ${res.logId}) — phụ huynh KHÔNG nhận tin thật (ZALO_LIVE tắt).`,
        );
      }
    }

    await db.chatZnsNotification.update({
      where: { id: ledgerId },
      data: { status, znsLogId: res.logId, sentAt: ctx.now },
    });

    if (status === "SENT") result.sent++;
    else if (status === "SIMULATED") result.simulated++;
    else if (status === "SKIPPED") result.skipped++;
    else result.failed++;
  }

  return attempts;
}

export async function sendChatZnsNotifications(now: Date): Promise<ChatZnsRunResult> {
  const [enabled, templateId, chatMinutes, annMinutes, cooldownMinutes, maxPerRun] =
    await Promise.all([
      setting(() => getSetting("chat.znsNotifyEnabled"), false),
      setting(() => getSetting("chat.znsTemplateNewMessage"), ""),
      setting(() => getSetting("chat.znsUnreadMinutes"), 360),
      setting(() => getSetting("chat.znsAnnouncementUnreadMinutes"), 360),
      setting(() => getSetting("chat.znsCooldownMinutes"), 360),
      setting(() => getSetting("chat.znsMaxPerRun"), 100),
    ]);

  if (!enabled) return { ...EMPTY, reason: "DISABLED" };
  // Khung cấm CSKH của Zalo (mã -133): đứng im, KHÔNG ghi gì. Lượt 06:00 sáng hôm sau
  // sẽ nhặt lại đúng những tin còn chưa đọc — ai đã đọc trong đêm thì tự rơi khỏi danh sách.
  if (isVnQuietHour(now)) return { ...EMPTY, reason: "QUIET_HOURS" };
  if (!templateId.trim()) return { ...EMPTY, reason: "NO_TEMPLATE" };

  const chatDelayMs = chatMinutes * MINUTE_MS;
  const announcementDelayMs = annMinutes * MINUTE_MS;
  const minDelayMs = Math.min(chatDelayMs, announcementDelayMs);
  const newestEligibleAt = new Date(now.getTime() - minDelayMs);

  const ctx: RunContext = {
    now,
    horizonStart: new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * MINUTE_MS),
    cooldownStart: new Date(now.getTime() - cooldownMinutes * MINUTE_MS),
    chatCutoff: new Date(now.getTime() - chatDelayMs),
    announcementCutoff: new Date(now.getTime() - announcementDelayMs),
    chatDelayMs,
    announcementDelayMs,
    templateId,
    maxPerRun,
  };

  const result: ChatZnsRunResult = { ...EMPTY };
  let attempts = 0;
  let scanned = 0;
  let offset = 0;

  for (;;) {
    // ── Cổng 1 nằm ngay ở đây: `type: "CLASS_GROUP"`. DM không bao giờ lọt vào tập ứng
    // viên, nên không có nhánh code nào phía sau gửi nhầm cho hội thoại riêng.
    // `lastReadAt <= newestEligibleAt`: đọc gần đây ⇒ mọi tin chưa đọc đều mới hơn ngưỡng.
    //
    // Phân trang bằng `skip` chứ không cắt cụt bằng `take`: cặp ĐÃ nhắc vẫn thoả `where`
    // (chưa đọc thì `unreadCount` vẫn > 0) nên nếu chỉ lấy N hàng đầu thì chúng chiếm chỗ
    // vĩnh viễn và phần đuôi không bao giờ tới lượt. Trang chạy hết danh sách, hàng đã
    // nhắc bị bỏ qua trong bộ nhớ rồi ĐI TIẾP.
    const participants = await db.conversationParticipant.findMany({
      where: {
        leftAt: null,
        unreadCount: { gt: 0 },
        OR: [{ lastReadAt: null }, { lastReadAt: { lte: newestEligibleAt } }],
        conversation: {
          type: "CLASS_GROUP",
          status: "ACTIVE",
          lastMessageAt: { gte: ctx.horizonStart },
        },
      },
      select: {
        conversationId: true,
        userId: true,
        muted: true,
        lastReadAt: true,
        derivedFrom: true,
        conversation: { select: { title: true, subjectType: true, subjectId: true } },
      },
      orderBy: [{ conversationId: "asc" }, { userId: "asc" }],
      skip: offset,
      take: CANDIDATE_PAGE_SIZE,
    });

    if (participants.length === 0) break;
    offset += participants.length;
    scanned += participants.length;

    attempts = await processCandidatePage(participants, ctx, result, attempts);

    const pageWasFull = participants.length === CANDIDATE_PAGE_SIZE;
    if (attempts >= maxPerRun) {
      // Hết hạn ngạch gửi của lượt này. Còn trang nữa ⇒ chắc chắn còn tồn đọng.
      if (pageWasFull) result.cappedAtMax = true;
      break;
    }
    if (!pageWasFull) break;
    if (scanned >= MAX_CANDIDATES_SCANNED) {
      console.warn(
        `[chat-zns-notify] chạm trần quét ${MAX_CANDIDATES_SCANNED} cặp trong một lượt — phần còn lại dời sang lượt sau. Kiểm xem có phải tồn đọng bất thường không.`,
      );
      break;
    }
  }

  return result;
}
