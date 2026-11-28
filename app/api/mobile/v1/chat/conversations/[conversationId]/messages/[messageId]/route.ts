import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { thuHoiTin } from "@/lib/mobile-api/dich-vu/chat";

export const dynamic = "force-dynamic";

/** DELETE /api/mobile/v1/chat/conversations/:id/messages/:messageId — tác giả tự THU HỒI tin của mình trong ≤ 15 phút (luật web). Tin của người khác / quá hạn / đã gỡ ⇒ lỗi; tin không thuộc hội thoại trong đường dẫn ⇒ 404. */
export async function DELETE(req: Request, ctx: { params: Promise<{ conversationId: string; messageId: string }> }) {
  const { conversationId, messageId } = await ctx.params;
  return chayDaDangNhap(req, async (nguoi) => traThanhCong(await thuHoiTin(nguoi, conversationId, messageId)));
}
