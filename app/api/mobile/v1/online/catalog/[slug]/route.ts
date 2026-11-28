import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { chiTietDanhMucOnline } from "@/lib/mobile-api/dich-vu/online-hoc";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/online/catalog/:slug — chi tiết công khai của MỘT khoá đang bán (mục lục + đánh dấu bài học thử; KHÔNG nội dung bài). Không thấy/chưa bán ⇒ 404. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return chayChoPhuHuynh(req, async () => traThanhCong(await chiTietDanhMucOnline(slug)));
}
