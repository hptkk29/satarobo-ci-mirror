import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { layQuyDinhChat } from "@/lib/mobile-api/dich-vu/chat";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/chat/policy — quy định sử dụng tin nhắn (cùng nội dung + phiên bản với web) + đã đồng ý chưa. Cờ chat tắt ⇒ 404. */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await layQuyDinhChat(nguoi)));
}
