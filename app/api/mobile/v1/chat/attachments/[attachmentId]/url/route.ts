import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { layUrlTepChat } from "@/lib/mobile-api/dich-vu/chat-tep";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/v1/chat/attachments/:attachmentId/url — URL ĐỌC ký 5 phút cho MỘT ảnh chat. Chỉ thành viên đang có quyền của hội thoại chứa ảnh;
 * tin đã gỡ / không phải thành viên / không tồn tại ⇒ cùng 404. `no-store`. Không có URL công khai. Chế độ học sinh ⇒ 403.
 */
export async function GET(req: Request, ctx: { params: Promise<{ attachmentId: string }> }) {
  const { attachmentId } = await ctx.params;
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await layUrlTepChat(nguoi, attachmentId)));
}
