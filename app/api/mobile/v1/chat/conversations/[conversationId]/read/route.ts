import { chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";
import { danhDauDaDoc, docSchema } from "@/lib/mobile-api/dich-vu/chat";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/chat/conversations/:id/read { tinCuoiId: UUID|null } — đánh dấu đã đọc (chưa đọc về 0, ghi mốc đã đọc). Idempotent. Không phải thành viên ⇒ 404. */
export async function POST(req: Request, ctx: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await ctx.params;
  return chayDaDangNhapCoThan(req, docSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await danhDauDaDoc(nguoi, conversationId, thanDl)));
}
