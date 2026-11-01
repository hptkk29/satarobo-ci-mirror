import "server-only";
// lib/integrations/zalocrm/provider.ts — adapter GỬI TIN qua nick Zalo CÁ NHÂN (GĐ3).
//
// Đợt 1 và 2, Sale gõ tin TRONG giao diện Zalo CRM; Sata chỉ NHẬN. File này mở chiều
// còn lại: người trực bấm Gửi ngay trong hộp thư của Sata, tin đi qua Public API của
// fork rồi ra nick.
//
// ── 🔴 BA CHỖ KHÁC HẲN HAI ADAPTER KIA (OA và Messenger) ────────────────────
//
// 1. **Tài khoản gửi không cố định.** OA có đúng một `ZALO_OA_ID` trong env; ở đây mỗi
//    cơ sở là một TỔ CHỨC riêng bên fork, khoá API riêng, và mỗi nick thuộc một tổ
//    chức. Nên adapter phải TRA `ZaloCrmNick` để biết nick này thuộc `orgCode` nào —
//    đây là lý do duy nhất file này chạm DB.
//
// 2. **Trần chống khoá nick là chuyện sinh tử, không phải chuyện lịch sự.** Zalo khoá
//    một nick cá nhân là mất luôn cả kênh liên lạc với toàn bộ khách đang chat với nick
//    đó — khác hẳn OA, nơi quá hạn mức chỉ là một tin bị từ chối. Trần do fork gác
//    (việc F4), Sata không gác lần hai để hai bên khỏi đếm lệch nhau; fork trả 429 thì
//    ở đây thành `FAILED` có mã, người trực đọc được và chờ.
//
// 3. **`msgId` là bắt buộc, thiếu là `FAILED`.** `sendInboxReply` ghi `providerMessageId`
//    làm `channelMessageId`, và bản echo của chính tin này sẽ về qua webhook vài giây
//    sau. Không có id để khớp thì echo tạo một dòng OUT thứ hai — mỗi tin hiện hai lần
//    trong hội thoại. Bịa id còn tệ hơn: nó khớp nhầm sang tin khác.
import type { InboxChannel } from "@prisma/client";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { resolveSendMode } from "@/lib/integrations/fail-safe";
import type {
  ChannelProvider,
  ChannelSendInput,
  ChannelSendOutcome,
} from "@/lib/integrations/types";
import { docKhoaApi, guiTinZalocrm } from "@/lib/integrations/zalocrm/client";

/**
 * Đủ khoá kết nối chưa. THUẦN — không chạm DB, không async (hợp đồng `ChannelProvider`).
 *
 * Chỉ đọc SỰ TỒN TẠI của biến, không log giá trị (luật cứng #9). `ZALOCRM_API_KEYS` là
 * JSON theo `orgCode`; ở đây chỉ hỏi "có khai gì chưa", còn cơ sở cụ thể có khoá hay
 * không thì tới lúc gửi mới biết — và lúc đó mới nói được cơ sở nào thiếu.
 */
export function coCauHinhZalocrmApi(): boolean {
  return Boolean(process.env.ZALOCRM_BASE_URL?.trim() && process.env.ZALOCRM_API_KEYS?.trim());
}

export const zalocrmProvider: ChannelProvider = {
  channel: "ZALO_CA_NHAN" as InboxChannel,
  name: "zalocrm",
  label: "Zalo cá nhân",
  isConfigured: coCauHinhZalocrmApi,

  async send(input: ChannelSendInput): Promise<ChannelSendOutcome> {
    const mode = await resolveSendMode({
      configured: coCauHinhZalocrmApi(),
      readLive: () => getSetting("inbox.zaloCaNhanLive"),
    });
    if (!mode.live) return { status: "SIMULATED", reason: mode.reason };

    // `input.accountId` là `zcrmAccountId` — cùng khoá mà webhook dùng làm
    // `InboxConversation.accountId`. `deletedAt: null` phải viết tay: `ZaloCrmNick`
    // KHÔNG nằm trong `SOFT_DELETE_MODELS` (nợ #4 của bản bàn giao), nên không có ai
    // lọc hộ — và gửi qua một nick đã gỡ là gửi từ một tài khoản không còn ai trông.
    const nick = await db.zaloCrmNick.findFirst({
      where: { zcrmAccountId: input.accountId, deletedAt: null },
      select: { orgCode: true, status: true },
    });
    if (!nick) {
      return { status: "FAILED", errorCode: "KHONG_BIET_NICK_NAO_GUI" };
    }
    if (!docKhoaApi(nick.orgCode)) {
      // Cơ sở này chưa có khoá API. Nói rõ là THIẾU CẤU HÌNH chứ không phải lỗi mạng —
      // hai thứ đó do hai người khác nhau xử.
      return { status: "FAILED", errorCode: `CHUA_KHAI_KHOA_API_${nick.orgCode}` };
    }

    const kq = await guiTinZalocrm(nick.orgCode, {
      zaloAccountId: input.accountId,
      threadId: input.externalUserId,
      content: input.body,
      // Chốt 9.6: hội thoại NHÓM không đồng bộ về Sata, nên mọi thứ gửi từ đây là 1-1.
      threadType: "user",
      // Khoá giành chỗ của chính lượt gửi này. Thiếu nó thì một lần mất phản hồi là
      // khách có thể nhận hai tin giống nhau (xem chú thích ở `client.ts`).
      idempotencyKey: input.outboundKey,
    });

    if (!kq.ok) {
      // Mã lỗi giữ nguyên hình dạng của `goiZalocrm` + mã HTTP khi có. 429 là trần
      // chống khoá nick của fork — người trực phải đọc được để CHỜ, không bấm lại liên tục.
      const ma = kq.httpStatus ? `${kq.ma}_${kq.httpStatus}` : kq.ma;
      return { status: "FAILED", errorCode: ma };
    }

    const msgId = typeof kq.data?.msgId === "string" ? kq.data.msgId.trim() : "";
    if (!msgId) {
      // Fork nhận nhưng không trả id (SDK không trả msgId). Tin CÓ THỂ đã tới khách —
      // nên KHÔNG nói `SENT` (sẽ khoá mất cảnh báo chậm phản hồi) và cũng không bịa id.
      return { status: "FAILED", errorCode: "THIEU_MSG_ID" };
    }

    return { status: "SENT", providerMessageId: msgId };
  },
};
