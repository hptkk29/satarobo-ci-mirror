"use server";

// R7-07 (PR1) — gán học viên vào lớp: server-action mỏng (auth + can + scope cơ sở).
// Logic nghiệp vụ ở lib/lms/assign.ts. Override sức chứa cần quyền cao hơn
// (classes:create — SUPER_ADMIN/CENTER_MANAGER) + audit (ghi trong lib).
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import {
  assignEnrollments,
  assignAllFiltered,
  type AssignResult,
} from "@/lib/lms/assign";
import {
  REMOVABLE_ENROLLMENT_STATUSES,
  removalTargetStatus,
} from "@/lib/students/remove-from-classes";
import {
  decideRemovalOutcome,
  describeRemovalOutcome,
  type RemovalOutcome,
} from "@/lib/lms/remove-from-class";
import { transferEnrollment } from "@/app/(admin)/admin/enrollments/_actions";
import { deleteStudent } from "@/app/(admin)/admin/students/_actions";

type Gate = { actor: Actor; actorId: string | null; actorName: string };

async function gate(): Promise<
  { ok: true; gate: Gate } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("classes:edit"))) {
    return { ok: false, error: "Không có quyền gán học viên" };
  }
  const actor = await resolveActor(session.user.id);
  const { actorId, actorName } = getAuditActor(session);
  return { ok: true, gate: { actor, actorId, actorName } };
}

/** Lớp ∈ cơ sở của actor? (scopedDb lọc + passesScope phòng vệ). */
async function assertClassInScope(
  actor: Actor,
  classId: string,
): Promise<boolean> {
  const sdb = scopedDb(actor);
  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { id: true, centerId: true },
  });
  return Boolean(cls) && passesScope("Class", { centerId: cls?.centerId ?? null }, actor);
}

async function canOverrideCapacity(): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  return checkPermission("classes:create");
}

/** Gán danh sách enrollment đã chọn vào lớp. */
export async function assignSelectedAction(
  classId: string,
  enrollmentIds: string[],
  override = false,
): Promise<AssignResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (!(await assertClassInScope(g.gate.actor, classId))) {
    return { ok: false, error: "Lớp không thuộc cơ sở bạn quản lý" };
  }
  if (override && !(await canOverrideCapacity())) {
    return { ok: false, error: "Không có quyền override sức chứa" };
  }

  const res = await assignEnrollments({
    classId,
    enrollmentIds,
    override,
    actorId: g.gate.actorId,
    actorName: g.gate.actorName,
  });

  if (res.ok) {
    revalidatePath(`/classes/${classId}/students`);
    revalidatePath(`/classes/${classId}/edit`);
    revalidatePath("/enrollments");
  }
  return res;
}

/** "Thêm toàn bộ" theo bộ lọc đủ điều kiện. */
export async function assignAllFilteredAction(
  classId: string,
  override = false,
): Promise<AssignResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (!(await assertClassInScope(g.gate.actor, classId))) {
    return { ok: false, error: "Lớp không thuộc cơ sở bạn quản lý" };
  }
  if (override && !(await canOverrideCapacity())) {
    return { ok: false, error: "Không có quyền override sức chứa" };
  }

  const res = await assignAllFiltered({
    classId,
    override,
    actorId: g.gate.actorId,
    actorName: g.gate.actorName,
  });

  if (res.ok) {
    revalidatePath(`/classes/${classId}/students`);
    revalidatePath(`/classes/${classId}/edit`);
    revalidatePath("/enrollments");
  }
  return res;
}

/**
 * T3.2 — gán / đổi SALE PHỤ TRÁCH của 1 ghi danh trong lớp.
 * Cách ly cơ sở 2 chiều: (1) lớp phải trong tầm nhìn actor, (2) sale được gán phải
 * CÙNG cơ sở với lớp (chống gán chéo CS1↔CS2 bằng POST tay). `saleId = null` = gỡ.
 */
