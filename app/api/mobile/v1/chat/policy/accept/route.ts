import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { dongYQuyDinhChat } from "@/lib/mobile-api/dich-vu/chat";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/chat/policy/accept — đồng ý quy định chat bản hiện hành (idempotent: giữ mốc đồng ý đầu tiên; cùng bảng với web). Cờ chat tắt ⇒ 404; chế độ học sinh ⇒ 403. */
export async function POST(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await dongYQuyDinhChat(nguoi)));
}
