import "server-only";
// lib/inbox/ingest.ts — NHẬN TIN TỪ KÊNH NGOÀI. Không biết Zalo, không biết Meta.
//
// Webhook của từng nhà cung cấp (chưa dựng — chờ cổng CH-3) chỉ có một việc: dịch
// payload riêng của nó thành `TinDenNgoai` rồi gọi hàm ở đây. Nhờ vậy phần khó —
// chống trùng, tạo hội thoại, đếm chưa đọc, suy đơn vị — viết ĐÚNG MỘT LẦN và
// test được mà không cần một dòng payload thật nào.
//
// ── CHỐNG TRÙNG ─────────────────────────────────────────────────────────────
// Khoá là `@@unique([channel, channelMessageId])` = ID TIN CỦA KÊNH. Nhà cung cấp
// retry (Zalo/Meta đều retry khi không thấy 200 kịp) sẽ gửi lại đúng id đó.
//
// ⚠️ Đừng tin câu "đã có idempotency rồi" từ module chat nội bộ:
// `Message.clientMsgId` là UUID do TRÌNH DUYỆT NGƯỜI GỬI sinh, và với người gửi
// ngoài hệ (`senderId = null`) Postgres coi mọi NULL là khác nhau ⇒ unique đó
// không chặn được gì.
//
// ⚠️ Kiểm trùng phải xảy ra TRƯỚC khi cộng số chưa đọc. Cộng trước rồi mới phát
// hiện trùng là mỗi lần retry lại +1 vào huy hiệu, và không ai truy ra vì sao.
import { Prisma, type InboxChannel } from "@prisma/client";
import { db } from "@/lib/db";
import { tinhChoTraLoi } from "@/lib/inbox/view";

export type TinDenNgoai = {
  channel: InboxChannel;
  /** `oa_id` (Zalo) / `pageId` (Facebook) — tài khoản bên mình nhận tin. */
  accountId: string;
  /** `user_id` (Zalo) / `psid` (Messenger). */
  externalUserId: string;
  /** Zalo OA không có "thread" — bỏ trống thì lấy `externalUserId`. */
  externalThreadId?: string | null;
  /** ID tin của nhà cung cấp. BẮT BUỘC — đây là khoá chống trùng. */
  channelMessageId: string;
  body: string | null;
  attachments?: Prisma.InputJsonValue | null;
  sentAt: Date;
  /** Tên nhà cung cấp trả về (nếu có). Chỉ để người trực nhận ra ai đang nhắn. */
  displayName?: string | null;
};

export type KetQuaNhanTin = {
  conversationId: string;
  messageId: string | null;
  /** `true` = đã có tin này rồi, KHÔNG tạo dòng thứ hai và KHÔNG đụng bộ đếm. */
  duplicate: boolean;
};

/**
 * Tin KHÁCH gửi tới. Tạo danh tính + hội thoại nếu chưa có, ghi tin, cập nhật bộ đếm.
 *
 * Hội thoại mới luôn ra đời MỒ CÔI (`orgUnitId = null`, chưa nối `Lead`) — đó là
 * trạng thái đúng: webhook `user_send_text` của Zalo không bao giờ kèm SĐT.
 */
export async function ingestInboundMessage(tin: TinDenNgoai): Promise<KetQuaNhanTin> {
  const threadId = tin.externalThreadId?.trim() || tin.externalUserId;
  const { hoiThoai } = await layHoacTaoHoiThoai(tin, threadId);

  const tao = await taoTinNeuChuaCo({
    conversationId: hoiThoai.id,
    channel: tin.channel,
    direction: "IN",
    channelMessageId: tin.channelMessageId,
    body: tin.body,
    attachments: tin.attachments ?? undefined,
    sentAt: tin.sentAt,
    orgUnitId: hoiThoai.orgUnitId,
  });
  if (tao.duplicate) {
    return { conversationId: hoiThoai.id, messageId: null, duplicate: true };
  }

  const lastInboundAt = moiHon(hoiThoai.lastInboundAt, tin.sentAt);
  await db.inboxConversation.update({
    where: { id: hoiThoai.id },
    data: {
      lastInboundAt,
      lastMessageAt: moiHon(hoiThoai.lastMessageAt, tin.sentAt),
      unreadCount: { increment: 1 },
      awaitingReply: tinhChoTraLoi({ lastInboundAt, lastOutboundAt: hoiThoai.lastOutboundAt }),
      // Khách nhắn lại thì hội thoại đã đóng phải mở lại — nếu không, tin mới rơi
      // vào một hội thoại không ai còn nhìn và khách ngồi chờ.
      status: hoiThoai.status === "CLOSED" ? "OPEN" : hoiThoai.status,
    },
  });

  return { conversationId: hoiThoai.id, messageId: tao.messageId, duplicate: false };
}

