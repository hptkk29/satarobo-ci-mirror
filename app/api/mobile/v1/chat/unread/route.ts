import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { demChuaDoc } from "@/lib/mobile-api/dich-vu/chat";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/chat/unread — tổng tin chưa đọc của phụ huynh (cho huy hiệu). Cùng nguồn với web (`countChatUnreadForUser`). */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await demChuaDoc(nguoi)));
}
