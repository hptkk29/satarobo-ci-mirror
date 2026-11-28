import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { docChiTietHoanOnline, nguoiQuanLyHoanOnline } from "@/lib/finance/hoan-tien-online-admin";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

/** GET /api/admin/online-refunds/[id] — chi tiết một yêu cầu hoàn Online. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const n = await nguoiQuanLyHoanOnline();
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  const { id } = await ctx.params;
  const r = await docChiTietHoanOnline(db, id);
  if (!r) return fail("KHONG_TIM_THAY", "Không tìm thấy yêu cầu hoàn tiền.", { status: 404, headers: KHONG_LUU });
  return ok(r, { headers: KHONG_LUU });
}
