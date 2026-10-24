"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import type { Prisma } from "@prisma/client";
import {
  userCreateSchema,
  userUpdateSchema,
  passwordResetSchema,
} from "@/lib/validators/user";
import { reassignOpenLeads } from "@/lib/lead/assign";
import { notifyStaffAccountGranted } from "@/lib/email/staff-account";
import { centerIdForOrgUnit } from "@/lib/org/org-service";
import { keoHoSoTheoTaiKhoan } from "@/lib/hr/sync-employee-unit";
import { reconcileUserOrgRoles, OrgRoleSyncError } from "@/lib/auth/org-role-sync";
import { syncCenterClassConversations } from "@/lib/chat/sync-membership";
import {
  logUserAudit,
  detectChangedFields,
  getAuditActor,
} from "@/lib/audit/log";

async function requireUsersManage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("users:manage"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

// User là SCOPE_EXEMPT (identity toàn cục) → scopedDb pass-through, hành vi y nguyên;
// swap để file sạch import @/lib/db trần (R6-F1).
async function scopedDbForSession(session: { user: { id: string } }) {
  return scopedDb(await resolveActor(session.user.id));
}

// ─── CREATE ──────────────────────────────────────────────────────────
export async function createUserAction(formData: FormData) {
  const session = await requireUsersManage();
  const sdb = await scopedDbForSession(session);

  const parsed = userCreateSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone") || null,
    password: formData.get("password"),
    roles: formData.getAll("roles"),
    primaryRole: formData.get("primaryRole"),
    centerId: formData.get("centerId") || null,
    orgUnitId: formData.get("orgUnitId") || null,
    employeeId: formData.get("employeeId") || null,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }

  // Email unique
  const existing = await sdb.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: "Email đã được sử dụng" };
  }

  // SĐT unique (khoá đăng nhập — AUTH-SĐT P3).
  if (parsed.data.phone) {
    const phoneUsed = await sdb.user.findUnique({
      where: { phone: parsed.data.phone },
      select: { id: true },
    });
    if (phoneUsed) {
      return { ok: false, error: "Số điện thoại đã được sử dụng" };
    }
  }

  // Employee chưa link User khác
  if (parsed.data.employeeId) {
    const empUsed = await sdb.user.findFirst({
      where: { employeeId: parsed.data.employeeId },
      select: { id: true },
    });
    if (empUsed) {
      return { ok: false, error: "Nhân sự này đã có tài khoản đăng nhập" };
    }
  }

  const hashed = await bcrypt.hash(parsed.data.password, 10);
  const { actorId, actorName } = getAuditActor(session);

  // PR-B dual-write: chốt theo OrgUnit, suy centerId từ orgUnitId (HO → null).
  const orgUnitId = parsed.data.orgUnitId ?? null;
  const centerId = await centerIdForOrgUnit(orgUnitId);

  const user = await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    const created = await tx.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone ?? null,
        password: hashed,
        // Đợt 3B — role = vai trò chính (primary), roles = toàn bộ (union quyền).
        role: parsed.data.primaryRole,
        roles: parsed.data.roles,
        centerId,
        orgUnitId,
        employeeId: parsed.data.employeeId ?? null,
        isActive: true,
        tokenVersion: 0,
        // BGĐ 31/07 — MK do admin đặt → bắt đổi ngay lần đăng nhập đầu.
        mustChangePassword: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        roles: true,
        centerId: true,
        employeeId: true,
        isActive: true,
      },
    });

    await logUserAudit({
      userId: created.id,
      action: "CREATE",
      actorId,
      actorName,
      newValues: {
        email: created.email,
        phone: created.phone,
        role: created.role,
        roles: created.roles,
        centerId: created.centerId,
        employeeId: created.employeeId,
        isActive: created.isActive,
      },
      tx,
    });

    // RBAC v2: sinh luôn UserOrgRole theo roles[] + đơn vị đã chọn. Trước 07/08/2026
    // bước này KHÔNG có → tài khoản mới rỗng quyền trên prod (GV vào được site GV
    // nhưng bấm Lưu điểm danh ra "Không có quyền điểm danh lớp này"). Thiếu đơn vị /
    // RoleDef → ném lỗi, rollback cả cụm: thà không tạo còn hơn tạo tài khoản què quyền.
    await reconcileUserOrgRoles({
      tx,
      userId: created.id,
      previous: { roles: [], orgUnitId: null },
      next: { roles: parsed.data.roles, orgUnitId },
      actorId,
      actorName,
      reason: "Tự động gán theo vai trò khi tạo tài khoản",
    });

    // US-03 chat — tài khoản mới là QLCS → vào nhóm mọi lớp ACTIVE của cơ sở, cùng tx.
    if (parsed.data.roles.includes("CENTER_MANAGER")) {
      await syncCenterClassConversations(tx, centerId);
    }

    // Tạo tài khoản CHO một hồ sơ có sẵn: đơn vị chọn ở đây là đơn vị của người đó ⇒
    // hồ sơ phải theo ngay, đừng để hai bảng lệch từ lúc sinh ra.
    await keoHoSoTheoTaiKhoan(tx, {
      employeeId: created.employeeId,
      donVi: { centerId, orgUnitId },
      actor: { id: actorId, name: actorName },
    });

    return created;
    // timeout 30s: syncCenterClassConversations chạm mọi lớp ACTIVE của cơ sở
  }, { timeout: 30_000, maxWait: 10_000 }).catch((err: unknown) => {
    // Lỗi RBAC hiện nguyên văn cho admin; lỗi khác giữ nguyên hành vi cũ (ném lên).
    if (err instanceof OrgRoleSyncError) return { syncError: err.message };
    throw err;
  });
  if ("syncError" in user) return { ok: false, error: user.syncError };

  // BGĐ 31/07 — gửi thông tin đăng nhập (email kèm MK — log mask; ZNS không MK).
  // Fire-and-forget: lỗi gửi không chặn việc tạo tài khoản.
  notifyStaffAccountGranted({
    email: user.email,
    phone: user.phone,
    name: user.name,
    roles: user.roles.length > 0 ? user.roles : [user.role],
    password: parsed.data.password,
  }).catch(() => {});

  revalidatePath("/users");
  return { ok: true as const, id: user.id };
}

