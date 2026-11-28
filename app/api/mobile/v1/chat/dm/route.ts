import { chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { moHoiThoaiRieng, moRiengSchema } from "@/lib/mobile-api/dich-vu/chat";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/chat/dm { giaoVienId } — «Nhắn cô thầy»: mở (hoặc mở lại) hội thoại riêng với giáo viên đang dạy con. Quan hệ dạy học do web kiểm; không có quan hệ ⇒ 404. Idempotent (một cặp một hội thoại). */
export async function POST(req: Request) {
  return chayDaDangNhapCoThan(req, moRiengSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await moHoiThoaiRieng(nguoi, thanDl)));
}
