import { fail, ok } from "@/lib/api/response";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { layUrlBaiNopChoNguoiCham } from "@/lib/mobile-api/dich-vu/online-san-pham";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/admin/online-exam/submissions/:submissionId/file — người chấm lấy URL KÝ ngắn hạn (5 phút) của tệp bài nộp sản phẩm (video/ảnh của trẻ).
 * Thứ tự: phiên (401) → quyền `onl:assessment:grade` (403) → bài nộp (404) → kho (503). Không log URL; không CDN công khai.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ submissionId: string }> }) {
  const s = await auth();
  if (!(s?.user as { id?: string } | undefined)?.id) return fail("UNAUTHENTICATED", "Chưa đăng nhập.", { status: 401, headers: KHONG_LUU });
  if (!(await checkPermission("onl:assessment:grade"))) return fail("FORBIDDEN", "Không có quyền.", { status: 403, headers: KHONG_LUU });
  const { submissionId } = await ctx.params;
  const r = await layUrlBaiNopChoNguoiCham(submissionId);
  if (!r.ok) return r.ma === 503 ? fail("SERVER", "Kho tệp chưa sẵn sàng.", { status: 503, headers: KHONG_LUU }) : fail("NOT_FOUND", "Không tìm thấy bài nộp.", { status: 404, headers: KHONG_LUU });
  return ok({ url: r.url, hetHanLuc: r.hetHanLuc, tenTep: r.tenTep, mime: r.mime }, { headers: KHONG_LUU });
}
