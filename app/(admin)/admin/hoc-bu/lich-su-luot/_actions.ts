"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getAuditActor } from "@/lib/audit/log";
import { LoiHocBu } from "@/lib/hoc-bu/loi";
import { nguoiHocBu } from "@/lib/hoc-bu/pham-vi";
import { suaLuotHocVuot, suaLuotQlcs } from "@/lib/hoc-bu/lich-su-luot-db";

// app/(admin)/admin/hoc-bu/lich-su-luot/_actions.ts — QLCS SỬA lượt học bù đã cấp / số buổi bù đã duyệt học vượt (17/11/2026).
// Quyền `makeup:waive` (cùng quyền cấp thêm / giảm / duyệt học vượt) — KHÔNG đẻ quyền mới (quyền mới cần chạy `seed-prod-roles.yml`).
// Cổng IDOR nằm ở lớp dịch vụ (`lich-su-luot-db.ts`): bút toán / yêu cầu ngoài cơ sở của người sửa hiện như không tồn tại.

export type KetQuaSua = { ok: true; daDoi: boolean; thayDoi: number } | { ok: false; error: string };

const MA_LAN = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Phiên sửa không hợp lệ — đóng hộp và mở lại");

async function cong() {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission("makeup:waive"))) return { ok: false as const, error: "Chỉ Quản lý cơ sở / Quản trị tối cao sửa được lượt học bù" };
  const actor = nguoiHocBu(await resolveActor(session.user.id), null);
  return { ok: true as const, actor, ten: getAuditActor(session).actorName };
}

export async function suaLuotQlcsAction(input: unknown): Promise<KetQuaSua> {
  const p = z.object({ entryId: z.string().min(1), soMoi: z.number().int(), lyDo: z.string().max(500), maLan: MA_LAN }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const c = await cong();
  if (!c.ok) return c;
  try {
    const kq = await suaLuotQlcs(c.actor, { ...p.data, ten: c.ten });
    revalidatePath("/hoc-bu/lich-su-luot");
    revalidatePath("/hoc-bu");
    return { ok: true, ...kq };
  } catch (e) {
    if (e instanceof LoiHocBu) return { ok: false, error: e.message };
    throw e;
  }
}

export async function suaLuotHocVuotAction(input: unknown): Promise<KetQuaSua> {
  const p = z.object({ requestId: z.string().min(1), bMoi: z.number().int(), lyDo: z.string().max(500), maLan: MA_LAN }).safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const c = await cong();
  if (!c.ok) return c;
  try {
    const kq = await suaLuotHocVuot(c.actor, { ...p.data, ten: c.ten });
    revalidatePath("/hoc-bu/lich-su-luot");
    revalidatePath("/hoc-bu/duyet-hoc-vuot");
    revalidatePath("/hoc-bu");
    return { ok: true, ...kq };
  } catch (e) {
    if (e instanceof LoiHocBu) return { ok: false, error: e.message };
    throw e;
  }
}
