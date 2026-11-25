import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { syncConversationMembership } from "@/lib/chat/sync-membership";

// =============================================================================
// R7-07 (PR1) — Gán học viên vào lớp.
//
// Dropdown lọc đúng rule §15.1 (5 điều kiện):
//   1) đúng khóa  (Enrollment.courseId = class.courseId)
//   2) đúng cơ sở (qua student.centerId — Enrollment KHÔNG có centerId)
//   3) trạng thái hợp lệ CONFIRMED/PENDING (⇒ loại PAUSED + terminal)
//   4) chưa thuộc lớp này
//   5) HS chưa "đang học" lớp active nào của khóa (chưa có enrollment STUDYING)
//
// Hậu-gán (tx): Enrollment.status = STUDYING ("Đã xếp lớp") + classId = lớp đích
// + EnrollmentAuditLog; sau commit phát DomainEvent `enrollment.assigned`
// (idempotent theo enrollment×class) → handler sinh tiến độ/lịch portal + notify PH.
// Center isolation: server action xác minh lớp ∈ scope actor TRƯỚC khi gọi.
// =============================================================================

/** Trạng thái enrollment đủ điều kiện để gán (≠ PAUSED, ≠ STUDYING, ≠ terminal). */
export const ASSIGNABLE_ENROLLMENT_STATUSES = ["CONFIRMED", "PENDING"] as const;

/** Trạng thái tính vào sức chứa lớp (đồng bộ với enrollments/_actions.ts). */
export const CAPACITY_COUNT_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "STUDYING",
  "ACTIVE",
] as const;

type ClassLite = { id: string; courseId: string; centerId: string | null };

/** PURE — điều kiện lọc enrollment đủ điều kiện gán vào `cls` (test được). */
export function buildAssignableWhere(cls: ClassLite): Prisma.EnrollmentWhereInput {
  const student: Prisma.StudentWhereInput = {
    deletedAt: null,
    // (5) chưa đang học lớp active nào của CHÍNH khóa này.
    enrollments: { none: { status: "STUDYING", courseId: cls.courseId } },
  };
  // (2) đúng cơ sở. Bản cũ chỉ ràng buộc KHI lớp có cơ sở ⇒ lớp chưa gán cơ sở thì
  // danh sách gán được hiện học viên của MỌI cơ sở. Nay lớp buộc phải có cơ sở
  // (04/08), nên lớp thiếu cơ sở = dữ liệu hỏng → không gán được ai, chứ không mở toang.
  student.centerId = cls.centerId ?? "__LOP_CHUA_GAN_CO_SO__";

  return {
    courseId: cls.courseId, // (1)
    status: { in: [...ASSIGNABLE_ENROLLMENT_STATUSES] }, // (3)
    classId: { not: cls.id }, // (4)
    student,
  };
}

/** PURE — kết quả kiểm tra sức chứa (test được). */
export function computeCapacityOutcome(
  current: number,
  toAdd: number,
  max: number,
): { total: number; exceeds: boolean } {
  const total = current + toAdd;
  return { total, exceeds: total > max };
}

export type AssignResult = {
  ok: boolean;
  assigned?: number;
  skipped?: number;
  error?: string;
  /** true → vượt sức chứa, cần quyền override (UI bật xác nhận). */
  needsOverride?: boolean;
  capacity?: { current: number; toAdd: number; max: number };
};

/**
 * Gán danh sách enrollment vào lớp. Vượt sức chứa + !override → trả needsOverride
 * (KHÔNG ghi gì). Mỗi enrollment gán trong 1 tx riêng (cô lập đụng độ unique
 * studentId×classId → bỏ qua enrollment đó, không hỏng cả lô). Idempotent.
 */