export async function setEnrollmentSaleAction(
  classId: string,
  enrollmentId: string,
  saleId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (!(await assertClassInScope(g.gate.actor, classId))) {
    return { ok: false, error: "Lớp không thuộc cơ sở bạn quản lý" };
  }

  const sdb = scopedDb(g.gate.actor);
  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { centerId: true },
  });
  if (!cls) return { ok: false, error: "Lớp không tồn tại" };

  if (saleId) {
    const sale = await sdb.user.findUnique({
      where: { id: saleId },
      select: { id: true, centerId: true, deletedAt: true },
    });
    if (!sale || sale.deletedAt) return { ok: false, error: "Không tìm thấy nhân sự này" };
    // Lớp có cơ sở → sale phải cùng cơ sở. Lớp HO (centerId null) → không ràng buộc.
    if (cls.centerId && sale.centerId !== cls.centerId) {
      return { ok: false, error: "Sale phụ trách phải thuộc cùng cơ sở với lớp" };
    }
  }

  const res = await sdb.enrollment.updateMany({
    where: { id: enrollmentId, classId },
    data: { saleId },
  });
  if (res.count === 0) return { ok: false, error: "Ghi danh không thuộc lớp này" };

  revalidatePath(`/classes/${classId}/students`);
  return { ok: true };
}

/**
 * (a) PA-B 22/07 — nút gộp "Chuyển sang Đang học": các ghi danh ĐÃ XẾP (CONFIRMED)
 * được tick chọn chuyển hàng loạt sang STUDYING (bỏ tick em chưa đóng đủ tiền).
 * KHÔNG tự động khi duyệt lớp (quyết định PA-B): giữ bước kiểm soát của giáo vụ.
 */
export async function promoteConfirmedAction(
  classId: string,
  enrollmentIds: string[],
): Promise<{ ok: boolean; promoted?: number; error?: string }> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  if (!(await assertClassInScope(g.gate.actor, classId))) {
    return { ok: false, error: "Lớp không thuộc cơ sở bạn quản lý" };
  }
  const ids = [...new Set(enrollmentIds)].filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "Chưa chọn học viên nào" };

  const sdb = scopedDb(g.gate.actor);
  // Chỉ CONFIRMED của ĐÚNG lớp này → STUDYING (id lạ / trạng thái khác bị lọc im lặng).
  const res = await sdb.enrollment.updateMany({
    where: { id: { in: ids }, classId, status: "CONFIRMED" },
    data: { status: "STUDYING" },
  });
  // Mốc bắt đầu học: chỉ đặt cho em chưa có (không ghi đè lịch sử).
  await sdb.enrollment.updateMany({
    where: { id: { in: ids }, classId, status: "STUDYING", startedAt: null },
    data: { startedAt: new Date() },
  });

  if (res.count > 0) {
    revalidatePath(`/classes/${classId}/students`);
    revalidatePath(`/classes/${classId}/edit`);
    revalidatePath("/enrollments");
  }
  return { ok: true, promoted: res.count };
}

// ═══════════════════════════════════════════════════════════════════════════
// 21/08/2026 — Gỡ / chuyển học viên ngay trên roster lớp.
//
// Ba nút, ba mức quyền KHÁC NHAU (đừng gộp vào `classes:edit` của phần gán):
//   • "Chuyển lớp"   → enrollments:transfer  (giữ nguyên ghi danh + sổ sách, dời lớp)
//   • "Xoá khỏi lớp" → enrollments:cancel    (kết thúc ghi danh ở lớp NÀY)
//   • "Nghỉ hẳn"     → students:delete       (xoá học viên khỏi hệ thống, giữ dấu vết CRM)
//
// ⚠️ TIỀN TỐ `/admin` trong revalidatePath: URL sạch `admin.satarobo.vn/classes/…` chỉ là
// vỏ — proxy rewrite nội bộ sang `/admin` + pathname (`lib/auth/route-policy.ts:622`), nên
// route Next thật là `/admin/classes/…`. Các dòng `revalidatePath("/classes/…")` phía trên
// file này không khớp route nào (vô hại vì roster `force-dynamic`) — đừng chép theo.
// ═══════════════════════════════════════════════════════════════════════════

