import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { isSameFeeTransfer } from "@/lib/transfer/transfer-policy";
import { syncConversationMembership } from "@/lib/chat/sync-membership";

// =============================================================================
// Cụm C1 — Chuyển lớp / chuyển cơ sở.
// Quy tắc: lớp đích cùng KHOÁ; KHÔNG cho học vượt buổi (tiến độ lớp đích không
// được vượt tiến độ hiện tại của học viên) → tránh bỏ lỡ bài. Hết chỗ → waitlist.
// =============================================================================

const ACTIVE_CLASS_STATUSES = ["PLANNED", "RECRUITING", "PENDING_APPROVAL", "ACTIVE"] as const;
const ACTIVE_ENROLLMENT_STATUSES = ["CONFIRMED", "STUDYING", "ACTIVE"] as const;

/** Số bài (lesson) đã dạy của 1 lớp = số lessonId phân biệt trong các buổi đã qua. */
async function classCoveredLessons(classId: string): Promise<number> {
  const now = new Date();
  const sessions = await db.classSession.findMany({
    where: { classId, date: { lte: now } },
    select: { lessonId: true },
  });
  return new Set(sessions.filter((s) => s.lessonId).map((s) => s.lessonId as string)).size;
}

/** Số chỗ trống của 1 lớp (maxStudents − số enrollment đang học). */
async function classOpenSeats(classId: string, maxStudents: number): Promise<number> {
  const active = await db.enrollment.count({
    where: { classId, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] }, deletedAt: null },
  });
  return maxStudents - active;
}

export interface EligibleClass {
  classId: string;
  name: string;
  classCode: string | null;
  centerId: string | null;
  centerName: string | null;
  coveredLessons: number;
  openSeats: number;
}

/**
 * Tìm lớp đích hợp lệ để chuyển: cùng khoá, khác lớp hiện tại, đang hoạt động,
 * tiến độ KHÔNG vượt tiến độ học viên. `toCenterId` lọc cơ sở (null = mọi cơ sở).
 */
export async function findEligibleTargetClasses(
  studentId: string,
  fromClassId: string,
  toCenterId?: string | null,
): Promise<{ ok: boolean; error?: string; studentCovered?: number; classes?: EligibleClass[] }> {
  const fromClass = await db.class.findUnique({
    where: { id: fromClassId },
    select: { courseId: true, centerId: true },
  });
  if (!fromClass) return { ok: false, error: "Không tìm thấy lớp hiện tại" };

  // Tiến độ hiện tại của HV = số bài đã được dạy ở lớp hiện tại (đã tham gia).
  const studentCovered = await classCoveredLessons(fromClassId);

  const candidates = await db.class.findMany({
    where: {
      courseId: fromClass.courseId,
      id: { not: fromClassId },
      status: { in: [...ACTIVE_CLASS_STATUSES] },
      deletedAt: null,
      ...(toCenterId ? { centerId: toCenterId } : {}),
    },
    select: {
      id: true,
      name: true,
      classCode: true,
      centerId: true,
      maxStudents: true,
      center: { select: { name: true } },
    },
    take: 100,
  });

  const out: EligibleClass[] = [];
  for (const c of candidates) {
    const covered = await classCoveredLessons(c.id);
    // KHÔNG cho vượt buổi: lớp đích không được dạy nhanh hơn tiến độ HV.
    if (covered > studentCovered) continue;
    const seats = await classOpenSeats(c.id, c.maxStudents);
    out.push({
      classId: c.id,
      name: c.name,
      classCode: c.classCode,
      centerId: c.centerId,
      centerName: c.center?.name ?? null,
      coveredLessons: covered,
      openSeats: seats,
    });
  }
  // Ưu tiên lớp còn chỗ + tiến độ gần nhất.
  out.sort((a, b) => (b.openSeats > 0 ? 1 : 0) - (a.openSeats > 0 ? 1 : 0) || b.coveredLessons - a.coveredLessons);
  return { ok: true, studentCovered, classes: out };
}

/** Tạo yêu cầu chuyển. Không có lớp đích → WAITLISTED. */
export async function createTransferRequest(params: {
  studentId: string;
  fromClassId: string;
  toClassId?: string | null;
  toCenterId?: string | null;
  reason?: string | null;
  requestedById?: string | null;
}): Promise<{ ok: boolean; error?: string; requestId?: string; waitlisted?: boolean }> {
  const student = await db.student.findFirst({
    where: { id: params.studentId, deletedAt: null },
    select: { id: true, centerId: true },
  });
  if (!student) return { ok: false, error: "Không tìm thấy học viên" };

  const fromClass = await db.class.findUnique({ where: { id: params.fromClassId }, select: { centerId: true } });

  let toClassId = params.toClassId ?? null;
  let toCenterId = params.toCenterId ?? null;

  if (toClassId) {
    // Xác thực lớp đích còn hợp lệ + còn chỗ.
    const elig = await findEligibleTargetClasses(params.studentId, params.fromClassId, toCenterId);
    const match = elig.classes?.find((c) => c.classId === toClassId);
    if (!match) return { ok: false, error: "Lớp đích không hợp lệ (sai khoá hoặc vượt tiến độ)" };
    if (match.openSeats <= 0) {
      // Hết chỗ → chuyển sang waitlist thay vì lỗi.
      toClassId = null;
    } else {
      toCenterId = match.centerId;
    }
  }

  const req = await db.studentTransferRequest.create({
    data: {
      studentId: params.studentId,
      fromClassId: params.fromClassId,
      fromCenterId: fromClass?.centerId ?? student.centerId ?? null,
      toClassId,
      toCenterId,
      status: toClassId ? "PENDING" : "WAITLISTED",
      reason: params.reason ?? null,
      requestedById: params.requestedById ?? null,
    },
    select: { id: true, status: true },
  });
  return { ok: true, requestId: req.id, waitlisted: req.status === "WAITLISTED" };
}

