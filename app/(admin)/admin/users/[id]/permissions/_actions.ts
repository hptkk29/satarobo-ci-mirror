"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import type { Prisma } from "@prisma/client";
import {
  grantCreateSchema,
  grantUpdateSchema,
} from "@/lib/validators/permission-grant";
import { logGrantAudit, getAuditActor } from "@/lib/audit/log";

async function requireUsersManage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("users:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

// User/UserPermissionGrant không thuộc SCOPED_MODELS (identity/quyền toàn cục)
// → scopedDb pass-through, hành vi y nguyên; swap để sạch import @/lib/db (R6-F1).
async function scopedDbForSession(session: { user: { id: string } }) {
  return scopedDb(await resolveActor(session.user.id));
}

// ─── ADD GRANT ──────────────────────────────────────────────────────
export async function addGrantAction(userId: string, formData: FormData) {
  const session = await requireUsersManage();
  const sdb = await scopedDbForSession(session);
  const me = session.user;

  const parsed = grantCreateSchema.safeParse({
    action: formData.get("action"),
    grant: formData.get("grant"),
    reason: formData.get("reason") || null,
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }

  const targetUser = await sdb.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!targetUser) return { ok: false as const, error: "Không tìm thấy user" };

  // SUPER_ADMIN bypass grants → tạo grants không có hiệu lực
  if (isSuperAdmin(targetUser.role)) {
    return {
      ok: false as const,
      error: "SUPER_ADMIN có toàn quyền — không cần override permissions",
    };
  }

  // SEC-M13: chặn leo thang quyền qua grant. KHÔNG cho ALLOW các action quản trị-quyền
  // (roles:* → có thể tự gán SUPER_ADMIN; users:manage → quản user) qua override từng
  // người — những quyền này chỉ đến từ vai trò. LƯU Ý: *:view-pii CỐ Ý cho grant per-user
  // (OI-4, Kiệt ký 10/07 — MARKETING xem PII lead) nên KHÔNG chặn ở đây.
  if (
    parsed.data.grant === "ALLOW" &&
    (parsed.data.action.startsWith("roles:") || parsed.data.action === "users:manage")
  ) {
    return {
      ok: false as const,
      error:
        "Không thể cấp quyền quản trị-quyền (vai trò / quản lý user) qua override từng người — dùng gán vai trò.",
    };
  }

  // Duplicate check (composite unique sẽ throw, nhưng UX tốt hơn nếu báo trước)
  const existing = await sdb.userPermissionGrant.findUnique({
    where: { userId_action: { userId, action: parsed.data.action } },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false as const,
      error: "Quyền này đã được override — xoá grant cũ hoặc chỉnh sửa thay vì thêm mới",
    };
  }

  const { actorId, actorName } = getAuditActor(session);

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    const newGrant = await tx.userPermissionGrant.create({
      data: {
        userId,
        action: parsed.data.action,
        grant: parsed.data.grant,
        reason: parsed.data.reason ?? null,
        grantedBy: me.id,
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } }, // force re-login
    });

    await logGrantAudit({
      userId,
      grantId: newGrant.id,
      actionKey: parsed.data.action,
      action: "ADD",
      actorId,
      actorName,
      newGrant: parsed.data.grant,
      reason: parsed.data.reason ?? undefined,
      tx,
    });
  });

  revalidatePath(`/users/${userId}/permissions`);
  revalidatePath(`/users/${userId}/edit`);
  revalidatePath(`/users`);
  return { ok: true as const };
}

// ─── UPDATE GRANT ───────────────────────────────────────────────────
export async function updateGrantAction(grantId: string, formData: FormData) {
  const session = await requireUsersManage();
  const sdb = await scopedDbForSession(session);

  const parsed = grantUpdateSchema.safeParse({
    grant: formData.get("grant"),
    reason: formData.get("reason") || null,
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }

  const currentGrant = await sdb.userPermissionGrant.findUnique({
    where: { id: grantId },
    select: { userId: true, action: true, grant: true },
  });
  if (!currentGrant)
    return { ok: false as const, error: "Không tìm thấy grant" };

  const { actorId, actorName } = getAuditActor(session);

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.userPermissionGrant.update({
      where: { id: grantId },
      data: { grant: parsed.data.grant, reason: parsed.data.reason ?? null },
    });

    await tx.user.update({
      where: { id: currentGrant.userId },
      data: { tokenVersion: { increment: 1 } },
    });

    await logGrantAudit({
      userId: currentGrant.userId,
      grantId,
      actionKey: currentGrant.action,
      action: "UPDATE",
      actorId,
      actorName,
      oldGrant: currentGrant.grant,
      newGrant: parsed.data.grant,
      reason: parsed.data.reason ?? undefined,
      tx,
    });
  });

  revalidatePath(`/users/${currentGrant.userId}/permissions`);
  revalidatePath(`/users/${currentGrant.userId}/edit`);
  return { ok: true as const };
}

// ─── REMOVE GRANT ───────────────────────────────────────────────────
export async function removeGrantAction(grantId: string) {
  const session = await requireUsersManage();
  const sdb = await scopedDbForSession(session);

  const currentGrant = await sdb.userPermissionGrant.findUnique({
    where: { id: grantId },
    select: { userId: true, action: true, grant: true },
  });
  if (!currentGrant)
    return { ok: false as const, error: "Không tìm thấy grant" };

  const { actorId, actorName } = getAuditActor(session);

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.userPermissionGrant.delete({ where: { id: grantId } });

    await tx.user.update({
      where: { id: currentGrant.userId },
      data: { tokenVersion: { increment: 1 } },
    });

    await logGrantAudit({
      userId: currentGrant.userId,
      grantId: null,
      actionKey: currentGrant.action,
      action: "REMOVE",
      actorId,
      actorName,
      oldGrant: currentGrant.grant,
      tx,
    });
  });

  revalidatePath(`/users/${currentGrant.userId}/permissions`);
  revalidatePath(`/users/${currentGrant.userId}/edit`);
  revalidatePath(`/users`);
  return { ok: true as const };
}