export async function assignEnrollments(opts: {
  classId: string;
  enrollmentIds: string[];
  override: boolean;
  actorId: string | null;
  actorName: string;
  now?: Date;
}): Promise<AssignResult> {
  const now = opts.now ?? new Date();
  const ids = [...new Set(opts.enrollmentIds)].filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "Chưa chọn học viên nào" };

  const cls = await db.class.findFirst({
    where: { id: opts.classId, deletedAt: null },
    select: { id: true, courseId: true, maxStudents: true, status: true },
  });
  if (!cls) return { ok: false, error: "Không tìm thấy lớp" };
  if (cls.status === "CANCELLED" || cls.status === "COMPLETED") {
    return { ok: false, error: `Lớp đang ${cls.status} — không thể gán học viên` };
  }

  // Re-validate đúng khóa + trạng thái hợp lệ (chống race: enrollment đổi state
  // giữa lúc mở dropdown và bấm gán).
  const candidates = await db.enrollment.findMany({
    where: {
      id: { in: ids },
      courseId: cls.courseId,
      status: { in: [...ASSIGNABLE_ENROLLMENT_STATUSES] },
    },
    select: { id: true, studentId: true, status: true, classId: true },
  });
  if (candidates.length === 0) {
    return { ok: false, error: "Không có enrollment hợp lệ để gán" };
  }

  const candidateIds = candidates.map((c) => c.id);
  // Sức chứa hiện tại (KHÔNG đếm các candidate đã nằm sẵn trong lớp → tránh đếm đôi).
  const current = await db.enrollment.count({
    where: {
      classId: cls.id,
      status: { in: [...CAPACITY_COUNT_STATUSES] },
      id: { notIn: candidateIds },
    },
  });
  const cap = computeCapacityOutcome(current, candidates.length, cls.maxStudents);
  if (cap.exceeds && !opts.override) {
    return {
      ok: false,
      needsOverride: true,
      error: `Vượt sức chứa lớp (${cap.total}/${cls.maxStudents}). Cần quyền override để thêm.`,
      capacity: { current, toAdd: candidates.length, max: cls.maxStudents },
    };
  }

  let assigned = 0;
  let skipped = 0;
  for (const enr of candidates) {
    // Lưu ý: KHÔNG áp canTransition ở đây. "Gán vào lớp" là thao tác GỘP
    // (xác nhận + xếp lớp + bắt đầu học) — candidates đã lọc sẵn {CONFIRMED, PENDING}
    // nên chính filter là guard. PENDING→STUDYING là hợp lệ cho thao tác gán
    // (khác status-change đơn ở changeEnrollmentStatus, nơi guard mới áp dụng).
    try {
      await db.$transaction(async (tx) => {
        await tx.enrollment.update({
          where: { id: enr.id },
          data: { classId: cls.id, status: "STUDYING", startedAt: now },
        });
        await tx.enrollmentAuditLog.create({
          data: {
            enrollmentId: enr.id,
            fromStatus: enr.status,
            toStatus: "STUDYING",
            changedByUserId: opts.actorId,
            changedByName: opts.actorName,
            reason: cap.exceeds ? "Gán vào lớp (override sức chứa)" : "Gán vào lớp",
            extraData: {
              sourceClassId: enr.classId,
              targetClassId: cls.id,
              override: cap.exceeds,
            },
          },
        });
        // Side-effect không-atomic (tiến độ + notify) → DomainEvent, idempotent.
        await publishEvent(
          "enrollment.assigned",
          { enrollmentId: enr.id, classId: cls.id, studentId: enr.studentId },
          { tx, dedupeKey: `enrollment.assigned:${enr.id}:${cls.id}` },
        );
        // US-03 chat — gán vào lớp: PH vào nhóm lớp đích; enrollment CONFIRMED trước
        // đó có thể đang trỏ lớp khác → sync cả lớp nguồn (PH rời nếu hết con ở đó).
        await syncConversationMembership(tx, cls.id);
        if (enr.classId && enr.classId !== cls.id) {
          await syncConversationMembership(tx, enr.classId);
        }
      }, { timeout: 30_000, maxWait: 10_000 });
      assigned += 1;
    } catch {
      // Đụng độ partial unique (studentId, classId) WHERE deletedAt IS NULL
      // hoặc lỗi đơn lẻ → bỏ qua enrollment này.
      skipped += 1;
    }
  }

  // AC2 — override sức chứa phải để lại vết audit.
  if (cap.exceeds) {
    await writeAudit({
      actor: { id: opts.actorId, name: opts.actorName },
      module: "classes",
      entityType: "Class",
      entityId: cls.id,
      action: "ASSIGN_OVERRIDE_CAPACITY",
      newValues: { assigned, total: cap.total, max: cls.maxStudents },
      reason: "Override sức chứa khi gán học viên",
    });
  }

  return {
    ok: true,
    assigned,
    skipped,
    capacity: { current, toAdd: candidates.length, max: cls.maxStudents },
  };
}

/**
 * "Thêm toàn bộ" theo bộ lọc: tự liệt kê enrollment đủ điều kiện của lớp rồi gán.
 * Center isolation do server action gác (lớp ∈ scope actor) trước khi gọi.
 */
export async function assignAllFiltered(opts: {
  classId: string;
  override: boolean;
  actorId: string | null;
  actorName: string;
  now?: Date;
}): Promise<AssignResult> {
  const cls = await db.class.findFirst({
    where: { id: opts.classId, deletedAt: null },
    select: { id: true, courseId: true, centerId: true },
  });
  if (!cls) return { ok: false, error: "Không tìm thấy lớp" };

  const list = await db.enrollment.findMany({
    where: buildAssignableWhere(cls),
    select: { id: true },
  });
  if (list.length === 0) return { ok: false, error: "Không có học viên nào đủ điều kiện" };

  return assignEnrollments({
    classId: opts.classId,
    enrollmentIds: list.map((e) => e.id),
    override: opts.override,
    actorId: opts.actorId,
    actorName: opts.actorName,
    now: opts.now,
  });
}
