// lib/crm/messenger-service.ts — R1-01: ghi nhận hội thoại/tin nhắn Messenger (SR.QD.217).
// centerId hội thoại suy từ FacebookPageMapping → scopedDb cách ly (C1.4).
import type {
  FacebookPageMapping,
  MessengerConversation,
  MessengerMessage,
  OrgUnitType,
} from "@prisma/client";
import { db } from "@/lib/db";

export class MessengerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MessengerError";
    this.code = code;
  }
}

/** Tạo/cập nhật ánh xạ Page → scope (HO|CENTER). CENTER bắt buộc centerId (C1.1). */
export async function upsertPageMapping(input: {
  pageId: string;
  pageName?: string;
  scopeType: OrgUnitType;
  centerId?: string | null;
}): Promise<FacebookPageMapping> {
  if (input.scopeType !== "HO" && input.scopeType !== "CENTER") {
    throw new MessengerError("PAGE_SCOPE_INVALID", "scopeType chỉ HO hoặc CENTER.");
  }
  if (input.scopeType === "CENTER" && !input.centerId) {
    throw new MessengerError("PAGE_CENTER_REQUIRED", "Page CENTER bắt buộc centerId.");
  }
  const centerId = input.scopeType === "CENTER" ? input.centerId! : null;
  return db.facebookPageMapping.upsert({
    where: { pageId: input.pageId },
    update: { pageName: input.pageName ?? null, scopeType: input.scopeType, centerId, isActive: true },
    create: { pageId: input.pageId, pageName: input.pageName ?? null, scopeType: input.scopeType, centerId },
  });
}

export async function resolvePageMapping(pageId: string): Promise<FacebookPageMapping | null> {
  return db.facebookPageMapping.findUnique({ where: { pageId } });
}

/**
 * Ghi 1 tin nhắn ĐẾN: upsert conversation (set firstMessageAt ở message IN đầu),
 * tạo message IN. Idempotent theo externalEventId (C2.4) → trùng = không tạo lại.
 */
export async function recordIncomingMessage(input: {
  pageId: string;
  psid: string;
  text?: string | null;
  sentAt: Date;
  externalEventId?: string | null;
  parentName?: string | null;
  attachments?: unknown;
}): Promise<{ conversation: MessengerConversation; message: MessengerMessage | null; deduped: boolean }> {
  if (input.externalEventId) {
    const existing = await db.messengerMessage.findUnique({
      where: { externalEventId: input.externalEventId },
      include: { conversation: true },
    });
    if (existing) return { conversation: existing.conversation, message: existing, deduped: true };
  }

  const mapping = await resolvePageMapping(input.pageId);
  const centerId = mapping?.scopeType === "CENTER" ? mapping.centerId : null;

  const conversation = await db.messengerConversation.upsert({
    where: { pageId_psid: { pageId: input.pageId, psid: input.psid } },
    update: {
      parentName: input.parentName ?? undefined,
      // firstMessageAt chỉ set 1 lần (message IN đầu).
      firstMessageAt: undefined,
    },
    create: {
      pageId: input.pageId,
      psid: input.psid,
      parentName: input.parentName ?? null,
      centerId,
      firstMessageAt: input.sentAt,
    },
  });
  // Bảo đảm firstMessageAt set nếu conversation cũ chưa có (vd tạo từ OUT trước).
  if (!conversation.firstMessageAt) {
    await db.messengerConversation.update({
      where: { id: conversation.id },
      data: { firstMessageAt: input.sentAt },
    });
  }

  const message = await db.messengerMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "IN",
      text: input.text ?? null,
      attachments: (input.attachments ?? undefined) as never,
      externalEventId: input.externalEventId ?? null,
      sentAt: input.sentAt,
    },
  });
  return { conversation, message, deduped: false };
}

/**
 * Ghi 1 tin nhắn ĐI (reply CRM). Set respondedAt ở message OUT đầu (C1.3).
 *
 * ⚠️ HÀM NÀY CHỈ GHI SỔ — NÓ KHÔNG GỬI GÌ RA META.
 * Đúng chỗ này từng là lỗi đang sống: `replyAction` gọi thẳng nó rồi trả `{ ok: true }`,
 * giao diện bắn toast "Đã gửi", còn khách không nhận được gì. Tệ hơn, nó set
 * `MessengerConversation.respondedAt` — cột mà `lib/crm/sla.ts:71` dùng để bật cảnh báo
 * SLA-0 "chậm phản hồi" — nên mỗi lần bấm là tắt cảnh báo của một khách chưa ai trả lời.
 *
 * ⇒ Muốn TRẢ LỜI KHÁCH thì dùng `guiTraLoiMessenger()` (`lib/crm/messenger-send.ts`):
 * nó kiểm cửa sổ 24h, gọi Meta Send API thật, ghi trạng thái gửi, và chỉ chạm
 * `respondedAt` khi có `mid` xác nhận tin đã đi.
 * Hàm này giữ lại cho việc ghi lại một tin ĐÃ ĐI BẰNG ĐƯỜNG KHÁC (nhân viên trả lời
 * thẳng trên Trang Facebook, nhập bù lịch sử) và cho bộ e2e mô hình dữ liệu.
 */
export async function recordOutgoingMessage(input: {
  conversationId: string;
  text?: string | null;
  sentAt: Date;
}): Promise<MessengerMessage> {
  const conv = await db.messengerConversation.findUnique({ where: { id: input.conversationId } });
  if (!conv) throw new MessengerError("CONVERSATION_NOT_FOUND", "Không tìm thấy hội thoại.");
  if (!conv.respondedAt) {
    await db.messengerConversation.update({
      where: { id: conv.id },
      data: { respondedAt: input.sentAt },
    });
  }
  return db.messengerMessage.create({
    data: { conversationId: conv.id, direction: "OUT", text: input.text ?? null, sentAt: input.sentAt },
  });
}
