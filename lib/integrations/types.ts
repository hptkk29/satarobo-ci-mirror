// lib/integrations/types.ts — HỢP ĐỒNG CHUNG của mọi adapter kênh ngoài.
//
// Nơi đặt adapter: `lib/integrations/<vendor>/` — phương án PA-1 của spec §2.1.
// (`modules/integration` mà Doc 15 Q8 mô tả CHƯA TỒN TẠI; dựng nó là một việc tái
// cấu trúc riêng, không gộp vào đây.)
//
// ⚠️ Adapter CHỈ biết "gửi một đoạn chữ tới một người trên một kênh". Nó KHÔNG
// biết `Lead`, không biết hội thoại, không ghi DB. Đổi nhà cung cấp = thay đúng
// một file trong `lib/integrations/<vendor>/`.
import type { InboxChannel } from "@prisma/client";

export type ChannelSendInput = {
  /** Tài khoản bên mình đứng tên gửi: `oa_id` (Zalo) / `pageId` (Facebook). */
  accountId: string;
  /** Người nhận phía nhà cung cấp: `user_id` (Zalo) / `psid` (Messenger). */
  externalUserId: string;
  body: string;
  /**
   * Khoá GIÀNH CHỖ của lượt gửi (`InboxMessage.outboundKey`) — một cú bấm là một khoá.
   *
   * Adapter nào có đường chống-gửi-trùng ở phía nhà cung cấp thì chuyển tiếp khoá này.
   * Vì sao cần: lớp trên đã chặn được hai cú bấm (UNIQUE ở DB), nhưng KHÔNG chặn được
   * ca "gọi API xong thì mất phản hồi" — lúc đó tin có thể đã tới khách mà bên mình
   * tưởng hỏng. Tin đã đi thì không thu hồi được, nên bên nhận phải nhận ra lượt lặp.
   *
   * Tuỳ chọn: adapter không dùng tới thì bỏ qua, không phải sửa gì.
   */
  outboundKey?: string;
};

/**
 * Vì sao một lượt gửi chỉ là MÔ PHỎNG. Ba lý do này phải phân biệt được ở giao
 * diện: "chưa cấu hình" là việc của người quản trị, "đang tắt live" là quyết định
 * vận hành, "không đọc nổi công tắc" là sự cố.
 */
export type SimulatedReason =
  /** Thiếu khoá kết nối (env chưa đặt). KHÔNG ném lỗi — tắt an toàn (spec AD-1). */
  | "NOT_CONFIGURED"
  /** Công tắc `SystemSetting` đang tắt. */
  | "LIVE_OFF"
  /** Đọc công tắc lỗi (DB sập / giá trị sai kiểu) ⇒ coi như KHÔNG live (spec AD-2). */
  | "SETTING_UNREADABLE";

/**
 * Kết quả một lượt gửi. Bốn nhánh, KHÔNG có nhánh nào nói dối:
 *  • `SENT`      — nhà cung cấp đã nhận, có id tin.
 *  • `SIMULATED` — KHÔNG gọi API, KHÁCH KHÔNG NHẬN GÌ (spec AD-3).
 *  • `SKIPPED`   — đủ điều kiện kỹ thuật nhưng cố ý không gửi (kênh một chiều,
 *                  ngoài cửa sổ tin, đường live chưa hiện thực…).
 *  • `FAILED`    — đã gọi và bị từ chối.
 *
 * ⚠️ KHÔNG có `{ ok: true }` trần. Đó chính là hình dạng đã đẻ ra lỗi "bấm Gửi,
 * hệ thống báo thành công, khách không nhận được gì" (`lib/crm/messenger-send-gate.ts`).
 */
export type ChannelSendOutcome =
  | { status: "SENT"; providerMessageId: string }
  | { status: "SIMULATED"; reason: SimulatedReason }
  | { status: "SKIPPED"; errorCode: string }
  | { status: "FAILED"; errorCode: string };

export interface ChannelProvider {
  channel: InboxChannel;
  /** Tên kỹ thuật để log/đối soát, vd "zalo-oa". */
  name: string;
  /** Nhãn tiếng Việt hiện cho người dùng khi phải giải thích vì sao chưa gửi được. */
  label: string;
  /** Đủ khoá kết nối chưa. THUẦN, không chạm DB — dùng được cả ở nơi không có DB. */
  isConfigured(): boolean;
  send(input: ChannelSendInput): Promise<ChannelSendOutcome>;
}

/** Câu giải thích cho người dùng. Ngắn, đúng sự thật, nói việc phải làm. */
export const LY_DO_MO_PHONG: Record<SimulatedReason, string> = {
  NOT_CONFIGURED:
    "Kênh chưa có khoá kết nối. Tin đã lưu vào hội thoại nhưng CHƯA gửi tới khách — " +
    "cần quản trị hệ thống nhập khoá của nhà cung cấp.",
  LIVE_OFF:
    "Kênh đang ở chế độ mô phỏng. Tin đã lưu vào hội thoại nhưng CHƯA gửi tới khách — " +
    "bật công tắc gửi thật ở Cấu hình vận hành.",
  SETTING_UNREADABLE:
    "Không đọc được công tắc gửi thật nên hệ thống dừng an toàn. Tin đã lưu nhưng " +
    "CHƯA gửi tới khách — báo kỹ thuật.",
};
