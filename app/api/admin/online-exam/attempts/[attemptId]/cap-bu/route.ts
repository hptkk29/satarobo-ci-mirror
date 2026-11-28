import { cauHinhCapBuLoiHeThong } from "@/lib/elearning-online/actions";
import { chayAdminOnlineThi } from "@/lib/online-thi/admin-goi";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/online-exam/attempts/:attemptId/cap-bu { lyDo (≥10), bangChung (≥5) } — EX-01: cấp bù MỘT lượt thay thế vì LỖI HỆ THỐNG ĐÃ XÁC MINH. Quyền `onl:student:grant` (Auth.js, KHÔNG phải token di động).
 * Chỉ cho lượt ĐÃ ĐÓNG; không sửa lượt cũ; mỗi lượt tối đa một lần bù (gọi lại ⇒ 200 `daCoTruocDo:true`). 404 lượt · 409 đang làm/đã xử lý bằng đường thu hồi · 422 thiếu lý do/bằng chứng.
 */
export async function POST(req: Request, ctx: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await ctx.params;
  return chayAdminOnlineThi(cauHinhCapBuLoiHeThong, req, (than) => ({ input: { ...(than ?? {}), attemptId } }));
}
