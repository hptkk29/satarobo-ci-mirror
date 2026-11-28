import { type NextRequest } from "next/server";
import { requireLiveSession } from "@/lib/auth/live-session";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { fail } from "@/lib/api/response";
import { db } from "@/lib/db";
import { chanApiKhiTat } from "@/lib/elearning/api-gate";
import { dungPdfTheoMa } from "@/lib/elearning-online/cn-mau-db";
import { khoR2 } from "@/lib/elearning-online/cn-tai-san";
import { chuanHoaMaChungNhan } from "@/lib/elearning-online/ma-chung-nhan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TẢI PDF chứng nhận Online theo MÃ. Dựng theo BẢN CHỤP lúc cấp (không theo mẫu hiện hành).
 * Ai được tải: nhân viên có `onl:certificate:issue` (thấy cả bản đã thu hồi, có dấu) HOẶC phụ huynh của CHÍNH học viên (không tải được bản đã thu hồi).
 * Người khác ⇒ 404 (không phân biệt "không có" với "không phải của bạn").
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const chanCo = chanApiKhiTat();
  if (chanCo) return chanCo;
  const session = await requireLiveSession();
  if (!session?.user?.id) return fail("UNAUTHENTICATED", "Chưa đăng nhập", { status: 401 });
  const code = chuanHoaMaChungNhan((await ctx.params).code); // C10: nhận cả mã lưu lẫn dạng hiển thị `SR-ON-…`
  if (!/^[A-Z0-9]{6,20}$/.test(code)) return fail("NOT_FOUND", "Không tìm thấy chứng nhận", { status: 404 });
  const actor = await resolveActor(session.user.id);
  const laNhanVien = can(actor, "onl:certificate:issue");
  const c = await db.onlCertificate.findUnique({ where: { code }, select: { status: true, student: { select: { parentUserId: true } } } });
  const laChuCon = !!c && c.student.parentUserId === session.user.id;
  if (!c || !(laNhanVien || laChuCon)) return fail("NOT_FOUND", "Không tìm thấy chứng nhận", { status: 404 });
  if (c.status === "REVOKED" && !laNhanVien) return fail("NOT_FOUND", "Không tìm thấy chứng nhận", { status: 404 });
  const kho = await khoR2().catch(() => null);
  if (!kho) return fail("INTERNAL", "Kho tệp chưa cấu hình", { status: 503 });
  const r = await dungPdfTheoMa(db, kho, code);
  if (!r.ok) return fail(r.ma === "KHONG_TON_TAI" ? "NOT_FOUND" : "INTERNAL", r.thongBao, { status: r.ma === "KHONG_TON_TAI" ? 404 : 500 });
  return new Response(new Uint8Array(r.pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${r.tenTep}"`, "Cache-Control": "private, no-store" } });
}
