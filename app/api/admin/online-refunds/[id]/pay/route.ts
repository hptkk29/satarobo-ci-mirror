import { z } from "zod";

import { fail, ok } from "@/lib/api/response";
import { db } from "@/lib/db";
import { chiHoanOnline } from "@/lib/finance/hoan-tien-online";
import { HTTP_LOI_HOAN, nguoiQuanLyHoanOnline } from "@/lib/finance/hoan-tien-online-admin";

export const dynamic = "force-dynamic";
const KHONG_LUU = { "Cache-Control": "no-store" } as const;
const than = z.strictObject({
  method: z.string().trim().min(1).max(40),
  maGiaoDichHoan: z.string().trim().min(1).max(80).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * POST /api/admin/online-refunds/[id]/pay { method, maGiaoDichHoan?, note? } — ghi dòng Payment ÂM qua `chiHoanTien` (nơi DUY NHẤT), rồi điều chỉnh quyền học.
 * Idempotent: chi lặp trên yêu cầu đã PAID không ghi thêm dòng âm. KHÔNG chạm cổng thanh toán thật — chỉ ghi sổ tiền hoàn kế toán đã chuyển.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const n = await nguoiQuanLyHoanOnline();
  if (!n.ok) return fail(n.ma, n.ma === "UNAUTHENTICATED" ? "Chưa đăng nhập." : "Không có quyền.", { status: n.status, headers: KHONG_LUU });
  let raw: unknown;
  try { raw = await req.json(); } catch { return fail("VALIDATION", "Yêu cầu không hợp lệ.", { status: 400, headers: KHONG_LUU }); }
  const p = than.safeParse(raw);
  if (!p.success) return fail("VALIDATION", "Cần phương thức chi hợp lệ.", { status: 400, headers: KHONG_LUU });
  const { id } = await ctx.params;
  const now = new Date();
  const r = await chiHoanOnline(db, { id, actorId: n.nguoi.id, actorName: n.nguoi.ten, method: p.data.method, paidDate: now, maGiaoDichHoan: p.data.maGiaoDichHoan ?? null, note: p.data.note ?? null, now });
  if (!r.ok) return fail(r.ma, r.thongBao, { status: HTTP_LOI_HOAN[r.ma], headers: KHONG_LUU });
  return ok({ soTien: r.soTien, quyen: r.quyen }, { headers: KHONG_LUU });
}
