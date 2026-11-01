"use server";

// US-03 (Nền Hệ thống P0) — 7 Server Action quản lý UserGroup + thành viên + grant nhóm.
//
// Luật cứng của module:
//   - MỌI action: auth() → assertPermission("user-groups:manage") GỌI TRỰC TIẾP trong
//     thân (lint authz/require-can-in-write-action đọc AST thân function — CẤM wrapper,
//     CẤM vào inline-authz-allowlist).
//   - Nhóm: SOFT DELETE (deletedAt) — nhóm xoá → resolveActor bỏ membership → grant
//     GROUP vô hiệu ngay lần resolve kế, KHÔNG dọn PermissionGrant.
//   - Thành viên: HARD DELETE — gỡ là mất quyền ở request kế tiếp (AC3, cache theo request).
//   - Grant: permissionKey phải tồn tại + isActive trong PermissionDescriptor (registry DB
//     là nguồn sự thật — KHÔNG đối chiếu matrix v1 vì registry có key khai trước của chat);
//     dataScope P0 chỉ ALL (siết 09/08 — bẫy ALLOW+OWN thu hồi im lặng, xem validator),
//     khoá quản trị NON_GROUP_GRANTABLE_KEYS bị chặn (chống tự-leo-thang), ALLOW ⇒
//     fieldMask rỗng, reason bắt buộc (tất cả nằm trong groupGrantCreateSchema).
//   - Thành viên: KHÔNG nhận tài khoản PARENT — đối xứng query ứng viên của [id]/page.tsx
//     (groupMemberIneligibleReason — validator file, có unit test pin).
//   - Mọi mutation ghi RbacAuditLog TRONG CÙNG transaction (entity GROUP / GROUP_MEMBER /
//     GROUP_GRANT — cột entity là String, viewer đọc thẳng).
// UserGroup/UserGroupMember/PermissionGrant ∉ SCOPED_MODELS (cấu hình quyền toàn cục
// như RoleDef) → scopedDb pass-through; gate là quyền user-groups:manage (SUPER_ADMIN).

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { assertPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import {
  userGroupCreateSchema,
  userGroupUpdateSchema,
  groupMemberAddSchema,
  groupGrantCreateSchema,
  groupMemberIneligibleReason,
} from "@/lib/validators/user-group";

type Result = { ok: true; id?: string } | { ok: false; error: string };

const KHONG_QUYEN = "Không có quyền quản lý nhóm người dùng";

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Đường dẫn revalidate: list + (nếu có) trang chi tiết nhóm.
 * Path phải là ROUTE THẬT sau khi strip route-group: app/(admin)/admin/user-groups
 * → "/admin/user-groups" (convention giống roles/actions.ts — proxy rewrite clean URL
 * /user-groups → /admin/user-groups nội bộ, revalidate theo path gốc mới ăn cache).
 */
function revalidateGroupPaths(groupId?: string) {
  revalidatePath("/admin/user-groups");
  if (groupId) revalidatePath(`/admin/user-groups/${groupId}`);
}

// ─── 1. Tạo nhóm ─────────────────────────────────────────────────────────────

export async function createUserGroupAction(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("user-groups:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }

  const parsed = userGroupCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const { actorId, actorName } = getAuditActor(session);

  // Unique theo tên CHỈ giữa nhóm còn sống (partial index UserGroup_name_active_key) —
  // check trước cho lỗi thân thiện; race hiếm thì P2002 đỡ ở catch.
  const dup = await sdb.userGroup.findFirst({
    where: { name: parsed.data.name, deletedAt: null },
    select: { id: true },
  });
  if (dup) return { ok: false, error: `Nhóm "${parsed.data.name}" đã tồn tại` };

  try {
    const created = await sdb.$transaction(async (tx) => {
      const g = await tx.userGroup.create({
        data: {
          name: parsed.data.name,
          description: parsed.data.description,
          createdById: actorId,
        },
        select: { id: true, name: true },
      });
      await tx.rbacAuditLog.create({
        data: {
          entity: "GROUP",
          entityId: g.id,
          action: "CREATE",
          changedByUserId: actorId,
          changedByName: actorName,
          newValues: { name: g.name, description: parsed.data.description },
          reason: "US-03: tạo nhóm người dùng (grant ad-hoc, không sửa vai chuẩn)",
        },
      });
      return g;
    });
    revalidateGroupPaths(created.id);
    return { ok: true, id: created.id };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: `Nhóm "${parsed.data.name}" đã tồn tại` };
    }
    console.error("[user-groups] create failed:", e);
    return { ok: false, error: "Không tạo được nhóm, thử lại sau" };
  }
}

