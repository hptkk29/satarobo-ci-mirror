"use server";

// R7-07 (PR2) — "Hoàn tất buổi": server-action mỏng (auth + can + scope cơ sở).
// Logic ở lib/lms/session-lifecycle.ts. Gác sau flag SESSION_LIFECYCLE_V2 ở UI.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { isSessionLifecycleV2Enabled } from "@/lib/flags";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { completeSession, type CompleteSessionResult } from "@/lib/lms/session-lifecycle";
import { assignHomeworkForSession } from "@/lib/lms/assignment";

/** Buổi ∈ cơ sở actor? (qua lớp chứa nó). */
async function resolveSessionScope(
  actor: Actor,
  sessionId: string,
): Promise<{ ok: true; classId: string } | { ok: false; error: string }> {
  const sdb = scopedDb(actor);
  const s = await sdb.classSession.findUnique({
    where: { id: sessionId },
    select: { classId: true, class: { select: { centerId: true } } },
  });
  if (!s) return { ok: false, error: "Không tìm thấy buổi học" };
  if (!passesScope("Class", { centerId: s.class?.centerId ?? null }, actor)) {
    return { ok: false, error: "Lớp không thuộc cơ sở bạn quản lý" };
  }
  return { ok: true, classId: s.classId };
}

export async function completeSessionAction(
  sessionId: string,
  input: {
    actualTeacherId?: string | null;
    actualRoomId?: string | null;
    actualStartAt?: string | null;
    actualEndAt?: string | null;
    classComment?: string | null;
    confirmNoAttendance?: boolean;
    // R7-14 — cách giao bài kèm khi hoàn tất buổi.
    assignMode?: "NOW" | "DEFER" | "CUSTOM_DUE";
    assignDueAt?: string | null;
  },
): Promise<CompleteSessionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  // Gác flag SERVER-SIDE (không chỉ ẩn UI): khi OFF, dùng checklist 9 mục cũ.
  // Chặn cả POST trực tiếp vào action khi flag chưa bật.
  if (!isSessionLifecycleV2Enabled()) {
    return { ok: false, error: "Tính năng hoàn tất buổi (v2) chưa được bật" };
  }
  // GV phụ trách hoặc quản lý đều có thể đóng buổi → dùng sessions:edit.
  if (!(await checkPermission("sessions:edit"))) {
    return { ok: false, error: "Không có quyền hoàn tất buổi" };
  }

  const actor = await resolveActor(session.user.id);
  const sc = await resolveSessionScope(actor, sessionId);
  if (!sc.ok) return { ok: false, error: sc.error };

  // Ownership: chỉ GV/trợ giảng của ĐÚNG lớp này, hoặc quản lý/SUPER_ADMIN/HO
  // mới được hoàn tất buổi — GV lớp khác KHÔNG đóng được (nhất quán với
  // assignSessionHomeworkAction).
  const isManager =
    actor.isSuperAdmin ||
    actor.isHoLevel ||
    actor.orgRoles.some((r) => r.roleCode === "CENTER_MANAGER");
  const ownsClass = actor.assignedClassIds.has(sc.classId);
  if (!isManager && !ownsClass) {
    return { ok: false, error: "Chỉ giáo viên phụ trách mới hoàn tất được buổi này" };
  }

  const { actorId, actorName } = getAuditActor(session);

  const toDate = (v: string | null | undefined): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const res = await completeSession({
    sessionId,
    actualTeacherId: input.actualTeacherId ?? null,
    actualRoomId: input.actualRoomId ?? null,
    actualStartAt: toDate(input.actualStartAt),
    actualEndAt: toDate(input.actualEndAt),
    classComment: input.classComment ?? null,
    confirmNoAttendance: input.confirmNoAttendance ?? false,
    assignMode: input.assignMode ?? "NOW",
    nguonChot: "TAY", // màn quản trị — có người bấm
    assignDueAt: toDate(input.assignDueAt),
    actorId,
    actorName,
  });

  if (res.ok) {
    revalidatePath(`/classes/${sc.classId}/edit`);
    revalidatePath("/sessions");
  }
  return res;
}

/**
 * R7-14 — Giao bài thủ công cho buổi đã hoàn tất (khi GV chọn DEFER lúc hoàn tất).
 * Gác: sessions:edit + đúng GV/trợ giảng của lớp (hoặc quản lý cơ sở) — GV lớp
 * khác KHÔNG bấm được (AC3). Idempotent qua assignHomeworkForSession.
 */
export async function assignSessionHomeworkAction(
  sessionId: string,
  input: { dueAt?: string | null },
): Promise<{ ok: boolean; error?: string; created?: number }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("sessions:edit"))) {
    return { ok: false, error: "Không có quyền giao bài" };
  }

  const actor = await resolveActor(session.user.id);
  const sc = await resolveSessionScope(actor, sessionId);
  if (!sc.ok) return { ok: false, error: sc.error };

  // Ownership (AC3): GV/trợ giảng của ĐÚNG lớp này, hoặc quản lý/SUPER_ADMIN/HO.
  const isManager =
    actor.isSuperAdmin ||
    actor.isHoLevel ||
    actor.orgRoles.some((r) => r.roleCode === "CENTER_MANAGER");
  const ownsClass = actor.assignedClassIds.has(sc.classId);
  if (!isManager && !ownsClass) {
    return { ok: false, error: "Chỉ giáo viên phụ trách lớp này mới giao được bài" };
  }

  const toDate = (v: string | null | undefined): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const customDueAt = toDate(input.dueAt);

  const { actorId, actorName } = getAuditActor(session);
  const result = await assignHomeworkForSession({
    sessionId,
    assignMode: customDueAt ? "CUSTOM_DUE" : "NOW",
    customDueAt,
    assignedById: actorId,
  });

  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "classes",
    entityType: "ClassSession",
    entityId: sessionId,
    action: "ASSIGN_HOMEWORK",
    newValues: {
      assignMode: customDueAt ? "CUSTOM_DUE" : "NOW",
      created: result.created,
      examCount: result.examCount,
      studentCount: result.studentCount,
    },
  });

  revalidatePath(`/classes/${sc.classId}/edit`);
  if (result.skipped && result.examCount === 0) {
    return { ok: true, created: 0, error: "Buổi này không có bài kiểm tra (exam) gắn để giao" };
  }
  return { ok: true, created: result.created };
}