/**
 * Tin ĐI RA mà KHÔNG qua hệ thống — nhân viên trả lời thẳng trên `oa.zalo.me` /
 * Trang Facebook, rồi nhà cung cấp báo lại (`oa_send_text`, echo của Meta).
 *
 * Hai điều phải đúng ở đây:
 *  • `sentByUserId = null` + `sentOutsideSystem = true`: webhook chiều này chỉ có
 *    `sender.id` = id của OA, KHÔNG định danh được người đã gõ. Tỷ lệ dòng này là
 *    chỉ số M-OA-4 — vượt ngưỡng nghĩa là dữ liệu chấm điểm không dùng được.
 *  • Nó VẪN tắt cờ "chưa trả lời": khách thật sự đã được trả lời, chỉ là không qua
 *    hệ thống. Coi như chưa trả lời sẽ đẻ ra một danh sách việc giả.
 *
 * Echo tin do CHÍNH hệ thống vừa gửi cũng đi vào đây và bị chặn bởi khoá chống
 * trùng, vì `sendInboxReply` ghi `channelMessageId = id nhà cung cấp trả về`
 * (spec §4.3 MS-3).
 */
export async function ingestOutboundEcho(tin: TinDenNgoai): Promise<KetQuaNhanTin> {
  const threadId = tin.externalThreadId?.trim() || tin.externalUserId;
  const { hoiThoai } = await layHoacTaoHoiThoai(tin, threadId);

  const tao = await taoTinNeuChuaCo({
    conversationId: hoiThoai.id,
    channel: tin.channel,
    direction: "OUT",
    channelMessageId: tin.channelMessageId,
    body: tin.body,
    attachments: tin.attachments ?? undefined,
    sentAt: tin.sentAt,
    orgUnitId: hoiThoai.orgUnitId,
    sentOutsideSystem: true,
    deliveryStatus: "SENT",
  });
  if (tao.duplicate) {
    return { conversationId: hoiThoai.id, messageId: null, duplicate: true };
  }

  const lastOutboundAt = moiHon(hoiThoai.lastOutboundAt, tin.sentAt);
  await db.inboxConversation.update({
    where: { id: hoiThoai.id },
    data: {
      lastOutboundAt,
      lastMessageAt: moiHon(hoiThoai.lastMessageAt, tin.sentAt),
      awaitingReply: tinhChoTraLoi({ lastInboundAt: hoiThoai.lastInboundAt, lastOutboundAt }),
    },
  });

  return { conversationId: hoiThoai.id, messageId: tao.messageId, duplicate: false };
}

// ── Bên trong ────────────────────────────────────────────────────────────────

async function layHoacTaoHoiThoai(tin: TinDenNgoai, threadId: string) {
  const danhTinh = await db.inboxIdentity.upsert({
    where: {
      channel_accountId_externalUserId: {
        channel: tin.channel,
        accountId: tin.accountId,
        externalUserId: tin.externalUserId,
      },
    },
    create: {
      channel: tin.channel,
      accountId: tin.accountId,
      externalUserId: tin.externalUserId,
      displayName: tin.displayName ?? null,
    },
    // Cập nhật tên nếu nhà cung cấp gửi tên mới; KHÔNG xoá tên cũ bằng `null`
    // (payload thiếu tên là chuyện thường, xoá đi là mất thông tin đang có).
    update: tin.displayName ? { displayName: tin.displayName } : {},
    select: { id: true, orgUnitId: true },
  });

  const hoiThoai = await db.inboxConversation.upsert({
    where: {
      channel_accountId_externalThreadId: {
        channel: tin.channel,
        accountId: tin.accountId,
        externalThreadId: threadId,
      },
    },
    create: {
      channel: tin.channel,
      accountId: tin.accountId,
      identityId: danhTinh.id,
      externalThreadId: threadId,
      orgUnitId: danhTinh.orgUnitId,
    },
    update: {},
    select: {
      id: true,
      status: true,
      orgUnitId: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      lastMessageAt: true,
    },
  });

  return { danhTinh, hoiThoai };
}

/**
 * Tạo tin, hoặc báo TRÙNG. Dựa vào UNIQUE ở tầng DB chứ không "tra trước rồi ghi":
 * hai lượt webhook chạy song song đều tra thấy chưa có rồi cùng ghi — đúng cái đua
 * mà unique sinh ra để chặn.
 */
async function taoTinNeuChuaCo(data: {
  conversationId: string;
  channel: InboxChannel;
  direction: "IN" | "OUT";
  channelMessageId: string;
  body: string | null;
  attachments?: Prisma.InputJsonValue;
  sentAt: Date;
  orgUnitId: string | null;
  sentOutsideSystem?: boolean;
  deliveryStatus?: "SENT";
}): Promise<{ duplicate: boolean; messageId: string | null }> {
  try {
    const tin = await db.inboxMessage.create({
      data: {
        conversationId: data.conversationId,
        channel: data.channel,
        direction: data.direction,
        channelMessageId: data.channelMessageId,
        body: data.body,
        attachments: data.attachments,
        sentAt: data.sentAt,
        orgUnitId: data.orgUnitId,
        sentOutsideSystem: data.sentOutsideSystem ?? false,
        deliveryStatus: data.deliveryStatus,
      },
      select: { id: true },
    });
    return { duplicate: false, messageId: tin.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { duplicate: true, messageId: null };
    }
    throw err;
  }
}

/** Mốc mới hơn trong hai mốc; giữ mốc cũ nếu tin đến trễ (sự kiện tới lệch thứ tự). */
function moiHon(cu: Date | null, moi: Date): Date {
  return cu && cu > moi ? cu : moi;
}
