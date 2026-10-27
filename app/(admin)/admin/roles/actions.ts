"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import {
  RbacError,
  createRole,
  updateRole,
  deleteRole,
  setRolePermissions,
  setRoleAnMenu,
  type RbacActor,
} from "@/lib/auth/rbac-service";

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function getActor(): Promise<RbacActor | null> {
  const session = await auth();
  if (!session?.user) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? session.user.email ?? session.user.id,
    role: session.user.role,
    roles: session.user.roles,
    grants: session.user.grants,
  };
}

function toError(e: unknown): string {
  if (e instanceof RbacError) return e.message;
  if (e instanceof ZodError) return e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
  return "Có lỗi xảy ra";
}

export async function createRoleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Chưa đăng nhập" };
  try {
    const role = await createRole(actor, input);
    revalidatePath("/admin/roles");
    return { ok: true, data: { id: role.id } };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function updateRoleAction(roleId: string, input: unknown): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await updateRole(actor, roleId, input);
    revalidatePath("/admin/roles");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function deleteRoleAction(roleId: string, reason: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await deleteRole(actor, roleId, reason);
    revalidatePath("/admin/roles");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function setRolePermissionsAction(
  roleId: string,
  input: unknown,
): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await setRolePermissions(actor, roleId, input);
    revalidatePath("/admin/roles");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

/** Menu gọn theo vai — chỉ gọn menu, KHÔNG đổi quyền (`lib/auth/menu-gon.ts`). */
export async function setRoleAnMenuAction(roleId: string, input: unknown): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await setRoleAnMenu(actor, roleId, input);
    revalidatePath("/admin/roles");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}
