import { ZodError } from "zod";

import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { chuyenTienDoGiao, HTTP_LOI_VAN_HANH, nguoiVanHanhKho } from "@/lib/online-checkout/giao-hang-van-hanh";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

/** POST /api/admin/online-fulfillment/:id/transition `{ tu, den, carrier?, trackingCode?, expectedDeliveryOn?, ghiChu? }` — `tu` = trạng thái người dùng đang thấy (khoá lạc quan). Quyền: `online_fulfillment:update` ở tầm toàn hệ + cấp Hội sở (`nguoiVanHanhKho`). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const n = await nguoiVanHanhKho(true);
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION", "Thân yêu cầu không phải JSON.", { status: 400, headers: KHONG_LUU });
  }
  try {
    const r = await chuyenTienDoGiao(db, n.nguoi, id, body, new Date());
    if (!r.ok) return fail(r.ma, r.thongBao, { status: HTTP_LOI_VAN_HANH[r.ma], headers: KHONG_LUU, ...(r.hienTai ? { chiTiet: { hienTai: r.hienTai } } : {}) });
    return ok({ trangThai: r.trangThai, daCo: r.daCo }, { headers: KHONG_LUU });
  } catch (e) {
    if (e instanceof ZodError) return fail("VALIDATION", e.issues[0]?.message ?? "Dữ liệu không hợp lệ.", { status: 400, field: e.issues[0]?.path.join("."), headers: KHONG_LUU });
    throw e;
  }
}
