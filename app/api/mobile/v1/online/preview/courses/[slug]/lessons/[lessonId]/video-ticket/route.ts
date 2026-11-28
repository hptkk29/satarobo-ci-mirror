import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { capVeHocThuMobile } from "@/lib/mobile-api/dich-vu/free-mode";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/online/preview/courses/:slug/lessons/:lessonId/video-ticket — vé phát bài VIDEO học thử, GẮN tài khoản đăng nhập (phụ huynh; tài khoản chưa có con cũng dùng được). Không thân. */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string; lessonId: string }> }) {
  const { slug, lessonId } = await ctx.params;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await capVeHocThuMobile(nguoi, null, slug, lessonId)));
}
