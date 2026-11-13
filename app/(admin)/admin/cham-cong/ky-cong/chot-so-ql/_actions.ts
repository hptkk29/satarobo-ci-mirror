"use server";

// Chốt kỳ công theo số QL — CHỈ Quản trị tối cao, MỘT lần cho mỗi kỳ × cơ sở. Luật ở `lib/cham-cong/chot-so-ql.ts`.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { chotKyTheoSoQl, chotSoQlSchema } from "@/lib/cham-cong/chot-so-ql";

type Res = { ok: true; note: string } | { ok: false; error: string };

export async function chotKyTheoSoQlAction(input: unknown): Promise<Res> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const actor = await resolveActor(session.user.id);
  if (!actor.isSuperAdmin) return { ok: false, error: "Chỉ Quản trị tối cao được chốt kỳ theo số QL" };
  const p = chotSoQlSchema.safeParse(input);
  if (!p.success) {
    const i = p.error.issues[0];
    return { ok: false, error: `${i?.path.join(".") ?? ""}: ${i?.message ?? "Dữ liệu không hợp lệ"}` };
  }
  const actorName = session.user.name ?? session.user.email ?? "Quản trị";
  const r = await chotKyTheoSoQl({
    centerId: p.data.centerId,
    periodKey: p.data.ky,
    rows: p.data.rows,
    lyDo: p.data.lyDo,
    actorId: session.user.id,
    actorName,
  });
  if (!r.ok) return r;
  await writeAudit({
    actor: { id: session.user.id, name: actorName },
    module: "hr_attendance",
    entityType: "AttendancePeriod",
    entityId: `${p.data.centerId}:${p.data.ky}`,
    action: "LOCK_BY_MANAGER_FIGURES",
    oldValues: null,
    newValues: { people: r.people, units: r.units, rows: p.data.rows },
    reason: p.data.lyDo,
  });
  revalidatePath("/cham-cong/ky-cong");
  revalidatePath("/cham-cong/thong-ke");
  return { ok: true, note: `Đã chốt kỳ ${p.data.ky}: ${r.people} người, ${r.units} công` };
}