// ─── UPDATE ──────────────────────────────────────────────────────────
export async function updateUserAction(id: string, formData: FormData) {
  const session = await requireUsersManage();
  const sdb = await scopedDbForSession(session);
  const me = session.user;

  const parsed = userUpdateSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    roles: formData.getAll("roles"),
    primaryRole: formData.get("primaryRole"),
    centerId: formData.get("centerId") || null,
    orgUnitId: formData.get("orgUnitId") || null,
    employeeId: formData.get("employeeId") || null,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }

  const current = await sdb.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      roles: true,
      centerId: true,
      // Đơn vị TRƯỚC — mốc để suy vai v2 cần thu hồi khi đổi vai trò/đổi đơn vị.
      orgUnitId: true,
      employeeId: true,
    },
  });
  if (!current) return { ok: false, error: "Không tìm thấy user" };

  // Đợt 3B — vai trò hữu hiệu hiện tại (roles[] ưu tiên, fallback role chính).
  const currentRoles =
    current.roles.length > 0 ? current.roles : [current.role];
  const nextRoles = parsed.data.roles;
  const sameRoleSet =
    currentRoles.length === nextRoles.length &&
    currentRoles.every((r) => nextRoles.includes(r));
  const rolesChanged = !sameRoleSet || parsed.data.primaryRole !== current.role;

  // Self-protection: không cho tự đổi vai trò của chính mình (chống tự khoá).
  if (id === me.id && rolesChanged) {
    return { ok: false, error: "Không thể tự đổi vai trò của chính mình" };
  }

  // Last SUPER_ADMIN protection — xét theo union roles, không chỉ role chính.
  const wasSuperAdmin = currentRoles.includes("SUPER_ADMIN");
  const willBeSuperAdmin = nextRoles.includes("SUPER_ADMIN");
  if (wasSuperAdmin && !willBeSuperAdmin) {
    const remaining = await sdb.user.count({
      where: {
        roles: { has: "SUPER_ADMIN" },
        isActive: true,
        deletedAt: null,
        id: { not: id },
      },
    });
    if (remaining === 0) {
      return {
        ok: false,
        error: "Không thể demote SUPER_ADMIN duy nhất của hệ thống",
      };
    }
  }

  // Email unique nếu thay đổi
  if (parsed.data.email !== current.email) {
    const existing = await sdb.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    });
    if (existing && existing.id !== id) {
      return { ok: false, error: "Email đã được sử dụng" };
    }
  }

  // Employee link nếu thay đổi
  if (parsed.data.employeeId && parsed.data.employeeId !== current.employeeId) {
    const empUsed = await sdb.user.findFirst({
      where: { employeeId: parsed.data.employeeId, id: { not: id } },
      select: { id: true },
    });
    if (empUsed) {
      return { ok: false, error: "Nhân sự này đã có tài khoản đăng nhập khác" };
    }
  }

  // Increment tokenVersion nếu vai trò thay đổi → force re-login (token mang roles).
  const { actorId, actorName } = getAuditActor(session);

  // PR-B dual-write: chốt theo OrgUnit, suy centerId từ orgUnitId (HO → null).
  const orgUnitId = parsed.data.orgUnitId ?? null;
  const centerId = await centerIdForOrgUnit(orgUnitId);

  const synced = await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    const updated = await tx.user.update({
      where: { id },
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        // Đợt 3B — role chính + roles (union quyền).
        role: parsed.data.primaryRole,
        roles: parsed.data.roles,
        centerId,
        orgUnitId,
        employeeId: parsed.data.employeeId ?? null,
        ...(rolesChanged && { tokenVersion: { increment: 1 } }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roles: true,
        centerId: true,
        employeeId: true,
      },
    });

    const oldValues = {
      name: current.name,
      email: current.email,
      role: current.role,
      roles: current.roles,
      centerId: current.centerId,
      employeeId: current.employeeId,
    };
    const newValues = {
      name: updated.name,
      email: updated.email,
      role: updated.role,
      roles: updated.roles,
      centerId: updated.centerId,
      employeeId: updated.employeeId,
    };

    await logUserAudit({
      userId: id,
      action: rolesChanged ? "ROLE_CHANGE" : "UPDATE",
      actorId,
      actorName,
      oldValues,
      newValues,
      changedFields: detectChangedFields(oldValues, newValues),
      tx,
    });

    // ĐƠN VỊ NẰM Ở HAI BẢNG — sửa tài khoản thì kéo hồ sơ nhân sự theo, cùng transaction
    // (xem lib/hr/sync-employee-unit.ts). Tài khoản không gắn hồ sơ (phụ huynh) → no-op.
    await keoHoSoTheoTaiKhoan(tx, {
      employeeId: updated.employeeId,
      donVi: { centerId, orgUnitId },
      actor: { id: actorId, name: actorName },
    });

    // RBAC v2 đi kèm: gán vai còn thiếu (chữa cả tài khoản tạo trước 07/08/2026) và
    // thu hồi vai suy từ bộ vai trò/đơn vị CŨ mà bộ MỚI không còn. Vai gán tay ở
    // /admin/users/[id]/org-roles nằm ngoài bảng ánh xạ → không bị đụng.
    await reconcileUserOrgRoles({
      tx,
      userId: id,
      previous: { roles: currentRoles, orgUnitId: current.orgUnitId },
      next: { roles: parsed.data.roles, orgUnitId },
      actorId,
      actorName,
      reason: "Tự động đồng bộ khi sửa vai trò/đơn vị tài khoản",
    });

    // US-03 chat — đổi QLCS (thêm/bỏ vai CENTER_MANAGER hoặc đổi cơ sở) → đồng bộ
    // nhóm lớp của cơ sở CŨ lẫn MỚI trong cùng transaction (F-SYNC "đổi QLCS").
    const touchesCenterManager =
      currentRoles.includes("CENTER_MANAGER") ||
      parsed.data.roles.includes("CENTER_MANAGER");
    if (touchesCenterManager) {
      await syncCenterClassConversations(tx, current.centerId);
      if (centerId !== current.centerId) {
        await syncCenterClassConversations(tx, centerId);
      }
    }
  }, { timeout: 30_000, maxWait: 10_000 }).catch((err: unknown) => {
    if (err instanceof OrgRoleSyncError) return { syncError: err.message };
    throw err;
  });
  if (synced && "syncError" in synced) {
    return { ok: false, error: synced.syncError };
  }

  revalidatePath("/users");
  revalidatePath(`/users/${id}/edit`);
  return { ok: true as const };
}

