import { z } from "zod";

import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { duyetHoanOnline } from "@/lib/finance/hoan-tien-online";
import { HTTP_LOI_HOAN, nguoiQuanLyHoanOnline } from "@/lib/finance/hoan-tien-online-admin";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;
const than = z.strictObject({ soTienDuyet: z.number().int().positive() });

/** POST /api/admin/online-refunds/[id]/approve { soTienDuyet } — số tiền BẮT BUỘC; trần hai phía tính lại dưới khoá đơn; người tạo yêu cầu (kênh nhân viên) không tự duyệt. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const n = await nguoiQuanLyHoanOnline();
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  let raw: unknown;
  try { raw = await req.json(); } catch { return fail("VALIDATION", "Yêu cầu không hợp lệ.", { status: 400, headers: KHONG_LUU }); }
  const p = than.safeParse(raw);
  if (!p.success) return fail("VALIDATION", "soTienDuyet phải là số nguyên đồng lớn hơn 0.", { status: 400, headers: KHONG_LUU });
  const { id } = await ctx.params;
  const r = await duyetHoanOnline(db, { id, approverId: n.nguoi.id, approverName: n.nguoi.ten, soTienDuyet: p.data.soTienDuyet, now: new Date() });
  if (!r.ok) return fail(r.ma, r.thongBao, { status: HTTP_LOI_HOAN[r.ma], headers: KHONG_LUU });
  return ok({ soTienDuyet: r.soTienDuyet }, { headers: KHONG_LUU });
}
