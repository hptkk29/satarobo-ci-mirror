import { chayChoPhuHuynh, traThanhCong } from "@/lib/mobile-api/cong";
import { mucLucHocThu } from "@/lib/mobile-api/dich-vu/free-mode";

export const dynamic = "force-dynamic";

/** GET /api/mobile/v1/online/preview/courses/:slug — mục lục học thử (CHỈ bài đủ điều kiện; bài khác chỉ là một con số). Phụ huynh. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return chayChoPhuHuynh(req, async () => traThanhCong(await mucLucHocThu(null, slug)));
}