// ─── TOGGLE ACTIVE ───────────────────────────────────────────────────
export async function toggleUserActiveAction(id: string) {
  const session = await requireUsersManage();
  const sdb = await scopedDbForSession(session);
  const me = session.user;

  if (id === me.id) {
    return { ok: false, error: "Không thể tự disable chính mình" };
  }

  const user = await sdb.user.findUnique({
    where: { id },
    select: { isActive: true, role: true, roles: true, centerId: true },
  });
  if (!user) return { ok: false, error: "Không tìm thấy user" };
  // Đa vai trò: nhận diện SALES_CSM theo cả role chính lẫn roles[].
  const wasSalesCsm = hasRole(user, "SALES_CSM");

  // Last SUPER_ADMIN check (chỉ áp dụng khi đang active + đi disable)
  if (hasRole(user, "SUPER_ADMIN") && user.isActive) {
    const remaining = await sdb.user.count({
      where: {
        roles: { has: "SUPER_ADMIN" },
        isActive: true,
        deletedAt: null,
        id: { not: id },
      },
    });
    if (remaining === 0) {
      return { ok: false, error: "Không thể disable SUPER_ADMIN duy nhất" };
    }
  }

  const willBeActive = !user.isActive;
  const { actorId, actorName } = getAuditActor(session);

  // P0-c: bọc try/catch — lỗi DB trả message rõ, không ném stack trace cho client.
  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await tx.user.update({
        where: { id },
        data: {
          isActive: willBeActive,
          tokenVersion: { increment: 1 }, // force logout
        },
      });

      await logUserAudit({
        userId: id,
        action: willBeActive ? "ENABLE" : "DISABLE",
        actorId,
        actorName,
        oldValues: { isActive: user.isActive },
        newValues: { isActive: willBeActive },
        changedFields: ["isActive"],
        tx,
      });

      // US-03 chat — bật/tắt tài khoản QLCS đổi tập QLCS hiệu lực của cơ sở (nguồn v1
      // lọc isActive) → đồng bộ nhóm lớp của cơ sở trong cùng transaction.
      if (hasRole(user, "CENTER_MANAGER")) {
        await syncCenterClassConversations(tx, user.centerId);
      }
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (err) {
    console.error("[toggleUserActive] error:", err);
    return { ok: false, error: "Không cập nhật được trạng thái tài khoản — thử lại" };
  }

  // Phase T1.3 — sale SALES_CSM bị disable → chia lại lead OPEN cho người còn lại.
  // Gọi SAU tx (isActive đã false), best-effort: lỗi chia lead KHÔNG làm hỏng disable.
  if (!willBeActive && wasSalesCsm) {
    await reassignOpenLeads(id, { actorId, actorName }).catch((err) =>
      console.error("[toggleUserActive] reassign leads error:", err),
    );
    revalidatePath("/leads");
  }

  revalidatePath("/users");
  return { ok: true as const };
}

