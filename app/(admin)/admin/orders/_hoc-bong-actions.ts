"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { capHocBong100, thuHoiHocBong100, type KetQuaHocBong } from "@/lib/orders/hoc-bong-don";

// app/(admin)/admin/orders/_hoc-bong-actions.ts — Quản trị tối cao CẤP / THU HỒI học bổng 100% trên đơn (27/10/2026). Xem `lib/orders/hoc-bong-don.ts`.
// Cổng: phiên · `enrollments:override-progress` (quyền sẵn có của riêng Quản trị tối cao — cùng cổng với đổi buổi bắt đầu) · `isSuperAdmin` của actor · đơn nằm trong tầm nhìn cơ sở.

const Schema = z.object({ orderId: z.string().min(1), lyDo: z.string().trim().min(10, "Ghi lý do ít nhất 10 ký tự").max(500) });

async function cong(input: unknown) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission("enrollments:override-progress"))) return { ok: false as const, error: "Chỉ Quản trị tối cao cấp được học bổng toàn phần" };
  const p = Schema.safeParse(input);
  if (!p.success) return { ok: false as const, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const actor = await resolveActor(session.user.id);
  const don = await scopedDb(actor).order.findFirst({ where: { id: p.data.orderId, deletedAt: null }, select: { id: true } });
  if (!don) return { ok: false as const, error: "Không tìm thấy đơn" };
  const { actorId, actorName } = getAuditActor(session);
  return { ok: true as const, ...p.data, isSuperAdmin: actor.isSuperAdmin, nguoi: { id: actorId, name: actorName } };
}

export async function capHocBong100Action(input: unknown): Promise<KetQuaHocBong> {
  const c = await cong(input);
  if (!c.ok) return c;
  const kq = await capHocBong100({ orderId: c.orderId, lyDo: c.lyDo, isSuperAdmin: c.isSuperAdmin }, c.nguoi, new Date());
  if (kq.ok) {
    revalidatePath(`/orders/${c.orderId}`);
    revalidatePath(`/orders/${c.orderId}/chuyen-doi`);
  }
  return kq;
}

export async function thuHoiHocBong100Action(input: unknown): Promise<KetQuaHocBong> {
  const c = await cong(input);
  if (!c.ok) return c;
  const kq = await thuHoiHocBong100({ orderId: c.orderId, lyDo: c.lyDo, isSuperAdmin: c.isSuperAdmin }, c.nguoi, new Date());
  if (kq.ok) {
    revalidatePath(`/orders/${c.orderId}`);
    revalidatePath(`/orders/${c.orderId}/chuyen-doi`);
  }
  return kq;
}
