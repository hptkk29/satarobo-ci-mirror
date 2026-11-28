// POST /api/public/elearning-online/khoa/[slug]/hoc-thu/[bai]/video-ticket — cấp VÉ PHÁT cho bài VIDEO học thử (Free Mode, không đăng nhập).
// Chỉ bài Đào tạo đã đánh dấu học thử + khoá công khai; bài trả phí / ẩn / không có ⇒ CÙNG một 404 KHONG_TIM_THAY. Phản hồi no-store.
import { xuLyCapVeHocThu } from "@/lib/elearning-online/video-phat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ slug: string; bai: string }> }) {
  const { slug, bai } = await ctx.params;
  return xuLyCapVeHocThu(req, slug, bai);
}
