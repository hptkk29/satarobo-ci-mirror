"use server";

// app/(admin)/admin/cham-cong/phan-ca/_actions.ts — L3: sửa MỘT ô lưới tháng (MANUAL). Quyền
// `hr_attendance:assign` theo cơ sở của ca cũ lẫn ca mới. Đổi ca ⇒ thông báo người đó (T-07).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { notifyStaff } from "@/lib/notifications/notify";
import { HO_CENTER_ID, loadCenterMap } from "@/lib/cham-cong/home-center";
import { setAssignmentCell, type CellDb } from "@/lib/cham-cong/cells";
import { dateLabelVi } from "@/lib/cham-cong/brief";

type Res = { ok: true } | { ok: false; error: string };

const schema = z.object({
  userId: z.string().min(1),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  code: z.string().trim().toUpperCase().nullable(),
  homeUnit: z.string().min(1).max(8),
  note: z.string().trim().max(200).optional(),
});

export async function setCellAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const map = await loadCenterMap();
  const allowed = new Set<string>();
  for (const id of [...Object.values(map.byCode).map((c) => c.centerId), HO_CENTER_ID]) {
    if (await checkPermission("hr_attendance:assign", { centerId: id })) allowed.add(id);
  }
  if (allowed.size === 0) return { ok: false, error: "Không có quyền phân ca" };
  const [y, m, d] = p.data.workDate.split("-").map(Number);
  const workDate = new Date(Date.UTC(y, m - 1, d));
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const r = await setAssignmentCell({
    db: sdb as unknown as CellDb,
    userId: p.data.userId,
    workDate,
    code: p.data.code,
    homeUnit: p.data.homeUnit,
    centerMap: map,
    source: "MANUAL",
    note: p.data.note ?? null,
    actorUserId: session.user.id,
    canWriteCenter: (c) => allowed.has(c),
  });
  if (r.error) return { ok: false, error: r.error };
  if (r.changed) {
    await writeAudit({
      actor: { id: session.user.id, name: session.user.name ?? "" },
      module: "hr_attendance",
      entityType: "ShiftAssignment",
      entityId: r.after?.id ?? `${p.data.userId}:${p.data.workDate}`,
      action: "SET_CELL",
      oldValues: r.before ?? undefined,
      newValues: r.after ? { templateCode: r.after.templateCode, centerId: r.after.centerId } : { templateCode: null },
      reason: p.data.note,
    });
    // T-07: đổi ca ⇒ báo người đó (in-app). Không báo khi người sửa là chính người đó.
    if (p.data.userId !== session.user.id) {
      const from = r.before?.templateCode ?? "—";
      const to = r.after?.templateCode ?? "—";
      await notifyStaff({
        userIds: [p.data.userId],
        dedupeKey: `shift.changed:${p.data.userId}:${p.data.workDate}:${Date.now()}`,
        title: `Ca ${dateLabelVi(workDate)} đổi: ${from} → ${to}`,
        body: `${session.user.name ?? "Quản lý"} đã đổi ca của bạn ngày ${dateLabelVi(workDate)} từ ${from} sang ${to}${p.data.note ? ` — ${p.data.note}` : ""}.`,
        href: "/cham-cong/lich-ca",
        entityId: r.after?.id ?? null,
      });
    }
  }
  revalidatePath("/cham-cong/phan-ca");
  return { ok: true };
}
