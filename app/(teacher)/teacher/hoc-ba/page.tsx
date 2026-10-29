// app/(teacher)/teacher/hoc-ba/page.tsx — #06 (L6): màn "Học bạ" site GV (câu 55).
//
// 2 mức điều hướng qua searchParams (không route động — giống /teacher/lop):
//   (a) không tham số   → danh sách ghi danh các LỚP MÌNH (mirror home #4:
//                         sdb.enrollment where classId ∈ assignedClassIds, deletedAt
//                         null) + trạng thái học bạ + mốc buổi 5/12 (#17) + badge
//                         "GV sửa được".
//   (b) ?enrollmentId=… → EDITOR: tái dùng ReportCardEditor + data assembly Y HỆT
//                         trang admin /admin/report-cards/[enrollmentId]. Mọi read
//                         raw đi qua hàm lib/** (getEnrollmentContext… +
//                         report-card-editor-data) — app/(teacher) KHÔNG import
//                         @/lib/db trần (ESLint R6-F1).
//
// Gác ĐỌC chống IDOR: enrollment.classId PHẢI ∈ actor.assignedClassIds TRƯỚC khi
// assemble (GV chỉ lớp mình; checkEnrollmentScope trong action đã gác đường GHI).
// GV capabilities = ["manage"] (KHÔNG review — duyệt/phát hành làm trên admin) →
// PENDING_REVIEW/PUBLISHED editor read-only; RECALLED chỉ QL/Đào tạo sửa lại
// (canEditReportCardContent, #17 Gap3). Nút Lưu/Nộp gọi thẳng action của admin
// (saveReportCardAction/transitionReportCardAction — tự gate qua authContext).
//
// ⚠️ Câu 46: KHÔNG SĐT/email/tên phụ huynh trong payload client — list chỉ tên HV
// + lớp + trạng thái; editor không nhận contact PH (props chỉ metrics/tiêu chí/nhận xét).
import { FileText, Lock } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { attendanceSummaryForEnrollments } from "@/lib/attendance/summary";
import {
  REPORT_CARD_STATUS_LABEL,
  canEditReportCardContent,
  computeAssignmentSummary,
  computeReportCardMetrics,
  getCourseCriteria,
  getEnrollmentContext,
  normalizePeriodComments,
  type AssignmentSubmissionLite,
  type PeriodComment,
  type ReportCardStatusValue,
} from "@/lib/lms/report-card";
import {
  REPORT_CARD_MILESTONES,
  ensureMilestonePeriods,
  milestoneLabel,
  missingMilestoneComments,
  reachedMilestones,
} from "@/lib/lms/report-card-milestone";
import {
  countCompletedClassSessions,
  getReportCardEditorRecord,
} from "@/lib/lms/report-card-editor-data";
import { ReportCardEditor } from "@/app/(admin)/admin/report-cards/_components/report-card-editor";
import { EmptyState } from "../_components/ui/empty-state";
import { PageHeader } from "../_components/ui/page-header";
import {
  ReportCardsList,
  type CompetencyRank,
  type MilestoneChip,
  type ReportCardRow,
} from "./_components/report-cards-list";
import { BackLink } from "../_components/ui/back-link";

export const metadata = { title: "Học bạ | Giáo viên Sata Robo" };

const updatedFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

/**
 * Precompute chip mốc buổi 5/12 cho LIST (#17 Gap 1, câu 55) — 3 trạng thái mỗi mốc:
 * chưa đạt buổi N (pending) · đạt nhưng THIẾU nhận xét (missing — việc GV cần làm) ·
 * đã viết nhận xét (done). Server precompute → client chỉ render (không import lib mốc).
 */
function buildMilestones(
  completedSessions: number,
  periods: PeriodComment[],
): MilestoneChip[] {
  const reached = new Set<number>(reachedMilestones(completedSessions));
  const missing = new Set<number>(
    missingMilestoneComments(completedSessions, periods),
  );
  return REPORT_CARD_MILESTONES.map((m): MilestoneChip => {
    const state: MilestoneChip["state"] = !reached.has(m)
      ? "pending"
      : missing.has(m)
        ? "missing"
        : "done";
    const text =
      state === "pending"
        ? `Buổi ${m}`
        : state === "missing"
          ? `Buổi ${m} · thiếu nhận xét`
          : `Buổi ${m} ✓`;
    return { milestone: m, state, text, label: milestoneLabel(m) };
  });
}

