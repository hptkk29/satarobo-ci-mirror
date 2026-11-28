// GET /api/public/elearning-online/khoa/[slug]/hoc-thu/[bai] — nội dung bài HỌC THỬ (chỉ bài được đánh dấu học thử; bài trả phí ⇒ 404 giống "không có").
import { xuLyHocThu } from "@/lib/elearning-online/cong-khai-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; bai: string }> }) {
  const { slug, bai } = await ctx.params;
  return xuLyHocThu(slug, bai);
}
