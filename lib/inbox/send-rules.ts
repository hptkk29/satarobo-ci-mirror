// lib/inbox/send-rules.ts — kết quả adapter ⇒ dòng ghi sổ. THUẦN, không DB.
//
// Luật AD-4 của spec §2.2 chốt MỘT cách xử lý SIMULATED cho toàn hệ: ghi trạng
// thái vào sổ (mẫu `lib/chat/zns-notify.ts`), KHÔNG dùng nhánh
// `lib/notify/attendance.ts` (log cảnh báo rồi vẫn đánh dấu đã gửi).
//
// 🔴 `daTraLoiKhach` là trường quan trọng nhất file này. Nó quyết định có set
// `InboxConversation.lastOutboundAt` hay không — tức có TẮT đồng hồ "chưa ai trả
// lời" hay không. Đúng cột này ở module cũ (`MessengerConversation.respondedAt`)
// đã bị set mỗi lần bấm Gửi, kể cả khi tin không đi đâu cả, nên cảnh báo chậm phản
// hồi bị tắt cho những khách CHƯA ai trả lời.
import type { InboxDeliveryStatus } from "@prisma/client";
import type { ChannelSendOutcome } from "@/lib/integrations/types";

export type DongGhiSo = {
  deliveryStatus: InboxDeliveryStatus;
  providerMessageId: string | null;
  /** Mã có cấu trúc để tra; với nhánh mô phỏng thì đây là LÝ DO mô phỏng. */
  errorCode: string | null;
  /**
   * Tin có thật sự tới khách không. CHỈ `SENT` mới true — đây là điều kiện duy
   * nhất để cập nhật `lastOutboundAt` và coi hội thoại là đã được trả lời.
   */
  daTraLoiKhach: boolean;
};

export function ketQuaGuiToSoGhi(outcome: ChannelSendOutcome): DongGhiSo {
  switch (outcome.status) {
    case "SENT":
      return {
        deliveryStatus: "SENT",
        providerMessageId: outcome.providerMessageId,
        errorCode: null,
        daTraLoiKhach: true,
      };
    case "SIMULATED":
      return {
        deliveryStatus: "SIMULATED",
        providerMessageId: null,
        // Giữ LÝ DO: màn hình phải nói được "vì sao chưa gửi", không chỉ "chưa gửi".
        errorCode: outcome.reason,
        daTraLoiKhach: false,
      };
    case "SKIPPED":
      return {
        deliveryStatus: "SKIPPED",
        providerMessageId: null,
        errorCode: outcome.errorCode,
        daTraLoiKhach: false,
      };
    case "FAILED":
      return {
        deliveryStatus: "FAILED",
        providerMessageId: null,
        errorCode: outcome.errorCode,
        daTraLoiKhach: false,
      };
  }
}
