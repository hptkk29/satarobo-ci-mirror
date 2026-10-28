"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { coSoCuaYeuCau, duyetHocVuotCoGiaoDich, tuChoiHocVuotCoGiaoDich } from "@/lib/orders/hoc-vuot-cho-duyet";

// app/(admin)/admin/hoc-bu/duyet-hoc-vuot/_actions.ts — Quản lý cơ sở DUYỆT / TỪ CHỐI yêu cầu học vượt bù từ màn Chuyển đổi (27/10/2026).
// Quyền `makeup:waive` (cùng quyền duyệt case / miễn phí / huỷ buổi cần bù) — KHÔNG đẻ quyền mới (quyền mới cần chạy `seed-prod-roles.yml`).
// Cổng IDOR: yêu cầu phải nằm trong tầm nhìn cơ sở của người duyệt (`scopedDb`).

export type KetQuaDuyetHocVuot = { ok: true; soDongBu?: number; luotCong?: number } | { ok: false; error: string };

async function cong(requestId: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission("makeup:waive"))) return { ok: false as const, error: "Chỉ Quản lý cơ sở / Quản trị tối cao duyệt được học vượt bù" };
  const actor = await resolveActor(session.user.id);
  const centerId = await coSoCuaYeuCau(scopedDb(actor), requestId);
  if (!centerId) return { ok: false as const, error: "Không tìm thấy yêu cầu (hoặc thuộc cơ sở ngoài tầm nhìn của bạn)" };
  const { actorId, actorName } = getAuditActor(session);
  return { ok: true as const, centerId, nguoi: { id: actorId, name: actorName } };
}

export async function duyetHocVuotAction(input: unknown): Promise<KetQuaDuyetHocVuot> {
  const p = z.object({ requestId: z.string().min(1) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  const c = await cong(p.data.requestId);
  if (!c.ok) return c;
  try {
    const kq = await duyetHocVuotCoGiaoDich(p.data.requestId, c.centerId, c.nguoi, new Date());
    if (!kq.ok) return kq;
    revalidatePath("/hoc-bu/duyet-hoc-vuot");
    revalidatePath("/hoc-bu");
    return { ok: true, soDongBu: kq.soDongBu, luotCong: kq.luotCong };
  } catch (e) {
    return { ok: false, error: `Không duyệt được: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
  }
}

export async function tuChoiHocVuotAction(input: unknown): Promise<KetQuaDuyetHocVuot> {
  const p = z.object({ requestId: z.string().min(1), lyDo: z.string().trim().min(10, "Ghi lý do ít nhất 10 ký tự").max(500) }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const c = await cong(p.data.requestId);
  if (!c.ok) return c;
  try {
    const kq = await tuChoiHocVuotCoGiaoDich(p.data.requestId, c.centerId, c.nguoi, new Date(), p.data.lyDo);
    if (!kq.ok) return kq;
    revalidatePath("/hoc-bu/duyet-hoc-vuot");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Không từ chối được: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
  }
}
