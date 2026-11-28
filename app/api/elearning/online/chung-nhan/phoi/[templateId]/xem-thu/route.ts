import { type NextRequest } from "next/server";
import { requireLiveSession } from "@/lib/auth/live-session";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { fail } from "@/lib/api/response";
import { db } from "@/lib/db";
import { chanApiKhiTat } from "@/lib/elearning/api-gate";
import { dungPdfXemThu } from "@/lib/elearning-online/cn-mau-db";
import { MAU_THU } from "@/lib/elearning-online/cn-mau";
import { khoR2 } from "@/lib/elearning-online/cn-tai-san";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** QoCNXem — PDF THỬ bằng dữ liệu mẫu (`?mau=0|1|2`: tên dài nhất / ngắn nhất / khoá dài nhất). Không ghi gì. Gác: `onl:course:manage`. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ templateId: string }> }) {
  const chanCo = chanApiKhiTat();
  if (chanCo) return chanCo;
  const session = await requireLiveSession();
  if (!session?.user?.id) return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  const actor = await resolveActor(session.user.id);
  if (!can(actor, "onl:course:manage")) return fail("PERMISSION_DENIED", "Không có quyền quản lý khoá online", { status: 403 });
  const { templateId } = await ctx.params;
  const i = Number(req.nextUrl.searchParams.get("mau") ?? 0);
  const m = MAU_THU[Number.isInteger(i) && i >= 0 && i < MAU_THU.length ? i : 0]!;
  const kho = await khoR2().catch(() => null);
  if (!kho) return fail("INTERNAL", "Kho tệp chưa cấu hình", { status: 503 });
  const r = await dungPdfXemThu(db, kho, templateId, { hoTen: m.hoTen, tenKhoa: m.tenKhoa, finalScore: m.finalScore });
  if (!r.ok) return fail(r.ma === "MAU_KHONG_TON_TAI" ? "NOT_FOUND" : "INTERNAL", r.thongBao, { status: r.ma === "MAU_KHONG_TON_TAI" ? 404 : 500 });
  return new Response(new Uint8Array(r.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="xem-thu-chung-nhan.pdf"', "Cache-Control": "private, no-store" } });
}