/** Làm mới mọi màn đọc roster của lớp sau khi sĩ số đổi. */
function revalidateClassRoster(classId: string): void {
  revalidatePath(`/admin/classes/${classId}/students`);
  revalidatePath(`/admin/classes/${classId}`);
  revalidatePath("/admin/classes");
  revalidatePath("/admin/enrollments");
  revalidatePath("/admin/students");
}

export type RemoveFromClassResult = {
  ok: boolean;
  error?: string;
  /** Kết cục để UI quyết định có mở nút "Nghỉ hẳn" hay không. */
  outcome?: RemovalOutcome;
  message?: string;
  studentId?: string;
  studentName?: string;
  otherLiveClassCount?: number;
};

/**
 * Gỡ 1 học viên khỏi lớp này. Ghi danh chuyển sang trạng thái kết thúc
 * (`removalTargetStatus`: PENDING→CANCELLED, còn lại→WITHDREW) — KHÔNG set
 * `Enrollment.deletedAt` (đó là soft-delete TÀI CHÍNH, sẽ rút khoản phải thu khỏi công
 * nợ — xem đầu `lib/students/remove-from-classes.ts`).
 *
 * KHÔNG tạo yêu cầu hoàn tiền: gỡ khỏi lớp ≠ nghỉ học. Học viên nghỉ hẳn thì đi
 * `withdrawStudentAction` (nút "❌ Nghỉ học hẳn" ở hồ sơ học viên) — đường đó mới sinh
 * yêu cầu hoàn tiền và gửi email cho phụ huynh.
 */
export async function removeFromClassAction(
  classId: string,
  enrollmentId: string,
  reason: string,
): Promise<RemoveFromClassResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("enrollments:cancel"))) {
    return { ok: false, error: "Không có quyền gỡ học viên khỏi lớp" };
  }
  const trimmed = reason.trim();
  if (trimmed.length < 5) {
    return { ok: false, error: "Lý do phải có ít nhất 5 ký tự" };
  }
  if (trimmed.length > 1000) return { ok: false, error: "Lý do quá dài" };

  const actor = await resolveActor(session.user.id);
  const { actorId, actorName } = getAuditActor(session);
  if (!(await assertClassInScope(actor, classId))) {
    return { ok: false, error: "Lớp không thuộc cơ sở bạn quản lý" };
  }

  const sdb = scopedDb(actor);
  const enr = await sdb.enrollment.findFirst({
    where: { id: enrollmentId, classId, deletedAt: null },
    select: {
      id: true,
      status: true,
      centerId: true,
      studentId: true,
      student: { select: { name: true, status: true, centerId: true } },
    },
  });
  if (!enr || !enr.student) return { ok: false, error: "Ghi danh không thuộc lớp này" };
  // scopedDb KHÔNG che WRITE — tự gác cách ly cơ sở trên chính bản ghi sắp sửa.
  if (!passesScope("Enrollment", { centerId: enr.centerId }, actor)) {
    return { ok: false, error: "Ghi danh không thuộc cơ sở bạn quản lý" };
  }
  if (!REMOVABLE_ENROLLMENT_STATUSES.includes(enr.status)) {
    return { ok: false, error: `Ghi danh đã kết thúc (${enr.status}) — không cần gỡ` };
  }

  const toStatus = removalTargetStatus(enr.status);
  const auditReason = `Gỡ khỏi lớp: ${trimmed}`;
  let otherLiveClassCount = 0;

  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;

    await tx.enrollment.update({
      where: { id: enr.id },
      data: { status: toStatus, endedAt: new Date() },
    });
    await tx.enrollmentAuditLog.create({
      data: {
        enrollmentId: enr.id,
        fromStatus: enr.status,
        toStatus,
        changedByUserId: actorId,
        changedByName: actorName,
        reason: auditReason,
        extraData: { sourceClassId: classId },
      },
    });
    await writeAudit({
      actor: { id: actorId, name: actorName },
      module: "classes",
      entityType: "Enrollment",
      entityId: enr.id,
      action: "STATUS_CHANGE",
      oldValues: { status: enr.status },
      newValues: { status: toStatus },
      changedFields: ["status"],
      reason: auditReason,
      orgUnitId: enr.centerId,
      tx,
    });
    // US-03 chat — phụ huynh rời nhóm lớp nếu không còn con nào trong lớp, cùng tx.
    await syncConversationMembership(tx, classId);

    // "Check kỹ": ĐẾM LẠI trong cùng transaction, không suy từ dữ liệu đọc trước đó.
    otherLiveClassCount = await tx.enrollment.count({
      where: {
        studentId: enr.studentId,
        id: { not: enr.id },
        status: { in: REMOVABLE_ENROLLMENT_STATUSES },
        deletedAt: null,
      },
    });
  }, { timeout: 30_000, maxWait: 10_000 });

  revalidateClassRoster(classId);

  const outcome = decideRemovalOutcome({
    studentStatus: enr.student.status,
    otherLiveClassCount,
  });
  return {
    ok: true,
    outcome,
    message: describeRemovalOutcome(outcome, enr.student.name, otherLiveClassCount),
    studentId: enr.studentId,
    studentName: enr.student.name,
    otherLiveClassCount,
  };
}

