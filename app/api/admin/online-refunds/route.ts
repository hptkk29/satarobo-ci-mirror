import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { docDanhSachHoanOnline, laTrangThaiHoan, nguoiQuanLyHoanOnline } from "@/lib/finance/hoan-tien-online-admin";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;

/** GET /api/admin/online-refunds[?trangThai=PENDING|APPROVED|PAID|REJECTED&trang=1&soLuong=20] — hàng đợi hoàn tiền Online (payments:confirm + cấp Hội sở). */
export async function GET(req: Request) {
  const n = await nguoiQuanLyHoanOnline();
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  const u = new URL(req.url).searchParams;
  const tt = u.get("trangThai");
  if (tt !== null && !laTrangThaiHoan(tt)) return fail("VALIDATION", "trangThai không hợp lệ.", { status: 400, headers: KHONG_LUU });
  const trang = Math.max(1, Math.min(1000, Number.parseInt(u.get("trang") ?? "1", 10) || 1));
  const soLuong = Math.max(1, Math.min(100, Number.parseInt(u.get("soLuong") ?? "20", 10) || 20));
  const r = await docDanhSachHoanOnline(db, { trangThai: tt ?? undefined, trang, soLuong });
  return ok(r.muc, { meta: { tong: r.tong, trang, soLuong }, headers: KHONG_LUU });
}