// ─── 2. Sửa tên/mô tả nhóm ───────────────────────────────────────────────────

export async function updateUserGroupAction(groupId: string, input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("user-groups:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }

  const parsed = userGroupUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const { actorId, actorName } = getAuditActor(session);

  const group = await sdb.userGroup.findFirst({
    where: { id: groupId, deletedAt: null },
    select: { id: true, name: true, description: true },
  });
  if (!group) return { ok: false, error: "Nhóm không tồn tại hoặc đã xoá" };

  const dup = await sdb.userGroup.findFirst({
    where: { name: parsed.data.name, deletedAt: null, id: { not: groupId } },
    select: { id: true },
  });
  if (dup) return { ok: false, error: `Nhóm "${parsed.data.name}" đã tồn tại` };

  try {
    await sdb.$transaction(async (tx) => {
      await tx.userGroup.update({
        where: { id: groupId },
        data: { name: parsed.data.name, description: parsed.data.description },
      });
      await tx.rbacAuditLog.create({
        data: {
          entity: "GROUP",
          entityId: groupId,
          action: "UPDATE",
          changedByUserId: actorId,
          changedByName: actorName,
          oldValues: { name: group.name, description: group.description },
          newValues: { name: parsed.data.name, description: parsed.data.description },
          reason: "US-03: sửa tên/mô tả nhóm người dùng",
        },
      });
    });
    revalidateGroupPaths(groupId);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: `Nhóm "${parsed.data.name}" đã tồn tại` };
    }
    console.error("[user-groups] update failed:", e);
    return { ok: false, error: "Không lưu được thay đổi, thử lại sau" };
  }
}

// ─── 3. Xoá nhóm (SOFT DELETE) ───────────────────────────────────────────────

