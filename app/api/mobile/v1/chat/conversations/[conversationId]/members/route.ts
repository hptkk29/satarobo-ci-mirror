import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { layThanhVien } from "@/lib/mobile-api/dich-vu/chat";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/chat/conversations/:id/members — thành viên ĐANG có quyền trong hội thoại (id, tên hiển thị, nhãn vai). KHÔNG SĐT/email. Không phải thành viên ⇒ 404. */
export async function GET(req: Request, ctx: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await ctx.params;
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await layThanhVien(nguoi, conversationId)));
}
