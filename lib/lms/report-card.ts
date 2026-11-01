// lib/lms/report-card.ts — R7-15: Học bạ ReportCard (phần đụng DB).
//
// Logic THUẦN (máy trạng thái / số liệu pure / snapshot / T5 scope) ở
// ./report-card-core (an toàn import client). File này thêm phần đọc DB và
// RE-EXPORT toàn bộ core để call-site server chỉ cần 1 import.
import "server-only";
import { db } from "@/lib/db";
import { attendanceSummary } from "@/lib/attendance/summary";
import {
  REPORT_CARD_MILESTONES,
  milestoneLabel,
  milestonePeriodKey,
} from "@/lib/lms/report-card-milestone";
import {
  attendanceRatePercent,
  computeAssignmentSummary,
  computeExamAverage,
  latestSkillLevels,
  parsePublishedSnapshot,
  type AssignmentSubmissionLite,
  type ExamAttemptLite,
  type ReportCardMetrics,
  type PublishedReportCardView,
} from "@/lib/lms/report-card-core";

export * from "@/lib/lms/report-card-core";

/**
 * Nhãn hiển thị cho `periodComments[].period` phía NGƯỜI ĐỌC (portal web + PDF):
 * khoá kỳ chuẩn SESSION_5/SESSION_12 → nhãn tiếng Việt ("Kỳ 1 — buổi 5"); period
 * tự do cũ giữ nguyên văn. KHÔNG đổi dữ liệu snapshot (bản phát hành cũ vẫn parse
 * nguyên trạng) — chỉ map lúc render, cùng quy tắc periodDisplayLabel của editor.
 */
export function reportCardPeriodDisplay(period: string): string {
  const m = REPORT_CARD_MILESTONES.find((x) => milestonePeriodKey(x) === period.trim());
  return m ? milestoneLabel(m) : period;
}

/**
 * FIX A3 (THUẦN): xếp scores theo THỨ TỰ criteria (getCourseCriteria đã sort
 * [order asc, createdAt asc]) trước khi đóng băng snapshot phát hành — findMany
 * scores không orderBy nên thứ tự DB tuỳ ý làm PDF/portal đảo tiêu chí so với
 * editor. Điểm của tiêu chí đã TẮT (không còn active) giữ ở cuối, không rơi mất.
 */
export function orderScoresByCriteria<T extends { criterionId: string }>(
  scores: T[],
  criteria: { id: string }[],
): T[] {
  const byCriterion = new Map(scores.map((s) => [s.criterionId, s]));
  const activeIds = new Set(criteria.map((c) => c.id));
  return [
    ...criteria.flatMap((c) => {
      const s = byCriterion.get(c.id);
      return s ? [s] : [];
    }),
    ...scores.filter((s) => !activeIds.has(s.criterionId)),
  ];
}

const EXAM_DONE_STATUSES = ["SUBMITTED", "GRADED", "REVIEWED"] as const;

/** Số liệu LIVE cho 1 enrollment (chuyên cần từ R7-08 + bài tập từ ExamAttempt). */
export async function computeReportCardMetrics(enrollmentId: string): Promise<ReportCardMetrics> {
  const enr = await db.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { studentId: true, classId: true },
  });
  const att = await attendanceSummary(enrollmentId);

  let attempts: ExamAttemptLite[] = [];
  let submissions: AssignmentSubmissionLite[] = [];
  let skills: { skill: string; level: string; assessedAt: string }[] = [];
  if (enr) {
    const rows = await db.examAttempt.findMany({
      where: {
        studentId: enr.studentId,
        exam: { classId: enr.classId },
        status: { in: [...EXAM_DONE_STATUSES] },
      },
      select: {
        examId: true,
        totalScore: true,
        passed: true,
        exam: { select: { totalPoints: true } },
      },
    });
    // LMS-12 (thi lại): 1 đề có thể có NHIỀU lần thi → chỉ lấy lần điểm CAO NHẤT
    // mỗi đề (best attempt) để computeExamAverage không double-count. Đề thi 1 lần
    // vẫn đúng (mỗi examId chỉ 1 row). totalScore null xem như thấp nhất.
    const bestByExam = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = bestByExam.get(r.examId);
      if (!cur || (r.totalScore ?? -1) > (cur.totalScore ?? -1)) {
        bestByExam.set(r.examId, r);
      }
    }
    attempts = Array.from(bestByExam.values()).map((r) => ({
      totalScore: r.totalScore,
      totalPoints: r.exam.totalPoints,
      passed: r.passed,
    }));

    // LMS-13 (W4-a): bài tập của học viên trong lớp (qua Assignment.classId).
    const subRows = await db.assignmentSubmission.findMany({
      where: { studentId: enr.studentId, assignment: { classId: enr.classId } },
      select: { status: true, score: true, assignment: { select: { totalPoints: true } } },
    });
    submissions = subRows.map((s) => ({
      status: s.status,
      score: s.score,
      totalPoints: s.assignment.totalPoints,
    }));

    // LMS-13 (W4-a): kỹ năng robot — bản đánh giá mới nhất mỗi kỹ năng.
    const skillRows = await db.studentSkillAssessment.findMany({
      where: { studentId: enr.studentId },
      select: { skill: true, level: true, assessedAt: true },
    });
    skills = skillRows.map((r) => ({
      skill: r.skill,
      level: r.level,
      assessedAt: r.assessedAt.toISOString(),
    }));
  }

  return {
    attendance: { ...att, rate: attendanceRatePercent(att) },
    exams: computeExamAverage(attempts),
    assignments: computeAssignmentSummary(submissions),
    skills: latestSkillLevels(skills),
    computedAt: new Date().toISOString(),
  };
}

