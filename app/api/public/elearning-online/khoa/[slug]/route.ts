// GET /api/public/elearning-online/khoa/[slug] — CHI TIẾT một khoá Online công khai (mục lục chỉ có tiêu đề/loại/thời lượng/học thử; KHÔNG nội dung trả phí).
import { xuLyChiTiet } from "@/lib/elearning-online/cong-khai-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return xuLyChiTiet(slug);
}
