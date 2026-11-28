import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { docCauHinhGiao, nguoiQuanTriGiaoHang } from "@/lib/online-checkout/giao-hang-admin";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

/** GET /api/admin/online-shipping — toàn bộ cấu hình giao hàng (khu vực · phương thức · phí). Quyền `settings:edit`. */
export async function GET() {
  const n = await nguoiQuanTriGiaoHang();
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  return ok(await docCauHinhGiao(db), { headers: KHONG_LUU });
}
