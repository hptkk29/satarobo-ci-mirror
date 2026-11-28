import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { danhSachDongGiao, nguoiVanHanhKho, type TrangThaiGiao } from "@/lib/online-checkout/giao-hang-van-hanh";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;
const HOP_LE = new Set(["PAID", "PACKING", "SHIPPED", "DELIVERED", "FAILED", "CANCELLED", "RETURNED", "NEEDS_STAFF", "AWAITING_PAYMENT"]);

/** GET /api/admin/online-fulfillment?status=PAID,PACKING&take=50&after=<id> — dòng học cụ cần kho xử lý. Quyền: `online_fulfillment:view-pii` ở tầm toàn hệ + cấp Hội sở (`nguoiVanHanhKho`) — thân có PII người nhận. */
export async function GET(req: Request) {
  const n = await nguoiVanHanhKho(false);
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  const u = new URL(req.url);
  const st = (u.searchParams.get("status") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (st.some((x) => !HOP_LE.has(x))) return fail("VALIDATION", "Trạng thái không hợp lệ.", { status: 400, field: "status", headers: KHONG_LUU });
  const take = Number(u.searchParams.get("take") ?? "50");
  const r = await danhSachDongGiao(db, { trangThai: st as TrangThaiGiao[], take: Number.isFinite(take) ? take : 50, sau: u.searchParams.get("after") ?? undefined });
  return ok(r, { headers: KHONG_LUU });
}