// ─── DELETE (soft) ───────────────────────────────────────────────────
// Chỉ dọn dữ liệu test: soft-delete tài khoản ĐÃ vô hiệu hóa. KHÔNG hard
// delete (User có nhiều quan hệ: leads, lớp dạy, audit logs, con cái).
export async function deleteUserAction(id: string) {
  const session = await requireUsersManage();
  const sdb = await scopedDbForSession(session);
  const me = session.user;

  if (id === me.id) {
    return { ok: false, error: "Không thể tự xóa chính mình" };
  }

  const user = await sdb.user.findUnique({
    where: { id },
    select: { isActive: true, email: true, role: true, roles: true },
  });
  if (!user) return { ok: false, error: "Không tìm thấy user" };

  if (user.isActive) {
    return { ok: false, error: "Chỉ xóa tài khoản đã vô hiệu hóa" };
  }

  // Last SUPER_ADMIN guard (mirror page.tsx / toggle): không xóa SUPER_ADMIN
  // active duy nhất. Tài khoản ở đây đã isActive=false nên thường không vướng,
  // nhưng giữ guard cho an toàn nếu có race.
  if (
    (user.role === "SUPER_ADMIN" || user.roles.includes("SUPER_ADMIN")) &&
    user.isActive
  ) {
    const remaining = await sdb.user.count({
      where: {
        roles: { has: "SUPER_ADMIN" },
        isActive: true,
        deletedAt: null,
        id: { not: id },
      },
    });
    if (remaining === 0) {
      return { ok: false, error: "Không thể xóa SUPER_ADMIN duy nhất" };
    }
  }

  const { actorId, actorName } = getAuditActor(session);

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await tx.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          tokenVersion: { increment: 1 }, // force logout
        },
      });

      await logUserAudit({
        userId: id,
        action: "DISABLE",
        actorId,
        actorName,
        reason: "Xóa tài khoản (soft delete — dọn dữ liệu test)",
        oldValues: { deletedAt: null, isActive: user.isActive },
        newValues: { deletedAt: new Date().toISOString(), isActive: false },
        changedFields: ["deletedAt", "isActive"],
        tx,
      });
    });
  } catch (err) {
    console.error("[deleteUser] error:", err);
    return { ok: false, error: "Không xóa được tài khoản — thử lại" };
  }

  revalidatePath("/users");
  return { ok: true as const };
}

