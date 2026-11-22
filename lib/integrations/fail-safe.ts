// lib/integrations/fail-safe.ts — BỐN LUẬT TẮT-AN-TOÀN, viết ĐÚNG MỘT LẦN.
//
// Spec §2.2 rút bốn luật từ sự cố đã có trong repo. Chúng dễ viết đúng và cũng dễ
// viết lệch, nên chúng nằm ở đây chứ không chép vào từng adapter:
//
//   AD-1  thiếu credential ⇒ tắt an toàn, KHÔNG throw (`lib/zalo/provider.ts:99`).
//   AD-2  lỗi ĐỌC công tắc live ⇒ coi như KHÔNG live (`lib/zalo/provider.ts:104-105`).
//         Thà không gửi còn hơn gửi nhầm hàng loạt.
//   AD-3  chưa live ⇒ mô phỏng, KHÔNG gọi API (`lib/zalo/provider.ts:107-110`).
//   AD-4  MỘT cách xử lý SIMULATED duy nhất: ghi trạng thái vào sổ
//         (`lib/chat/zns-notify.ts:417-420`). KHÔNG chép nhánh
//         `lib/notify/attendance.ts:123-125` — nhánh đó chỉ log rồi vẫn đánh dấu
//         "đã gửi", biến số liệu nghiệm thu thành số giả.
//
// AD-4 không nằm trong file này vì nó là chuyện của tầng ghi sổ (`lib/inbox/send.ts`),
// nhưng nó là lý do `resolveSendMode` trả về LÝ DO chứ không trả boolean trần: gọi
// chỗ nào cũng phải nói được "vì sao chưa gửi".
import type { SimulatedReason } from "@/lib/integrations/types";

export type SendMode = { live: true } | { live: false; reason: SimulatedReason };

export async function resolveSendMode(input: {
  /** Đủ khoá kết nối chưa (THUẦN, đọc env). */
  configured: boolean;
  /**
   * Đọc công tắc live. Truyền vào thay vì gọi `getSetting` trực tiếp để hàm này
   * test được không cần DB — và để adapter nào cũng đi qua đúng chuỗi luật này.
   */
  readLive: () => Promise<unknown>;
}): Promise<SendMode> {
  // AD-1. Cố ý KHÔNG đọc công tắc: thiếu khoá thì câu trả lời của công tắc không
  // dùng được, mà nhánh "live" với credential rỗng lại hỏng theo kiểu khó đọc.
  if (!input.configured) return { live: false, reason: "NOT_CONFIGURED" };

  let raw: unknown;
  try {
    raw = await input.readLive();
  } catch {
    // AD-2.
    return { live: false, reason: "SETTING_UNREADABLE" };
  }

  // Kiểm kiểu CHẶT, không dùng truthiness: setting bị ghi sai kiểu là cách kinh
  // điển để một cờ TẮT bị đọc thành BẬT (chuỗi "false" là truthy).
  if (typeof raw !== "boolean") return { live: false, reason: "SETTING_UNREADABLE" };

  // AD-3.
  return raw ? { live: true } : { live: false, reason: "LIVE_OFF" };
}