// ── Ngữ cảnh enrollment + tiêu chí ────────────────────────────────────────────
export interface EnrollmentContext {
  enrollmentId: string;
  classId: string;
  centerId: string | null;
  teacherId: string | null;
  courseId: string;
  studentId: string;
  className: string;
  studentName: string;
  studentCode: string | null;
  courseName: string;
  // #04 carve-out câu 20: cơ sở HIỆN TẠI của HV (khác centerId enrollment/lớp nếu đã chuyển
  // cơ sở) — để QL cơ sở tiếp nhận XEM học bạ cũ.
  studentCurrentCenterId: string | null;
}

export async function getEnrollmentContext(enrollmentId: string): Promise<EnrollmentContext | null> {
  // FIX A2 (02/08): ghi danh XOÁ MỀM không được lọt luồng học bạ — soft-delete chỉ set
  // deletedAt (status giữ nguyên) nên thiếu filter là HV đã xoá vẫn nhập/duyệt/PHÁT HÀNH
  // được. Đây là cổng chung của save/transition/editor page → chặn 1 chỗ chặn cả luồng.
  const enr = await db.enrollment.findFirst({
    where: { id: enrollmentId, deletedAt: null },
    select: {
      id: true,
      classId: true,
      courseId: true,
      studentId: true,
      student: { select: { name: true, studentCode: true, centerId: true } },
      class: { select: { name: true, centerId: true, teacherId: true } },
      course: { select: { name: true } },
    },
  });
  if (!enr) return null;
  return {
    enrollmentId: enr.id,
    classId: enr.classId,
    centerId: enr.class.centerId,
    teacherId: enr.class.teacherId,
    courseId: enr.courseId,
    studentId: enr.studentId,
    className: enr.class.name,
    studentName: enr.student.name,
    studentCode: enr.student.studentCode,
    courseName: enr.course.name,
    studentCurrentCenterId: enr.student.centerId,
  };
}

export interface CriterionView {
  id: string;
  name: string;
  order: number;
}

/** Tiêu chí năng lực ACTIVE của 1 khoá (Đào tạo cấu hình). */
export async function getCourseCriteria(courseId: string): Promise<CriterionView[]> {
  return db.reportCardCriterion.findMany({
    where: { courseId, active: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, order: true },
  });
}

// ── Đọc học bạ ĐÃ PHÁT HÀNH (portal — chỉ PUBLISHED, đọc từ snapshot) ─────────

/**
 * Học bạ ĐÃ PHÁT HÀNH của 1 học viên (đọc snapshot — KHÔNG tính lại live),
 * mới nhất trước. `limit` áp vào `take` — call-site chỉ cần bản mới nhất
 * (vd notification-feed) truyền 1 để khỏi kéo toàn bộ snapshot JSON.
 */
export async function getPublishedReportCards(
  studentId: string,
  limit?: number,
): Promise<PublishedReportCardView[]> {
  const enrollments = await db.enrollment.findMany({
    // FIX-C3: ghi danh đã xóa mềm (ghi danh nhầm) KHÔNG được lộ học bạ ra portal
    // — nếu không, ReportCard PUBLISHED của nó che dữ liệu lớp đang học thật.
    where: { studentId, deletedAt: null },
    select: { id: true },
  });
  const ids = enrollments.map((e) => e.id);
  if (ids.length === 0) return [];

  const cards = await db.reportCard.findMany({
    where: { enrollmentId: { in: ids }, status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    ...(limit != null ? { take: limit } : {}),
    select: { id: true, enrollmentId: true, publishedSnapshot: true },
  });
  return cards
    .map((c) => parsePublishedSnapshot(c.id, c.enrollmentId, c.publishedSnapshot))
    .filter((x): x is PublishedReportCardView => x !== null);
}

/**
 * 1 học bạ ĐÃ PHÁT HÀNH theo id + studentId chủ sở hữu (cho PDF portal — chống IDOR).
 * RECALLED/khác PUBLISHED → null (PH tải sẽ 404, đúng edge "thu hồi khi đang xem").
 */
export async function getPublishedReportCardForStudent(
  reportCardId: string,
  studentId: string,
): Promise<PublishedReportCardView | null> {
  const card = await db.reportCard.findFirst({
    where: { id: reportCardId, status: "PUBLISHED" },
    select: { id: true, enrollmentId: true, publishedSnapshot: true },
  });
  if (!card) return null;

  const enr = await db.enrollment.findUnique({
    where: { id: card.enrollmentId },
    select: { studentId: true },
  });
  if (!enr || enr.studentId !== studentId) return null;

  return parsePublishedSnapshot(card.id, card.enrollmentId, card.publishedSnapshot);
}
