import { chayTheoHocVien, traThanhCong } from "@/lib/mobile-api/cong";
import { mucLucHocThu } from "@/lib/mobile-api/dich-vu/free-mode";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/students/:studentId/online/preview/courses/:slug — mục lục học thử + TIẾN ĐỘ từng bài + trạng thái quyền/tự nhận của học viên này. Phụ huynh (xem) hoặc học sinh của chính em. */
export async function GET(req: Request, ctx: { params: Promise<{ studentId: string; slug: string }> }) {
  const { studentId, slug } = await ctx.params;
  return chayTheoHocVien(req, studentId, async (hs) => traThanhCong(await mucLucHocThu(hs, slug)));
}
