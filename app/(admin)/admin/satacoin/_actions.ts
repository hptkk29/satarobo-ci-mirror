"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { logStudentAudit, getAuditActor } from "@/lib/audit/log";
import { recordTransaction, reverseTransaction } from "@/lib/satacoin/service";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";

// C4 — SataCoin admin. Gate satacoin:manage.
// Cách ly cơ sở: SataCoinTransaction ∈ SCOPED_MODELS (theo HV); grant/reverse phải
// xác minh HV/giao dịch thuộc tầm nhìn cơ sở của actor trước khi ghi (chống IDOR).

async function gate(session: Session | null): Promise<string | null> {
  if (!session?.user) return "Chưa đăng nhập";
  if (!(await checkPermission("satacoin:manage"))) return "Không có quyền";
  return null;
}

const ruleSchema = z.object({
  code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/, "Mã chỉ gồm A-Z, 0-9, _"),
  label: z.string().trim().min(2).max(200),
  amount: z.coerce.number().int().refine((n) => n !== 0, "Khác 0"),
  centerId: z.string().optional().or(z.literal("")),
});

export async function createRule(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const err = await gate(session);
  if (err) return { ok: false, error: err };

  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;
  // SataCoinRule ∈ SCOPE_EXEMPT (config; centerId null = áp mọi cơ sở) — scopedDb
  // pass-through, rule toàn hệ thống KHÔNG bị ẩn.
  const sdb = scopedDb(await resolveActor(session!.user.id));
  try {
    await sdb.sataCoinRule.create({
      data: { code: d.code, label: d.label, amount: d.amount, centerId: d.centerId || null },
    });
  } catch {
    return { ok: false, error: "Mã rule đã tồn tại" };
  }
  revalidatePath("/admin/satacoin");
  return { ok: true };
}

export async function toggleRule(id: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (await gate(session)) return { ok: false };
  // SataCoinRule ∈ SCOPE_EXEMPT — pass-through (rule centerId null không bị ẩn).
  const sdb = scopedDb(await resolveActor(session!.user.id));
  const r = await sdb.sataCoinRule.findUnique({ where: { id }, select: { isActive: true } });
  if (r) await sdb.sataCoinRule.update({ where: { id }, data: { isActive: !r.isActive } });
  revalidatePath("/admin/satacoin");
  return { ok: true };
}

const grantSchema = z.object({
  studentId: z.string().min(1),
  amount: z.coerce.number().int().refine((n) => n !== 0, "Khác 0"),
  reason: z.string().trim().min(2).max(100),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function grantCoins(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const err = await gate(session);
  if (err) return { ok: false, error: err };

  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  // Cách ly cơ sở: HV phải thuộc tầm nhìn cơ sở của actor (chống cấp coin HV cơ sở khác).
  const scopeActor = await resolveActor(session!.user.id);
  const sdb = scopedDb(scopeActor);
  const student = await sdb.student.findUnique({ where: { id: d.studentId }, select: { centerId: true } });
  if (!student || !passesScope("Student", student, scopeActor)) {
    return { ok: false, error: "Không tìm thấy học viên" };
  }

  const res = await recordTransaction({
    studentId: d.studentId,
    amount: d.amount,
    type: d.amount > 0 ? "EARN" : "ADJUST",
    reason: d.reason,
    note: d.note || null,
    createdById: session!.user.id,
  });
  if (!res.ok) return { ok: false, error: res.error };

  const actor = getAuditActor(session);
  await logStudentAudit({
    studentId: d.studentId,
    action: "UPDATE",
    actorId: actor.actorId,
    actorName: actor.actorName,
    changedFields: ["satacoin"],
    newValues: { amount: d.amount, reason: d.reason },
    reason: "Cấp/điều chỉnh SataCoin",
  });
  revalidatePath("/admin/satacoin");
  return { ok: true };
}

export async function reverseCoinTx(txId: string, studentId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  const err = await gate(session);
  if (err) return { ok: false, error: err };

  // Cách ly cơ sở: giao dịch gốc phải thuộc tầm nhìn cơ sở của actor (chống IDOR đảo).
  const scopeActor = await resolveActor(session!.user.id);
  const sdb = scopedDb(scopeActor);
  const tx = await sdb.sataCoinTransaction.findUnique({ where: { id: txId }, select: { centerId: true } });
  if (!tx || !passesScope("SataCoinTransaction", tx, scopeActor)) {
    return { ok: false, error: "Không tìm thấy giao dịch" };
  }

  const res = await reverseTransaction(txId, session!.user.id, null);
  if (!res.ok) return { ok: false, error: res.error };

  const actor = getAuditActor(session);
  await logStudentAudit({
    studentId,
    action: "UPDATE",
    actorId: actor.actorId,
    actorName: actor.actorName,
    changedFields: ["satacoin"],
    newValues: { reversedTxId: txId },
    reason: "Đảo giao dịch SataCoin",
  });
  revalidatePath("/admin/satacoin");
  return { ok: true };
}