export async function deleteUserGroupAction(groupId: string): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("user-groups:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const { actorId, actorName } = getAuditActor(session);

  const group = await sdb.userGroup.findFirst({
    where: { id: groupId, deletedAt: null },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  if (!group) return { ok: false, error: "Nhóm không tồn tại hoặc đã xoá" };

  try {
    await sdb.$transaction(async (tx) => {
      // SOFT DELETE — grant GROUP của nhóm GIỮ NGUYÊN trong PermissionGrant nhưng vô hiệu
      // ngay lần resolveActor kế (actor chỉ nạp membership của nhóm deletedAt null).
      await tx.userGroup.update({
        where: { id: groupId },
        data: { deletedAt: new Date() },
      });
      await tx.rbacAuditLog.create({
        data: {
          entity: "GROUP",
          entityId: groupId,
          action: "DELETE",
          changedByUserId: actorId,
          changedByName: actorName,
          oldValues: { name: group.name },
          metadata: { memberCount: group._count.members, softDelete: true },
          reason: "US-03: xoá mềm nhóm người dùng — grant nhóm vô hiệu từ request kế tiếp",
        },
      });
    });
    revalidateGroupPaths(groupId);
    return { ok: true };
  } catch (e) {
    console.error("[user-groups] delete failed:", e);
    return { ok: false, error: "Không xoá được nhóm, thử lại sau" };
  }
}

// ─── 4. Thêm thành viên (HARD row — quyền ăn ngay request kế) ────────────────

export async function addGroupMemberAction(groupId: string, input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("user-groups:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }

  const parsed = groupMemberAddSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { userId } = parsed.data;

  const sdb = scopedDb(await resolveActor(session.user.id));
  const { actorId, actorName } = getAuditActor(session);

  const group = await sdb.userGroup.findFirst({
    where: { id: groupId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!group) return { ok: false, error: "Nhóm không tồn tại hoặc đã xoá" };

  // Chỉ nhận tài khoản đang hoạt động — nhóm là công cụ cấp quyền, không phải danh bạ.
  const user = await sdb.user.findFirst({
    where: { id: userId, isActive: true, deletedAt: null },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) return { ok: false, error: "Tài khoản không tồn tại hoặc đã khoá" };

  // Chặn PARENT Ở SERVER — UI đã loại PH khỏi select ứng viên ([id]/page.tsx lọc
  // role chính ≠ PARENT), nhưng action nhận userId thô nên phải chặn lại cùng điều
  // kiện (đối xứng — groupMemberIneligibleReason có unit test pin ở validator test).
  const khongHopLe = groupMemberIneligibleReason(user);
  if (khongHopLe) return { ok: false, error: khongHopLe };

  try {
    await sdb.$transaction(async (tx) => {
      await tx.userGroupMember.create({
        data: { userId, groupId, addedById: actorId },
      });
      await tx.rbacAuditLog.create({
        data: {
          entity: "GROUP_MEMBER",
          entityId: `${groupId}:${userId}`,
          action: "ASSIGN",
          changedByUserId: actorId,
          changedByName: actorName,
          newValues: {
            groupId,
            groupName: group.name,
            userId,
            userName: user.name ?? user.email ?? userId,
          },
          reason: "US-03: thêm thành viên vào nhóm — grant nhóm ăn từ request kế tiếp",
        },
      });
    });
    revalidateGroupPaths(groupId);
    return { ok: true };
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: "Người này đã là thành viên của nhóm" };
    }
    console.error("[user-groups] addMember failed:", e);
    return { ok: false, error: "Không thêm được thành viên, thử lại sau" };
  }
}

// ─── 5. Gỡ thành viên (HARD DELETE — AC3: quyền mất ngay request kế) ─────────

export async function removeGroupMemberAction(groupId: string, userId: string): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("user-groups:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const { actorId, actorName } = getAuditActor(session);

  const member = await sdb.userGroupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
    select: {
      userId: true,
      groupId: true,
      user: { select: { name: true, email: true } },
      group: { select: { name: true } },
    },
  });
  if (!member) return { ok: false, error: "Người này không phải thành viên của nhóm" };

  try {
    await sdb.$transaction(async (tx) => {
      await tx.userGroupMember.delete({
        where: { userId_groupId: { userId, groupId } },
      });
      await tx.rbacAuditLog.create({
        data: {
          entity: "GROUP_MEMBER",
          entityId: `${groupId}:${userId}`,
          action: "REVOKE",
          changedByUserId: actorId,
          changedByName: actorName,
          oldValues: {
            groupId,
            groupName: member.group.name,
            userId,
            userName: member.user.name ?? member.user.email ?? userId,
          },
          reason:
            "US-03: gỡ thành viên khỏi nhóm — quyền từ grant nhóm mất ngay request kế tiếp (AC3)",
        },
      });
    });
    revalidateGroupPaths(groupId);
    return { ok: true };
  } catch (e) {
    console.error("[user-groups] removeMember failed:", e);
    return { ok: false, error: "Không gỡ được thành viên, thử lại sau" };
  }
}

// ─── 6. Tạo grant cho nhóm (ALLOW + DENY — SUPER_ADMIN only qua user-groups:manage) ──

export async function createGroupGrantAction(groupId: string, input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("user-groups:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }

  // Validator gánh 4 luật P0: dataScope chỉ ALL (siết 09/08 — lỗi rõ chữ), khoá quản
  // trị NON_GROUP_GRANTABLE_KEYS bị reject (chống tự-leo-thang), ALLOW ⇒ fieldMask
  // rỗng, reason bắt buộc 5..500.
  const parsed = groupGrantCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  const sdb = scopedDb(await resolveActor(session.user.id));
  const { actorId, actorName } = getAuditActor(session);

  const group = await sdb.userGroup.findFirst({
    where: { id: groupId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!group) return { ok: false, error: "Nhóm không tồn tại hoặc đã xoá" };

  // Registry DB là nguồn sự thật về permission key (US-01) — key phải tồn tại VÀ đang
  // hoạt động. FK Restrict đã chặn key lạ ở tầng DB, nhưng check trước cho lỗi rõ chữ
  // + chặn key isActive=false (FK không phân biệt được).
  const descriptor = await sdb.permissionDescriptor.findUnique({
    where: { key: data.permissionKey },
    select: { key: true, isActive: true },
  });
  if (!descriptor) {
    return { ok: false, error: `Permission key "${data.permissionKey}" không tồn tại trong registry` };
  }
  if (!descriptor.isActive) {
    return {
      ok: false,
      error: `Permission key "${data.permissionKey}" đã tắt (isActive=false) — không cấp grant mới`,
    };
  }

  try {
    const created = await sdb.$transaction(async (tx) => {
      const g = await tx.permissionGrant.create({
        data: {
          subjectType: "GROUP",
          subjectId: groupId,
          permissionKey: data.permissionKey,
          effect: data.effect,
          dataScope: data.dataScope,
          fieldMask: data.fieldMask,
          reason: data.reason,
          createdById: actorId,
        },
        select: { id: true },
      });
      await tx.rbacAuditLog.create({
        data: {
          entity: "GROUP_GRANT",
          entityId: g.id,
          action: "CREATE",
          changedByUserId: actorId,
          changedByName: actorName,
          newValues: {
            groupId,
            groupName: group.name,
            permissionKey: data.permissionKey,
            effect: data.effect,
            dataScope: data.dataScope,
            fieldMask: data.fieldMask,
          },
          reason: data.reason,
        },
      });
      return g;
    });
    revalidateGroupPaths(groupId);
    return { ok: true, id: created.id };
  } catch (e) {
    if (isUniqueViolation(e)) {
      // @@unique([subjectType, subjectId, permissionKey, effect])
      return {
        ok: false,
        error: `Nhóm đã có grant ${data.effect} cho "${data.permissionKey}" — xoá grant cũ rồi tạo lại`,
      };
    }
    console.error("[user-groups] createGrant failed:", e);
    return { ok: false, error: "Không tạo được grant, thử lại sau" };
  }
}

// ─── 7. Xoá grant của nhóm (2-click ở UI — KHÔNG sửa tại chỗ) ────────────────

export async function deleteGroupGrantAction(grantId: string): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("user-groups:manage");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }

  const sdb = scopedDb(await resolveActor(session.user.id));
  const { actorId, actorName } = getAuditActor(session);

  // Chốt subjectType GROUP ngay trong where — action này KHÔNG được đụng grant ROLE
  // (grant ROLE có màn quản trị riêng theo story sau).
  const grant = await sdb.permissionGrant.findFirst({
    where: { id: grantId, subjectType: "GROUP" },
    select: {
      id: true,
      subjectId: true,
      permissionKey: true,
      effect: true,
      dataScope: true,
      fieldMask: true,
      reason: true,
    },
  });
  if (!grant) return { ok: false, error: "Grant không tồn tại hoặc không thuộc nhóm nào" };

  try {
    await sdb.$transaction(async (tx) => {
      await tx.permissionGrant.delete({ where: { id: grantId } });
      await tx.rbacAuditLog.create({
        data: {
          entity: "GROUP_GRANT",
          entityId: grantId,
          action: "DELETE",
          changedByUserId: actorId,
          changedByName: actorName,
          oldValues: {
            groupId: grant.subjectId,
            permissionKey: grant.permissionKey,
            effect: grant.effect,
            dataScope: grant.dataScope,
            fieldMask: grant.fieldMask,
            grantReason: grant.reason,
          },
          reason: "US-03: xoá grant nhóm (xác nhận 2 bước ở UI) — hiệu lực ngay request kế tiếp",
        },
      });
    });
    revalidateGroupPaths(grant.subjectId);
    return { ok: true };
  } catch (e) {
    console.error("[user-groups] deleteGrant failed:", e);
    return { ok: false, error: "Không xoá được grant, thử lại sau" };
  }
}
