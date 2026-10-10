// lib/eval/eligibility.ts — R7-16: ai được đánh giá ai (tính tại thời điểm submit — AC3/AC5).
//
// TEACHER_EVAL: HV chỉ thấy GV đang/đã dạy mình trong scope của đợt (lớp/khóa).
// CENTER_SURVEY: PH có ≥1 con ĐANG học cơ sở của đợt.
//
// Pure (test được): filterEligibleTeacherEvals, isParentEligibleForCenter.
// DB-backed: getEligibleTeacherEvals, isParentEligibleForCenterDb.
import type { EnrollmentStatus } from "@prisma/client";
import { db } from "@/lib/db";

// HV đã/đang học → được đánh giá GV của lớp đó. Loại PENDING/CANCELLED/WITHDREW/TRANSFERRED.
export const TAUGHT_STATUSES: EnrollmentStatus[] = [
  "ACTIVE",
  "CONFIRMED",
  "STUDYING",
  "PAUSED",
  "COMPLETED",
];

// "Đang học" cơ sở (CENTER_SURVEY): hiện tại còn theo học (không tính COMPLETED đã xong).
export const CURRENTLY_STUDYING_STATUSES: EnrollmentStatus[] = [
  "ACTIVE",
  "CONFIRMED",
  "STUDYING",
  "PAUSED",
];

export type EnrollmentForEval = {
  enrollmentId: string;
  status: EnrollmentStatus;
  courseId: string;
  className: string;
  classCenterId: string | null;
  teacherId: string | null;
  teacherName: string | null;
  assistantId: string | null;
  assistantName: string | null;
};

export type RoundScope = {
  scope: "TEACHER_EVAL" | "CENTER_SURVEY";
  centerId: string | null;
  courseId: string | null;
};

/** 1 cặp (enrollment × GV) mà HV được đánh giá trong đợt. */
export type EligibleTeacherEval = {
  enrollmentId: string;
  teacherId: string;
  teacherName: string;
  className: string;
  role: "GV" | "Trợ giảng";
};

/**
 * PURE — từ enrollments của 1 HV + scope đợt → danh sách (enrollment×GV) đánh giá được.
 * Lọc theo TAUGHT_STATUSES, courseId (nếu đợt giới hạn khóa), centerId (nếu giới hạn cơ sở).
 * Gom cả GV chính + trợ giảng; mỗi người 1 entry (mỗi entry = 1 response/đợt — AC3).
 */
export function filterEligibleTeacherEvals(
  enrollments: EnrollmentForEval[],
  round: RoundScope,
): EligibleTeacherEval[] {
  const out: EligibleTeacherEval[] = [];
  const seen = new Set<string>(); // key enrollmentId|teacherId — chống nhân đôi

  for (const e of enrollments) {
    if (!TAUGHT_STATUSES.includes(e.status)) continue;
    if (round.courseId && e.courseId !== round.courseId) continue;
    if (round.centerId && e.classCenterId !== round.centerId) continue;

    const pairs: Array<{ id: string | null; name: string | null; role: "GV" | "Trợ giảng" }> = [
      { id: e.teacherId, name: e.teacherName, role: "GV" },
      { id: e.assistantId, name: e.assistantName, role: "Trợ giảng" },
    ];
    for (const p of pairs) {
      if (!p.id) continue;
      const key = `${e.enrollmentId}|${p.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        enrollmentId: e.enrollmentId,
        teacherId: p.id,
        teacherName: p.name ?? "Giáo viên",
        className: e.className,
        role: p.role,
      });
    }
  }
  return out;
}

/** PURE — PH đủ điều kiện khảo sát cơ sở nếu ≥1 con ĐANG học centerId của đợt. */
export function isParentEligibleForCenter(
  childEnrollments: Array<{ status: EnrollmentStatus; classCenterId: string | null }>,
  roundCenterId: string | null,
): boolean {
  if (!roundCenterId) return childEnrollments.length > 0; // đợt không gắn CS → mọi PH có con
  return childEnrollments.some(
    (e) => CURRENTLY_STUDYING_STATUSES.includes(e.status) && e.classCenterId === roundCenterId,
  );
}

// ─── DB-backed ──────────────────────────────────────────────────────────────

/** Nạp enrollments của 1 HV (kèm GV lớp) → áp filter thuần. */
export async function getEligibleTeacherEvals(
  studentId: string,
  round: RoundScope,
): Promise<EligibleTeacherEval[]> {
  const rows = await db.enrollment.findMany({
    where: { studentId, status: { in: TAUGHT_STATUSES } },
    select: {
      id: true,
      status: true,
      courseId: true,
      class: {
        select: {
          name: true,
          centerId: true,
          teacherId: true,
          assistantId: true,
          teacher: { select: { name: true } },
          assistant: { select: { name: true } },
        },
      },
    },
  });

  const mapped: EnrollmentForEval[] = rows.map((r) => ({
    enrollmentId: r.id,
    status: r.status,
    courseId: r.courseId,
    className: r.class.name,
    classCenterId: r.class.centerId,
    teacherId: r.class.teacherId,
    teacherName: r.class.teacher?.name ?? null,
    assistantId: r.class.assistantId,
    assistantName: r.class.assistant?.name ?? null,
  }));

  return filterEligibleTeacherEvals(mapped, round);
}

/** PH đủ điều kiện khảo sát cơ sở của đợt? Tính tại thời điểm gọi (submit). */
export async function isParentEligibleForCenterDb(
  parentUserId: string,
  roundCenterId: string | null,
): Promise<boolean> {
  const rows = await db.enrollment.findMany({
    where: {
      student: { parentUserId, deletedAt: null },
      status: { in: CURRENTLY_STUDYING_STATUSES },
    },
    select: { status: true, class: { select: { centerId: true } } },
  });
  return isParentEligibleForCenter(
    rows.map((r) => ({ status: r.status, classCenterId: r.class.centerId })),
    roundCenterId,
  );
}