/**
 * Duyệt chuyển: đóng enrollment cũ (TRANSFERRED), tạo enrollment mới ở lớp đích,
 * cập nhật Student.centerId + lịch sử cơ sở. Giữ lịch sử cơ sở cũ.
 */
export async function approveTransfer(
  requestId: string,
  decidedById: string | null,
  note?: string | null,
  opts?: { actor?: AuditActor; reason?: string },
): Promise<{ ok: boolean; error?: string }> {
  const req = await db.studentTransferRequest.findUnique({ where: { id: requestId } });
  if (!req) return { ok: false, error: "Không tìm thấy yêu cầu" };
  if (req.status !== "PENDING") return { ok: false, error: "Yêu cầu không ở trạng thái chờ duyệt" };
  if (!req.toClassId) return { ok: false, error: "Chưa có lớp đích (đang waitlist)" };

  const toClass = await db.class.findUnique({
    where: { id: req.toClassId },
    select: { id: true, courseId: true, centerId: true, maxStudents: true },
  });
  if (!toClass) return { ok: false, error: "Lớp đích không tồn tại" };

  // R6-E2 — "cùng mức phí": lớp đích phải CÙNG KHOÁ với lớp nguồn (khác khoá = đổi phí → chặn).
  if (req.fromClassId) {
    const fromClass = await db.class.findUnique({
      where: { id: req.fromClassId },
      select: { courseId: true },
    });
    if (fromClass && !isSameFeeTransfer(fromClass.courseId, toClass.courseId)) {
      return { ok: false, error: "Lớp đích khác khoá/mức phí — không cho chuyển giữa kỳ" };
    }
  }

  const seats = await classOpenSeats(toClass.id, toClass.maxStudents);
  if (seats <= 0) return { ok: false, error: "Lớp đích đã hết chỗ" };

  await db.$transaction(async (tx) => {
    // 1) Đóng enrollment cũ ở lớp nguồn.
    if (req.fromClassId) {
      await tx.enrollment.updateMany({
        where: { studentId: req.studentId, classId: req.fromClassId, status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } },
        data: { status: "TRANSFERRED", endedAt: new Date(), transferReason: req.reason ?? "Chuyển lớp" },
      });
    }

    // 2) Tạo enrollment mới ở lớp đích.
    await tx.enrollment.create({
      data: {
        studentId: req.studentId,
        classId: toClass.id,
        courseId: toClass.courseId,
        centerId: toClass.centerId, // FL3-02 — denormalize từ lớp đích cho scopedDb
        status: "STUDYING",
        startedAt: new Date(),
      },
    });

    // 3) Cập nhật cơ sở học viên + lịch sử cơ sở (giữ cơ sở cũ).
    if (toClass.centerId && toClass.centerId !== req.fromCenterId) {
      await tx.studentCenterHistory.updateMany({
        where: { studentId: req.studentId, toDate: null },
        data: { toDate: new Date() },
      });
      await tx.studentCenterHistory.create({
        data: { studentId: req.studentId, centerId: toClass.centerId, reason: req.reason ?? "Chuyển cơ sở" },
      });
      await tx.student.update({ where: { id: req.studentId }, data: { centerId: toClass.centerId } });
    }

    // 3b) US-03 chat / TS-05 — chuyển lớp: PH rời nhóm cũ + vào nhóm mới + SYSTEM
    // message, TRONG CÙNG transaction duyệt chuyển (rollback → không sync nửa vời).
    if (req.fromClassId) {
      await syncConversationMembership(tx, req.fromClassId);
    }
    await syncConversationMembership(tx, toClass.id);

    // 4) Đóng yêu cầu.
    await tx.studentTransferRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", decidedById, decidedAt: new Date(), note: note ?? null },
    });

    // 5) R6-E2 — audit ATOMIC trong cùng transaction (actor + reason).
    if (opts?.actor) {
      await writeAudit({
        actor: opts.actor,
        module: "transfer",
        entityType: "StudentTransferRequest",
        entityId: requestId,
        action: "APPROVE",
        newValues: { toClassId: toClass.id, toCenterId: toClass.centerId, studentId: req.studentId },
        reason: opts.reason ?? req.reason ?? "Duyệt chuyển lớp",
        orgUnitId: null,
        tx,
      });
    }
  }, { timeout: 30_000, maxWait: 10_000 });

  return { ok: true };
}

export async function rejectTransfer(
  requestId: string,
  decidedById: string | null,
  note?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const req = await db.studentTransferRequest.findUnique({ where: { id: requestId }, select: { status: true } });
  if (!req) return { ok: false, error: "Không tìm thấy yêu cầu" };
  if (req.status !== "PENDING" && req.status !== "WAITLISTED") return { ok: false, error: "Không thể từ chối" };
  await db.studentTransferRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", decidedById, decidedAt: new Date(), note: note ?? null },
  });
  return { ok: true };
}
