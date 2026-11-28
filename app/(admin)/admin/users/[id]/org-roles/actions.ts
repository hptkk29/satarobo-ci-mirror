"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import {
  RbacError,
  assignUserOrgRole,
  revokeUserOrgRole,
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

export async function assignUserOrgRoleAction(input: unknown): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Chưa đăng nhập" };
  try {
    const a = await assignUserOrgRole(actor, input);
    revalidatePath(`/admin/users/${a.userId}/org-roles`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

export async function revokeUserOrgRoleAction(input: unknown): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Chưa đăng nhập" };
  try {
    const a = await revokeUserOrgRole(actor, input);
    revalidatePath(`/admin/users/${a.userId}/org-roles`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}
