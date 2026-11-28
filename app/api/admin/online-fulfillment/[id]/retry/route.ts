import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { HTTP_LOI_VAN_HANH, nguoiVanHanhKho, thuLaiDongCanXuLy } from "@/lib/online-checkout/giao-hang-van-hanh";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

/** POST /api/admin/online-fulfillment/:id/retry — dòng NEEDS_STAFF (đã thu tiền nhưng thiếu hàng) sau khi kho đã bổ sung: thử tiêu thụ lại. Quyền: `online_fulfillment:update` ở tầm toàn hệ + cấp Hội sở (`nguoiVanHanhKho`). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const n = await nguoiVanHanhKho(true);
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  const { id } = await ctx.params;
  const r = await thuLaiDongCanXuLy(db, n.nguoi, id, new Date());
  if (!r.ok) return fail(r.ma, r.thongBao, { status: HTTP_LOI_VAN_HANH[r.ma], headers: KHONG_LUU, ...(r.hienTai ? { chiTiet: { hienTai: r.hienTai } } : {}) });
  return ok({ trangThai: r.trangThai }, { headers: KHONG_LUU });
}
