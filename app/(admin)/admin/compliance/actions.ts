"use server";

import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { isSuperAdmin } from "@/lib/auth/permissions";
import { getAuditActor } from "@/lib/audit/log";
import { applyStudentErasure } from "@/lib/compliance/erasure";
import { exportStudentData } from "@/lib/compliance/portability";

// C6/NĐ13 — chỉ SUPER_ADMIN được xoá (ẩn danh) / xuất dữ liệu cá nhân học viên.
export async function eraseStudentAction(
  studentId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!isSuperAdmin(session.user.role)) {
    return { ok: false, error: "Chỉ SUPER_ADMIN được xoá dữ liệu cá nhân" };
  }
  if (!reason?.trim() || reason.trim().length < 5) {
    return { ok: false, error: "Lý do xoá là bắt buộc (≥ 5 ký tự)" };
  }
  const { actorId, actorName } = getAuditActor(session);
  const res = await applyStudentErasure(studentId, { id: actorId, name: actorName }, reason.trim());
  if (res.ok) revalidatePath("/admin/compliance");
  return res;
}

export async function exportStudentAction(
  studentId: string,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!isSuperAdmin(session.user.role)) {
    return { ok: false, error: "Chỉ SUPER_ADMIN được xuất dữ liệu cá nhân" };
  }
  const data = await exportStudentData(studentId);
  if (!data) return { ok: false, error: "Không tìm thấy học viên" };
  return { ok: true, data };
}
