// lib/auth/lms-scope.ts — P2/LMS-1..4: owner-scope dùng lại cho các action LMS
// thao tác theo LỚP (điểm danh, chấm bài, hoàn tất buổi...).
//
// Quy tắc (khớp mẫu chuẩn assignSessionHomeworkAction):
//   1) cách ly cơ sở: lớp phải thuộc cơ sở actor nhìn thấy (passesScope "Class");
//   2) ownership: quản lý cùng cơ sở (SUPER_ADMIN/HO/CENTER_MANAGER) HOẶC
//      GV/trợ giảng phụ trách đúng lớp đó (assignedClassIds).
//
// KHÔNG phụ thuộc việc bật RBAC v2 — chạy được ngay với actor đã resolve.
import { passesScope } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";

/** Actor là quản lý (xuyên lớp trong phạm vi cơ sở) chứ không chỉ GV 1 lớp. */
export function isManagerActor(actor: Actor): boolean {
  return (
    actor.isSuperAdmin ||
    actor.isHoLevel ||
    actor.orgRoles.some((r) => r.roleCode === "CENTER_MANAGER")
  );
}

/**
 * Actor được thao tác (sửa/xóa) dữ liệu thuộc lớp `classId` không?
 * - false nếu lớp ngoài cơ sở actor (cách ly cơ sở), hoặc
 * - actor không phải quản lý VÀ không phụ trách lớp.
 */
export function canManageClass(
  actor: Actor,
  classId: string,
  classCenterId: string | null,
): boolean {
  if (!passesScope("Class", { centerId: classCenterId }, actor)) return false;
  return isManagerActor(actor) || actor.assignedClassIds.has(classId);
}

/**
 * LMS-15 — staff được truy cập dữ liệu/HV này không (cho nhắn tin):
 * quản lý cùng cơ sở HV, HOẶC GV/trợ giảng dạy 1 trong các lớp của HV.
 */
export function canStaffAccessStudent(
  actor: Actor,
  opts: { studentCenterId: string | null; studentClassIds: string[] },
): boolean {
  if (actor.isSuperAdmin || actor.isHoLevel) return true;
  if (isManagerActor(actor)) {
    return !!opts.studentCenterId && actor.visibleCenterIds.includes(opts.studentCenterId);
  }
  return opts.studentClassIds.some((c) => actor.assignedClassIds.has(c));
}

/**
 * LMS-2 — actor được chấm 1 bài làm/bài thi không?
 * - Có lớp (assignment.classId / exam.classId): theo canManageClass.
 * - Không có lớp (exam ngân hàng dùng chung): chỉ quản lý cùng cơ sở của HV.
 */
export function canGradeForClass(
  actor: Actor,
  opts: { classId: string | null; classCenterId: string | null; studentCenterId?: string | null },
): boolean {
  if (opts.classId) return canManageClass(actor, opts.classId, opts.classCenterId);
  return (
    isManagerActor(actor) &&
    passesScope("Student", { centerId: opts.studentCenterId ?? null }, actor)
  );
}
