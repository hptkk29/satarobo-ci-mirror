import { chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { xinVeTepChat, xinVeTepChatSchema } from "@/lib/mobile-api/dich-vu/chat-tep";

export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/v1/chat/conversations/:conversationId/attachments/tickets { tep:[{tenTep,loaiMime,kichThuoc,dauTepBase64}] } — xin VÉ tải ảnh lên kho chat RIÊNG (≤ 5 ảnh jpg/png/webp, ≤ 10 MB).
 * Trả URL PUT ký ngắn hạn + `duongDanKho` (khoá do máy chủ dựng). Không phải thành viên ⇒ 404; kho chưa cấu hình ⇒ 503 MEDIA_CHUA_SAN_SANG; sai loại/cỡ ⇒ 415/413. Chế độ học sinh ⇒ 403.
 */
export async function POST(req: Request, ctx: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await ctx.params;
  return chayDaDangNhapCoThan(req, xinVeTepChatSchema, async (nguoi, _c, thanDl) => traThanhCong(await xinVeTepChat(nguoi, conversationId, thanDl)));
}