/**
 * Chuyển học viên sang lớp khác NGAY TRÊN roster. Bọc mỏng `transferEnrollment`
 * (đường chuyển lớp chuẩn: giữ ghi danh cũ ở trạng thái TRANSFERRED + trỏ
 * `transferredToId`, tạo ghi danh mới CONFIRMED ở lớp đích, kiểm sức chứa trong
 * transaction Serializable, ghi 4 bản ghi audit, sync chat cả hai nhóm).
 * Hàm gốc tự gác `enrollments:transfer` + cách ly cơ sở hai đầu.
 */
export async function transferFromClassAction(
  classId: string,
  enrollmentId: string,
  targetClassId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string; newEnrollmentId?: string }> {
  const res = await transferEnrollment({
    enrollmentId,
    targetClassId,
    reason: reason.trim(),
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidateClassRoster(classId);
  revalidateClassRoster(targetClassId);
  return { ok: true, newEnrollmentId: res.data?.newEnrollmentId };
}

/**
 * "Nghỉ hẳn" — xoá học viên khỏi hệ thống sau khi đã gỡ hết lớp.
 *
 * Đi qua `deleteStudent` (xoá MỀM `Student.deletedAt` + dọn nốt ghi danh còn sót +
 * audit), nên các guard của nó vẫn nguyên: chỉ SUPER_ADMIN/CENTER_MANAGER, chỉ học viên
 * đã ở trạng thái Nghỉ học, chỉ trong tầm nhìn cơ sở của người thao tác.
 *
 * Dấu vết KHÔNG mất: hồ sơ `Lead` của gia đình không bị đụng tới, `Student` chỉ xoá mềm,
 * và `deleteStudent` chốt `StudentCenterHistory` để cơ sở khác tra ra "khách này đã từng
 * đăng ký ở đâu" (xem `lib/students/prior-history.ts`).
 */
export async function withdrawFromSystemAction(
  classId: string,
  studentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  // Kiểm quyền TRƯỚC: `deleteStudent` từ chối bằng `redirect("/dashboard?error=unauthorized")`
  // (ném NEXT_REDIRECT), tức người dùng bị đá khỏi trang thay vì thấy báo lỗi tại chỗ.
  if (!(await checkPermission("students:delete"))) {
    return { ok: false, error: "Không có quyền xoá học viên khỏi hệ thống" };
  }

  const res = await deleteStudent(studentId);
  if (res.error) return { ok: false, error: res.error };

  revalidateClassRoster(classId);
  return { ok: true };
}
