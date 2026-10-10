"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { logStudentAudit, getAuditActor } from "@/lib/audit/log";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import {
  findEligibleTargetClasses,
  createTransferRequest,
  approveTransfer,
  rejectTransfer,
} from "@/lib/transfer/service";

// C1 — chuyển lớp/cơ sở. Gate enrollments:transfer (SUPER_ADMIN/CENTER_MANAGER).

// Cách ly cơ sở (chống IDOR ghi): lớp NGUỒN và lớp ĐÍCH đều phải nằm trong tầm
// nhìn cơ sở của actor — CS1 không chuyển HV sang/từ lớp CS2. scopedDb.class
// (Class ∈ SCOPED_MODELS) trả null nếu lớp ngoài scope. SUPER_ADMIN/HO → full.
async function classInScope(actor: Actor, classId: string | null | undefined): Promise<boolean> {
  if (!classId) return true; // chưa có lớp đích (waitlist) → không chặn ở bước này
  const cls = await scopedDb(actor).class.findUnique({ where: { id: classId }, select: { id: true } });
  return !!cls;
}

const createSchema = z.object({
  studentId: z.string().min(1),
  fromClassId: z.string().min(1),
  toClassId: z.string().optional().or(z.literal("")),
  toCenterId: z.string().optional().or(z.literal("")),
  reason: z.string().trim().max(2000).optional().or(z.literal("")),
});

export async function listEligibleClassesAction(input: {
  studentId: string;
  fromClassId: string;
  toCenterId?: string;
}): Promise<{ ok: boolean; error?: string; studentCovered?: number; classes?: unknown[] }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // P1-c: TẠO yêu cầu = enrollments:create (gồm SALES_CSM). Duyệt mới cần transfer.
  if (!(await checkPermission("enrollments:create"))) return { ok: false, error: "Không có quyền" };
  return findEligibleTargetClasses(input.studentId, input.fromClassId, input.toCenterId || null);
}

export async function createTransferRequestAction(input: unknown): Promise<{ ok: boolean; error?: string; waitlisted?: boolean }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // P1-c: sale/quản lý TẠO yêu cầu (chờ duyệt). KHÔNG tự thực hiện.
  if (!(await checkPermission("enrollments:create"))) return { ok: false, error: "Không có quyền" };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;

  // Cách ly cơ sở: lớp nguồn (+ lớp đích nếu có) phải thuộc tầm nhìn actor.
  const actor = await resolveActor(session.user.id);
  if (!(await classInScope(actor, d.fromClassId))) return { ok: false, error: "Lớp nguồn ngoài phạm vi cơ sở" };
  if (!(await classInScope(actor, d.toClassId || null))) return { ok: false, error: "Lớp đích ngoài phạm vi cơ sở" };

  const res = await createTransferRequest({
    studentId: d.studentId,
    fromClassId: d.fromClassId,
    toClassId: d.toClassId || null,
    toCenterId: d.toCenterId || null,
    reason: d.reason || null,
    requestedById: session.user.id,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/admin/chuyen-lop");
  return { ok: true, waitlisted: res.waitlisted };
}

export async function approveTransferAction(requestId: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("enrollments:transfer"))) return { ok: false, error: "Không có quyền" };

  // Cách ly cơ sở: lớp nguồn + lớp đích của yêu cầu đều phải thuộc tầm nhìn actor
  // (CS1 không duyệt chuyển liên quan lớp CS2 — chỉ SUPER_ADMIN/HO chuyển chéo CS).
  const actor = await resolveActor(session.user.id);
  const reqScope = await scopedDb(actor).studentTransferRequest.findUnique({
    where: { id: requestId },
    select: { fromClassId: true, toClassId: true },
  });
  if (!reqScope) return { ok: false, error: "Không tìm thấy yêu cầu" };
  if (!(await classInScope(actor, reqScope.fromClassId))) return { ok: false, error: "Lớp nguồn ngoài phạm vi cơ sở" };
  if (!(await classInScope(actor, reqScope.toClassId))) return { ok: false, error: "Lớp đích ngoài phạm vi cơ sở" };

  const auditActor = getAuditActor(session);
  const res = await approveTransfer(requestId, session.user.id, note ?? null, {
    actor: { id: auditActor.actorId, name: auditActor.actorName },
    reason: note ?? undefined,
  });
  if (!res.ok) return res;

  const req = await (await import("@/lib/db")).db.studentTransferRequest.findUnique({
    where: { id: requestId },
    select: { studentId: true, toClassId: true, toCenterId: true },
  });
  if (req) {
    const actor = getAuditActor(session);
    await logStudentAudit({
      studentId: req.studentId,
      action: "UPDATE",
      actorId: actor.actorId,
      actorName: actor.actorName,
      changedFields: ["transfer"],
      newValues: { toClassId: req.toClassId, toCenterId: req.toCenterId },
      reason: "Duyệt chuyển lớp/cơ sở",
    });
  }
  revalidatePath("/admin/chuyen-lop");
  return { ok: true };
}

export async function rejectTransferAction(requestId: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("enrollments:transfer"))) return { ok: false, error: "Không có quyền" };

  // Cách ly cơ sở: chỉ từ chối yêu cầu mà lớp nguồn thuộc tầm nhìn actor.
  const actor = await resolveActor(session.user.id);
  const reqScope = await scopedDb(actor).studentTransferRequest.findUnique({
    where: { id: requestId },
    select: { fromClassId: true },
  });
  if (!reqScope) return { ok: false, error: "Không tìm thấy yêu cầu" };
  if (!(await classInScope(actor, reqScope.fromClassId))) return { ok: false, error: "Lớp nguồn ngoài phạm vi cơ sở" };

  const res = await rejectTransfer(requestId, session.user.id, note ?? null);
  if (res.ok) revalidatePath("/admin/chuyen-lop");
  return res;
}
