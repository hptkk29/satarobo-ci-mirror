import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { layDanhSachHoiThoai } from "@/lib/mobile-api/dich-vu/chat";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/chat/conversations — danh sách hội thoại của phụ huynh (nhóm lớp · nhắn riêng với giáo viên · tư vấn), mới nhất trước, kèm chưa đọc + tin cuối.
 * Bọc domain chat của web. Cờ `MOBILE_CHAT_ENABLED` tắt ⇒ 404; chưa đồng ý quy định chat ⇒ 403 `CHAT_POLICY_REQUIRED`; chế độ học sinh ⇒ 403.
 */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await layDanhSachHoiThoai(nguoi)));
}
