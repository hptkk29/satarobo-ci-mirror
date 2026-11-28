import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { docBaiHocThuChoPhuHuynh } from "@/lib/mobile-api/dich-vu/free-mode";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/online/preview/courses/:slug/lessons/:lessonId — phụ huynh ĐỌC bài học thử (READ: thân bài; VIDEO: metadata, dùng video-ticket để xem). Không ghi gì. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string; lessonId: string }> }) {
  const { slug, lessonId } = await ctx.params;
  return chayChoPhuHuynh(req, async (nguoi) => traThanhCong(await docBaiHocThuChoPhuHuynh(nguoi, slug, lessonId)));
}
