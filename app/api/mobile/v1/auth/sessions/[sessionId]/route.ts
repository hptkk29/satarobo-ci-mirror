import { chayDaDangNhap, traThanhCong } from "@/lib/mobile-api/cong";
import { thuHoiMotPhien } from "@/lib/mobile-api/dich-vu/phien-dang-nhap";

export const dynamic = "force-dynamic";

/** DELETE /api/mobile/v1/auth/sessions/:sessionId — thu hồi MỘT phiên của chính người dùng (từ xa). Phiên người khác/không có ⇒ 404; đã thu hồi ⇒ 200 (idempotent). (SEC-05) */
export async function DELETE(req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  return chayDaDangNhap(req, async (nguoi, c) => traThanhCong(await thuHoiMotPhien(nguoi, sessionId, c)));
}
