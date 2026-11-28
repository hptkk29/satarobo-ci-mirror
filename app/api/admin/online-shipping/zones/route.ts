import { ZodError } from "zod";

import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { HTTP_LOI_GIAO_ADMIN, nguoiQuanTriGiaoHang, taoKhuVuc } from "@/lib/online-checkout/giao-hang-admin";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

async function doc(req: Request): Promise<unknown | "LOI"> {
  try {
    return await req.json();
  } catch {
    return "LOI";
  }
}
const loiZod = (e: unknown) => (e instanceof ZodError ? fail("VALIDATION", e.issues[0]?.message ?? "Dữ liệu không hợp lệ.", { status: 400, field: e.issues[0]?.path.join("."), headers: KHONG_LUU }) : null);

/** POST /api/admin/online-shipping/zones — tạo khu vực `{ code, name, provinces[], isActive?, lyDo }`. */
export async function POST(req: Request) {
  const n = await nguoiQuanTriGiaoHang();
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  const body = await doc(req);
  if (body === "LOI") return fail("VALIDATION", "Thân yêu cầu không phải JSON.", { status: 400, headers: KHONG_LUU });
  try {
    const r = await taoKhuVuc(db, n.nguoi, body);
    if (!r.ok) return fail(r.ma, r.thongBao, { status: HTTP_LOI_GIAO_ADMIN[r.ma], headers: KHONG_LUU });
    return ok({ id: r.id }, { status: 201, headers: KHONG_LUU });
  } catch (e) {
    const z = loiZod(e);
    if (z) return z;
    throw e;
  }
}
