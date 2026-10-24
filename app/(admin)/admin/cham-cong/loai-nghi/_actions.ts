"use server";

// app/(admin)/admin/cham-cong/loai-nghi/_actions.ts — L5: danh mục LOẠI NGHỈ (LeaveType) — K-06 theo
// MISA (8 loại seed sẵn), người vận hành thêm/sửa/ngưng không cần dev (PHẦN 6b). Danh mục dùng chung
// toàn hệ thống ⇒ quyền `hr_attendance:config` cấp Hội sở.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { HO_CENTER_ID } from "@/lib/cham-cong/home-center";

type Res = { ok: true; id: string } | { ok: false; error: string };

const schema = z.object({
  code: z.string().trim().min(1, "Thiếu mã").max(24).regex(/^[A-Z0-9_]+$/, "Mã chỉ gồm chữ hoa/số/_").transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, "Thiếu tên").max(80),
  paidRatio: z.coerce.number().min(0).max(1),
  maxDaysPerYear: z.coerce.number().int().min(0).max(366).nullable().default(null),
  // null = KHÔNG đòi báo trước. Ma chay / ốm / thai sản để trống — ép chúng theo một hạn
  // chung là biến ba loại đó thành "luôn vi phạm".
  noticeDays: z.coerce.number().int().min(0).max(60).nullable().default(null),
  countsAsWorked: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
});
export type LeaveTypeInput = z.input<typeof schema>;

export async function saveLeaveTypeAction(id: string | null, input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("hr_attendance:config", { centerId: HO_CENTER_ID }))) return { ok: false, error: "Danh mục loại nghỉ dùng chung — cần quyền cấu hình cấp Hội sở" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const sdb = scopedDb(await resolveActor(session.user.id));
  const dup = await sdb.leaveType.findUnique({ where: { code: p.data.code }, select: { id: true } });
  if (dup && dup.id !== id) return { ok: false, error: `Mã "${p.data.code}" đã tồn tại` };
  if (id) {
    const old = await sdb.leaveType.findUnique({ where: { id } });
    if (!old) return { ok: false, error: "Không tìm thấy loại nghỉ" };
    await sdb.leaveType.update({ where: { id }, data: p.data });
    await writeAudit({ actor: { id: session.user.id, name: session.user.name ?? "" }, module: "hr_attendance", entityType: "LeaveType", entityId: id, action: "UPDATE", oldValues: { code: old.code, name: old.name, paidRatio: old.paidRatio, maxDaysPerYear: old.maxDaysPerYear, noticeDays: old.noticeDays, isActive: old.isActive }, newValues: p.data });
    revalidatePath("/cham-cong/loai-nghi");
    return { ok: true, id };
  }
  const created = await sdb.leaveType.create({ data: { ...p.data, displayOrder: (await sdb.leaveType.count()) + 1 }, select: { id: true } });
  await writeAudit({ actor: { id: session.user.id, name: session.user.name ?? "" }, module: "hr_attendance", entityType: "LeaveType", entityId: created.id, action: "CREATE", newValues: p.data });
  revalidatePath("/cham-cong/loai-nghi");
  return { ok: true, id: created.id };
}