/**
 * Xếp loại năng lực suy từ điểm TB các tiêu chí ĐÃ CHẤM (thang 1–4). Repo CHƯA có hàm
 * map điểm→xếp loại (mức 1–4 chỉ có nhãn 1 Cần cố gắng · 2 Đạt · 3 Khá · 4 Tốt), nên
 * suy 4 bậc cho tab "Năng lực" (câu 55): ≥3.5 Xuất sắc · ≥2.75 Giỏi · ≥2.0 Khá · còn
 * lại Cần cố gắng. avg=null (chưa chấm tiêu chí nào) → null (hiện "Chưa chấm").
 */
function deriveCompetencyRank(avg: number | null): CompetencyRank | null {
  if (avg == null) return null;
  if (avg >= 3.5) return "Xuất sắc";
  if (avg >= 2.75) return "Giỏi";
  if (avg >= 2.0) return "Khá";
  return "Cần cố gắng";
}

export default async function TeacherReportCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ enrollmentId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate — guard cho type-narrow

  const { enrollmentId } = await searchParams;
  const actor = await resolveActor(session.user.id);

  // ── (b) Editor 1 học bạ — mirror admin [enrollmentId] ───────────────────────
  if (enrollmentId) {
    const enr = await getEnrollmentContext(enrollmentId); // lib đọc raw — chỉ ngữ cảnh
    // Gác ĐỌC chống IDOR TRƯỚC khi assemble: GV chỉ mở học bạ lớp mình phụ trách.
    if (!enr || !actor.assignedClassIds.has(enr.classId)) return <NotYours />;

    // Site GV: capability CHỈ 'manage' — canReview cố định false (câu 55: duyệt trên admin).
    const canManage = await checkPermission("report-cards:manage");

    // Data assembly Y HỆT trang admin (read raw qua helper lib — scope đã gác ở trên).
    const [criteria, metrics, rc, completedSessions] = await Promise.all([
      getCourseCriteria(enr.courseId),
      computeReportCardMetrics(enrollmentId),
      getReportCardEditorRecord(enrollmentId),
      countCompletedClassSessions(enr.classId),
    ]);

    const status = (rc?.status ?? "DRAFT") as ReportCardStatusValue;
    const scoreMap = new Map((rc?.scores ?? []).map((s) => [s.criterionId, s]));

    return (
      <div className="space-y-5">
        <BackLink href="?" label="Học bạ lớp tôi" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Học bạ — {enr.studentName}
            {enr.studentCode ? (
              <span className="text-muted-foreground">
                {" "}
                ({enr.studentCode})
              </span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {enr.courseName} · {enr.className}
          </p>
        </div>

        {criteria.length === 0 ? (
          <div className="rounded-md border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink dark:border-state-warning">
            Khoá học <b>{enr.courseName}</b> chưa có tiêu chí năng lực — liên hệ
            Đào tạo cấu hình tiêu chí trước khi nhập học bạ.
          </div>
        ) : null}

        <ReportCardEditor
          enrollmentId={enrollmentId}
          status={status}
          // GV manage-only: DRAFT sửa được; RECALLED cần 'review' (QL/Đào tạo) → khoá
          // nội dung (#17 Gap3) — khớp gate canEditReportCardContent trong action.
          editable={canManage && canEditReportCardContent(status, ["manage"])}
          canManage={canManage}
          canReview={false}
          publishedAt={rc?.publishedAt ? rc.publishedAt.toISOString() : null}
          metrics={metrics}
          criteria={criteria}
          finalComment={rc?.finalComment ?? ""}
          completionStatus={rc?.completionStatus ?? ""}
          periodComments={ensureMilestonePeriods(
            completedSessions,
            normalizePeriodComments(rc?.periodComments),
          )}
          scores={criteria.map((c) => {
            const s = scoreMap.get(c.id);
            return {
              criterionId: c.id,
              level: s?.level ?? 0,
              note: s?.note ?? "",
            };
          })}
        />
      </div>
    );
  }

  // ── (a) Danh sách ghi danh các lớp mình (mirror home #4) ────────────────────
  const sdb = scopedDb(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  // Đọc QUA quan hệ class (đã guard classId ∈ assignedClassIds) — enrollment dev
  // centerId=null bị scopedDb lọc mất nếu query sdb.enrollment trực tiếp (pattern
  // hub-students-tab / hoc-vien). Đồng thời lấy sẵn khoá học cho cột + bộ lọc.
  const listClasses = classIds.length
    ? await sdb.class.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          name: true,
          course: { select: { name: true } },
          // "lich-su": học bạ phải còn cho lớp đã kết khoá và em đã nghỉ. Nhưng ghi
          // danh "Chờ xác nhận"/"Đã huỷ" thì KHÔNG có học bạ để in, và HV đã xoá mềm
          // không được hiện tên (trước đây chỉ lọc deletedAt của ghi danh).
          enrollments: {
            where: rosterWhere("lich-su"),
            // Câu 46: CHỈ tên + mã HV — KHÔNG contact PH.
            select: {
              id: true,
              courseId: true,
              student: { select: { id: true, name: true, studentCode: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { name: "asc" },
      })
    : [];
  const enrollments = listClasses.flatMap((c) =>
    c.enrollments.map((e) => ({
      id: e.id,
      classId: c.id,
      courseId: e.courseId,
      studentId: e.student.id,
      studentName: e.student.name,
      studentCode: e.student.studentCode,
      className: c.name,
      courseName: c.course.name,
    })),
  );

  const enrollmentIds = enrollments.map((e) => e.id);
  // Tiêu chí năng lực theo KHOÁ (tab "Năng lực") — Đào tạo cấu hình per-course; đọc raw
  // qua lib getCourseCriteria (app/(teacher) không import @/lib/db trần). Dedupe courseId
  // để mỗi khoá chỉ 1 query.
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];
  const [cards, completedRows, summaries, gradedSubs, criteriaLists] =
    await Promise.all([
      enrollmentIds.length
        ? sdb.reportCard.findMany({
            where: { enrollmentId: { in: enrollmentIds } },
            select: {
              enrollmentId: true,
              status: true,
              periodComments: true,
              updatedAt: true,
              // Mức năng lực đã chấm (thang 1–4) cho bảng so sánh chéo + xếp loại.
              scores: { select: { criterionId: true, level: true } },
            },
          })
        : Promise.resolve([]),
      // Số buổi COMPLETED mỗi lớp — xác định mốc 5/12 đã đạt (#17 Gap 1, câu 55).
      classIds.length
        ? sdb.classSession.groupBy({
            by: ["classId"],
            where: { classId: { in: classIds }, status: "COMPLETED" },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      // Chuyên cần từng ghi danh — dùng lib R7-08 (attended gồm buổi bù, total = số buổi
      // chuẩn). Bản GỘP: 19/08 chỗ này còn gọi attendanceSummary theo từng ghi danh, mỗi
      // lần ~6 truy vấn ⇒ giáo viên 6 lớp × 20 HV bắn ~700 truy vấn đồng thời vào pool.
      attendanceSummaryForEnrollments(enrollments.map((e) => e.id)),
      // Điểm TB bài tập (thang 10): 1 query gộp cho mọi lớp; AssignmentSubmission ∉ SCOPED
      // → guard qua assignment.classId ∈ classIds (pattern AssignmentsTab hoc-vien).
      classIds.length
        ? sdb.assignmentSubmission.findMany({
            where: {
              status: "GRADED",
              score: { not: null },
              assignment: { classId: { in: classIds } },
            },
            select: {
              studentId: true,
              score: true,
              assignment: { select: { classId: true, totalPoints: true } },
            },
          })
        : Promise.resolve([]),
      // Tiêu chí ACTIVE mỗi khoá (song song thứ tự courseIds).
      Promise.all(courseIds.map((id) => getCourseCriteria(id))),
    ]);

  const cardByEnrollment = new Map(cards.map((c) => [c.enrollmentId, c]));
  const completedByClass = new Map(
    completedRows.map((r) => [r.classId, r._count._all]),
  );
  const summaryByEnrollment = summaries;
  const criteriaByCourse = new Map(
    courseIds.map((id, i) => [id, criteriaLists[i]]),
  );

  // Gom bài đã chấm theo (studentId × classId) → điểm TB qua computeAssignmentSummary.
  const gradedByKey = new Map<string, AssignmentSubmissionLite[]>();
  for (const s of gradedSubs) {
    const key = `${s.studentId}::${s.assignment.classId}`;
    const arr = gradedByKey.get(key) ?? [];
    arr.push({
      status: "GRADED",
      score: s.score,
      totalPoints: s.assignment.totalPoints,
    });
    gradedByKey.set(key, arr);
  }

  const rows: ReportCardRow[] = enrollments.map((e) => {
    const card = cardByEnrollment.get(e.id);
    const status = (card?.status ?? null) as ReportCardStatusValue | null;
    const sum = summaryByEnrollment.get(e.id) ?? {
      total: 0,
      attended: 0,
      absent: 0,
      needMakeup: 0,
      madeUp: 0,
    };
    const avgScore = computeAssignmentSummary(
      gradedByKey.get(`${e.studentId}::${e.classId}`) ?? [],
    ).averageScore;

    // ── Năng lực (tab "Năng lực", câu 55): mức 1–4 mỗi tiêu chí của khoá + TB + xếp loại.
    // level 0 = chưa chấm. Chỉ tính TB trên tiêu chí ĐÃ CHẤM (level≥1).
    const levelByCriterion = new Map(
      (card?.scores ?? []).map((s) => [s.criterionId, s.level]),
    );
    const cells = (criteriaByCourse.get(e.courseId) ?? []).map((c) => ({
      name: c.name,
      order: c.order,
      level: levelByCriterion.get(c.id) ?? 0,
    }));
    const scoredLevels = cells.filter((c) => c.level >= 1).map((c) => c.level);
    const avgLevel = scoredLevels.length
      ? Math.round(
          (scoredLevels.reduce((a, b) => a + b, 0) / scoredLevels.length) * 10,
        ) / 10
      : null;

    return {
      enrollmentId: e.id,
      studentName: e.studentName,
      studentCode: e.studentCode,
      className: e.className,
      courseName: e.courseName,
      status,
      statusLabel: status ? REPORT_CARD_STATUS_LABEL[status] : null,
      // Chưa có học bạ = lưu lần đầu sẽ tạo DRAFT → xét quyền sửa như DRAFT.
      editableByTeacher: canEditReportCardContent(status ?? "DRAFT", [
        "manage",
      ]),
      attendedSessions: sum.attended,
      totalSessions: sum.total,
      avgScore,
      updatedAtLabel: card?.updatedAt
        ? updatedFmt.format(card.updatedAt)
        : null,
      hasCard: !!card,
      milestones: buildMilestones(
        completedByClass.get(e.classId) ?? 0,
        normalizePeriodComments(card?.periodComments),
      ),
      competency: { cells, avgLevel, rank: deriveCompetencyRank(avgLevel) },
    };
  });

  return (
    <div>
      <PageHeader
        title="Học bạ"
        subtitle="Học bạ năng lực học viên các lớp bạn phụ trách — viết nhận xét mốc buổi 5/12 rồi nộp duyệt."
      />

      {enrollments.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Bạn chưa được phân công lớp nào hoặc lớp chưa có học viên."
        />
      ) : (
        <ReportCardsList rows={rows} />
      )}
    </div>
  );
}

function NotYours() {
  return (
    <div className="space-y-4">
      <BackLink href="?" label="Học bạ lớp tôi" />
      <EmptyState icon={Lock} title="Học bạ không thuộc lớp bạn phụ trách." />
    </div>
  );
}
