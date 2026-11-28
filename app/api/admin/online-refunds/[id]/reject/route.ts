import { z } from "zod";

import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { tuChoiHoanOnline } from "@/lib/finance/hoan-tien-online";
import { HTTP_LOI_HOAN, nguoiQuanLyHoanOnline } from "@/lib/finance/hoan-tien-online-admin";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;
const than = z.strictObject({ lyDo: z.string() });

/** POST /api/admin/online-refunds/[id]/reject { lyDo } — lý do 10–500 ký tự; phụ huynh ĐƯỢC thấy lý do từ chối. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const n = await nguoiQuanLyHoanOnline();
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  let raw: unknown;
  try { raw = await req.json(); } catch { return fail("VALIDATION", "Yêu cầu không hợp lệ.", { status: 400, headers: KHONG_LUU }); }
  const p = than.safeParse(raw);
  if (!p.success) return fail("VALIDATION", "Cần có lý do từ chối.", { status: 400, headers: KHONG_LUU });
  const { id } = await ctx.params;
  const r = await tuChoiHoanOnline(db, { id, approverId: n.nguoi.id, approverName: n.nguoi.ten, lyDoTuChoi: p.data.lyDo, now: new Date() });
  if (!r.ok) return fail(r.ma, r.thongBao, { status: HTTP_LOI_HOAN[r.ma], headers: KHONG_LUU });
  return ok({ daTuChoi: true }, { headers: KHONG_LUU });
}
