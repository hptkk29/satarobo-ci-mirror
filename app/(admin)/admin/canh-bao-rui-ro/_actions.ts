"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";

// B2 — xử lý cảnh báo rủi ro + care task. Gate students:view-all (quản lý/CSM).
// Cách ly cơ sở: StudentRiskAlert/StudentCareTask ∈ SCOPED_MODELS → đọc qua
// scopedDb (auto null-filter) + passesScope trước khi ghi (chống IDOR liên cơ sở).

type Result = { ok: boolean; error?: string };

async function gate() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập", uid: null, actor: null };
  if (!(await checkPermission("students:view-all"))) return { ok: false as const, error: "Không có quyền", uid: null, actor: null };
  const actor = await resolveActor(session.user.id);
  return { ok: true as const, uid: session.user.id, actor };
}

export async function resolveRiskAlert(id: string): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  const actor: Actor = g.actor;
  const sdb = scopedDb(actor);
  const row = await sdb.studentRiskAlert.findUnique({ where: { id }, select: { centerId: true } });
  if (!row || !passesScope("StudentRiskAlert", row, actor)) return { ok: false, error: "Không tìm thấy" };
  await sdb.studentRiskAlert.update({
    where: { id },
    data: { status: "RESOLVED", resolvedById: g.uid, resolvedAt: new Date() },
  });
  revalidatePath("/canh-bao-rui-ro");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function escalateRiskAlert(id: string): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  const actor: Actor = g.actor;
  const sdb = scopedDb(actor);
  const row = await sdb.studentRiskAlert.findUnique({ where: { id }, select: { centerId: true } });
  if (!row || !passesScope("StudentRiskAlert", row, actor)) return { ok: false, error: "Không tìm thấy" };
  await sdb.studentRiskAlert.update({ where: { id }, data: { status: "ESCALATED", severity: "HIGH" } });
  revalidatePath("/canh-bao-rui-ro");
  return { ok: true };
}

export async function completeCareTask(id: string): Promise<Result> {
  const g = await gate();
  if (!g.ok) return g;
  const actor: Actor = g.actor;
  const sdb = scopedDb(actor);
  const existing = await sdb.studentCareTask.findUnique({ where: { id }, select: { centerId: true } });
  if (!existing || !passesScope("StudentCareTask", existing, actor)) return { ok: false, error: "Không tìm thấy" };
  const task = await sdb.studentCareTask.update({
    where: { id },
    data: { status: "DONE", completedAt: new Date() },
    select: { riskAlertId: true },
  });
  // Hoàn tất task chăm sóc → đóng alert liên quan (nếu còn OPEN).
  if (task.riskAlertId) {
    await sdb.studentRiskAlert.updateMany({
      where: { id: task.riskAlertId, status: "OPEN" },
      data: { status: "RESOLVED", resolvedById: g.uid, resolvedAt: new Date() },
    });
  }
  revalidatePath("/cham-soc-hv");
  revalidatePath("/canh-bao-rui-ro");
  revalidatePath("/dashboard");
  return { ok: true };
}
