import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { PROVIDER_KHOA_CHATBOT } from "./khoa-api";

/**
 * Chatbot đang chạy được trên website không: BẬT ở Cấu hình vận hành VÀ đã khai API key.
 * Một trong hai thiếu ⇒ nhân vật "Hỏi Sata Robo nhé!" giữ hành vi cũ (mở Zalo) — không bao giờ mở
 * một khung chat chắc chắn trả lỗi (luật 12: lời hứa suông).
 *
 * Đường nóng (layout public, mọi trang) ⇒ chỉ kiểm dòng key CÓ tồn tại, không giải mã. Lỗi đọc ⇒ tắt.
 */
export const dangBatChatbot = cache(async (): Promise<boolean> => {
  try {
    if (!(await getSetting("chatbot.batTrenWebsite"))) return false;
    const dong = await db.integrationConfig.findUnique({ where: { provider: PROVIDER_KHOA_CHATBOT }, select: { id: true } });
    return dong !== null;
  } catch {
    return false;
  }
});