// ─── RESET PASSWORD ──────────────────────────────────────────────────
export async function resetUserPasswordAction(id: string, formData: FormData) {
  const session = await requireUsersManage();
  const sdb = await scopedDbForSession(session);

  const parsed = passwordResetSchema.safeParse({
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Mật khẩu không hợp lệ",
    };
  }

  const user = await sdb.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, phone: true, role: true, roles: true },
  });
  if (!user) return { ok: false, error: "Không tìm thấy user" };

  const hashed = await bcrypt.hash(parsed.data.newPassword, 10);
  const { actorId, actorName } = getAuditActor(session);

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.user.update({
      where: { id },
      data: {
        password: hashed,
        tokenVersion: { increment: 1 }, // force logout
        // BGĐ 31/07 — MK do admin đặt lại → bắt đổi ngay lần đăng nhập kế tiếp.
        mustChangePassword: true,
      },
    });

    await logUserAudit({
      userId: id,
      action: "PASSWORD_RESET",
      actorId,
      actorName,
      // KHÔNG log oldValues/newValues — không leak hash
      tx,
    });
  });

  // BGĐ 31/07 — báo user mật khẩu mới (email kèm MK — log mask; ZNS không MK).
  notifyStaffAccountGranted({
    email: user.email,
    phone: user.phone,
    name: user.name,
    roles: user.roles.length > 0 ? user.roles : [user.role],
    password: parsed.data.newPassword,
  }).catch(() => {});

  revalidatePath("/users");
  return { ok: true as const };
}
