import { requireActiveStudent } from "@/lib/portal/session";
import {
  getStudentClasses,
  getStudentExamResults,
  getStudentAssignmentResults,
  getLatestProgressReport,
} from "@/lib/portal/learning";
import { getStudentProgressForClasses } from "@/lib/progress";
import { getStudentClassProgress } from "@/lib/students/progress";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import {
  SKILL_ORDER,
  SKILL_LABEL,
  LEVEL_LABEL,
  LEVEL_COLOR,
} from "@/lib/lms/skills";
import type { RoboticsSkill, SkillLevel } from "@prisma/client";
import { formatDateVN } from "@/lib/format/date";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kết quả | Sata Robo" };

const ASSIGN_STATUS: Record<string, { label: string; cls: string }> = {
  SUBMITTED: { label: "Đã nộp", cls: "bg-blue-100 text-blue-700" },
  LATE: { label: "Nộp trễ", cls: "bg-amber-100 text-amber-700" },
  GRADED: { label: "Đã chấm", cls: "bg-emerald-100 text-emerald-700" },
};

export default async function KetQuaPage() {
  const { ctx, studentId } = await requireActiveStudent();
  const [classes, examResults, assignmentResults, latestReport] =
    await Promise.all([
      getStudentClasses(studentId),
      getStudentExamResults(studentId),
      getStudentAssignmentResults(studentId),
      getLatestProgressReport(studentId),
    ]);
  // QRY-02: tiến độ mọi lớp batch 1 lượt (thay getStudentProgress N+1 trong map).
  const classProgress = await getStudentProgressForClasses(
    studentId,
    classes.map((c) => c.id),
  );
  const results = await Promise.all(
    classes.map(async (c) => ({
      cls: c,
      p: classProgress.get(c.id)!,
      sessions: await getStudentClassProgress(studentId, c.id),
    })),
  );

  // LMS-5 — năng lực robotics hiện tại (bản mới nhất mỗi kỹ năng).
  // StudentSkillAssessment KHÔNG thuộc SCOPED_MODELS → scopedDb pass-through
  // (cách ly bằng ownership: studentId đã verify qua requireActiveStudent).
  const sdb = scopedDb(await resolveActor(ctx.parentUserId));
  const skillRows = await sdb.studentSkillAssessment.findMany({
    where: { studentId },
    orderBy: { assessedAt: "desc" },
    select: { skill: true, level: true },
  });
  const latestSkills: Partial<Record<RoboticsSkill, SkillLevel>> = {};
  for (const r of skillRows)
    if (!latestSkills[r.skill]) latestSkills[r.skill] = r.level;
  const hasSkills = Object.keys(latestSkills).length > 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-neutral-900">Kết quả học tập</h1>

      {hasSkills && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-700">
            Năng lực robotics
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SKILL_ORDER.filter((s) => latestSkills[s]).map((s) => {
              const lv = latestSkills[s] as SkillLevel;
              return (
                <li
                  key={s}
                  className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2"
                >
                  <span className="text-sm text-neutral-700">
                    {SKILL_LABEL[s]}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL_COLOR[lv]}`}
                  >
                    {LEVEL_LABEL[lv]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {latestReport && (
        <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-800">
          <p className="font-semibold">{latestReport.reportTitle}</p>
          <p className="text-xs text-purple-600">
            {latestReport.className ? `${latestReport.className} · ` : ""}
            Lập ngày {formatDateVN(latestReport.generatedAt)}
          </p>
        </div>
      )}

      {results.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Chưa có dữ liệu kết quả.
        </p>
      ) : (
        <div className="space-y-3">
          {results.map(({ cls, p, sessions }) => (
            <section
              key={cls.id}
              className="rounded-xl border border-neutral-200 bg-white p-4"
            >
              <h2 className="font-semibold text-neutral-900">{cls.name}</h2>
              <p className="mb-3 text-xs text-neutral-600">{cls.courseName}</p>
              <div className="mb-3 rounded-lg bg-orange-50 px-3 py-2 text-sm">
                <span className="font-bold text-orange-700">
                  Đang học buổi {sessions.currentSession} / tổng{" "}
                  {sessions.total || "—"}
                </span>
                <span className="ml-2 text-neutral-600">
                  · đã học {sessions.attended} · còn lại {sessions.remaining}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric
                  label="Điểm danh"
                  value={
                    p.totalSessions === 0
                      ? "Chưa diễn ra"
                      : `${p.attendedSessions}/${p.totalSessions}`
                  }
                  sub={
                    p.totalSessions === 0 ? undefined : `${p.attendanceRate}%`
                  }
                />
                <Metric
                  label="Bài học"
                  value={`${p.coveredLessons}/${p.totalLessons}`}
                />
                <Metric
                  label="Bài tập nộp"
                  value={`${p.submittedAssignments}/${p.totalAssignments}`}
                />
                <Metric
                  label="Điểm TB"
                  value={p.averageScore !== null ? `${p.averageScore}/10` : "—"}
                />
                <Metric
                  label="Đề thi đạt"
                  value={
                    p.examAttempts > 0
                      ? `${p.passedExams}/${p.examAttempts}`
                      : "—"
                  }
                />
              </dl>
            </section>
          ))}
        </div>
      )}

      {examResults.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-neutral-700">
            Kết quả bài thi
          </h2>
          <ul className="space-y-2">
            {examResults.map((r) => (
              <li
                key={r.attemptId}
                className="rounded-xl border border-neutral-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-neutral-900">{r.examTitle}</p>
                  {r.graded ? (
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        r.passed
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {r.totalScore ?? 0}/{r.totalPoints}
                      {r.passed ? " · Đạt" : " · Chưa đạt"}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                      Chờ giáo viên chấm
                    </span>
                  )}
                </div>
                {r.graded && r.feedback && (
                  <p className="mt-2 rounded-lg bg-neutral-50 p-2 text-sm text-neutral-600">
                    Nhận xét: {r.feedback}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {assignmentResults.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-neutral-700">
            Kết quả bài tập
          </h2>
          <ul className="space-y-2">
            {assignmentResults.map((r) => {
              const st = ASSIGN_STATUS[r.status] ?? ASSIGN_STATUS.SUBMITTED;
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-neutral-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-neutral-900">{r.title}</p>
                    <div className="flex items-center gap-2">
                      {r.status === "GRADED" && r.score !== null && (
                        <span className="text-sm font-bold text-neutral-800">
                          {r.score}/{r.totalPoints}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </div>
                  </div>
                  {r.status === "GRADED" && r.feedback && (
                    <p className="mt-2 rounded-lg bg-neutral-50 p-2 text-sm text-neutral-600">
                      Nhận xét: {r.feedback}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-neutral-50 p-3">
      <p className="text-xs text-neutral-600">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-neutral-900">{value}</p>
      {sub && <p className="text-xs text-neutral-600">{sub}</p>}
    </div>
  );
}
