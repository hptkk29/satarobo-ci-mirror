import Link from "next/link";
import { ChevronLeft, LineChart } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasRole, canViewParentContact } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { getClassProgress, getClassGradebook } from "@/lib/progress";
import { GenerateReportsButton } from "./_components/generate-reports-button";
import { formatDateVN } from "@/lib/format/date";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const dynamic = "force-dynamic";

const EXAM_STATUS_VI: Record<string, string> = {
  IN_PROGRESS: "Đang làm",
  SUBMITTED: "Đã nộp",
  GRADED: "Đã chấm",
  REVIEWED: "Đã duyệt",
  "—": "Chưa làm",
};
const SUB_STATUS_VI: Record<string, string> = {
  NOT_SUBMITTED: "Chưa nộp",
  SUBMITTED: "Đã nộp",
  LATE: "Nộp trễ",
  GRADED: "Đã chấm",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ClassProgressPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const now = new Date();

  // Cách ly cơ sở: Class ∈ SCOPED_MODELS → sdb.class.findUnique lọc IDOR (ngoài tầm
  // nhìn cơ sở → null → notFound). Cổng này khoá luôn cả trang vì count/getClassProgress
  // /getClassGradebook đều key theo `id` đã được xác thực tầm nhìn ở đây.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const cls = await sdb.class.findUnique({
    where: { id },
    include: {
      course: { select: { name: true } },
      center: { select: { name: true } },
      teacher: { select: { name: true } },
    },
  });
  if (!cls) notFound();

  // Gate: view-all (quản lý) hoặc giáo viên phụ trách lớp (view-own).
  const canViewAll = await checkPermission("classes:view-all", { centerId: cls.centerId });
  const isOwnTeacher =
    (await checkPermission("classes:view-own", { centerId: cls.centerId, classId: cls.id })) &&
    cls.teacherId === session.user.id;
  if (!canViewAll && !isOwnTeacher) {
    redirect("/dashboard?error=unauthorized");
  }
  const canGenerateReports =
    hasRole(session.user, "SUPER_ADMIN") ||
    hasRole(session.user, "CENTER_MANAGER") ||
    (hasRole(session.user, "TEACHER") && cls.teacherId === session.user.id);

  // P0-3: GV (chỉ view-own) KHÔNG được nhận SĐT phụ huynh — chỉ quản lý/kế toán/CSM.
  const showParentContact = canViewParentContact(session.user);

  const [progresses, heldSessionsCount, gradebook] = await Promise.all([
    getClassProgress(id, showParentContact),
    // Buổi ĐÃ HUỶ không tính là đã diễn ra — khớp lib/progress.ts + lib/students/progress.ts,
    // nếu không thì con số ở thẻ đầu trang lệch với từng dòng học viên ngay bên dưới.
    sdb.classSession.count({
      where: { classId: id, date: { lte: now }, status: { not: "CANCELLED" } },
    }),
    getClassGradebook(id),
  ]);

  const avgAttendance =
    progresses.length > 0
      ? Math.round(
          progresses.reduce((s, p) => s + p.progress.attendanceRate, 0) /
            progresses.length,
        )
      : 0;

  const scored = progresses.filter((p) => p.progress.averageScore !== null);
  const avgScore =
    scored.length > 0
      ? Math.round(
          (scored.reduce(
            (s, p) => s + (p.progress.averageScore as number),
            0,
          ) /
            scored.length) *
            10,
        ) / 10
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/classes/${cls.id}/edit`}
            className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" /> Quay lại lớp
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <LineChart className="h-6 w-6 text-primary" />
            Tiến độ lớp: <span className="text-primary">{cls.name}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {cls.course.name} · {cls.center?.name ?? "—"}
            {cls.teacher?.name && ` · GV: ${cls.teacher.name}`}
          </p>
        </div>
        {canGenerateReports && progresses.length > 0 && (
          <GenerateReportsButton classId={cls.id} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Sĩ số đang học" value={String(progresses.length)} />
        <StatCard label="Buổi đã diễn ra" value={String(heldSessionsCount)} />
        <StatCard
          label="Điểm danh TB"
          value={heldSessionsCount === 0 ? "—" : `${avgAttendance}%`}
        />
        <StatCard
          label="Điểm TB lớp"
          value={avgScore !== null ? `${avgScore}/10` : "—"}
        />
      </div>

      <section className="rounded-xl border border-border bg-card shadow-sm">
        <header className="border-b border-border p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Tiến độ từng học viên
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            HS có status enrollment <strong>CONFIRMED / STUDYING / ACTIVE</strong>.
            Tỉ lệ điểm danh: ≥80% xanh · 60–79% vàng · &lt;60% đỏ.
          </p>
        </header>
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Học viên
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Điểm danh
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Bài học
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Bài tập
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Điểm TB
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Đề thi đạt
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {progresses.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Chưa có HS đang học trong lớp.
                  </td>
                </tr>
              ) : (
                progresses.map(({ student, progress }) => {
                  const attendanceColor =
                    progress.totalSessions === 0
                      ? "text-muted-foreground"
                      : progress.attendanceRate >= 80
                        ? "text-state-success-ink"
                        : progress.attendanceRate >= 60
                          ? "text-state-warning-ink"
                          : "text-state-danger-ink";
                  return (
                    <tr key={student.id} className="hover:bg-muted/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {student.avatarUrl ? (
                            <img
                              src={student.avatarUrl}
                              alt={student.name}
                              className="h-9 w-9 rounded-full border border-border object-cover"
                            />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                              {student.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-foreground">
                              {student.name}
                            </div>
                            {student.studentCode && (
                              <div className="text-[10px] text-muted-foreground tabular-nums">
                                {student.studentCode}
                              </div>
                            )}
                            {student.parentPhone && (
                              <div className="text-xs text-muted-foreground tabular-nums">
                                PH: {student.parentPhone}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td
                        className={`px-4 py-3 text-center font-semibold tabular-nums ${attendanceColor}`}
                      >
                        {progress.totalSessions === 0 ? (
                          <div className="text-xs font-normal text-muted-foreground">
                            Chưa diễn ra
                          </div>
                        ) : (
                          <>
                            <div>
                              {progress.attendedSessions}/{progress.totalSessions}
                            </div>
                            <div className="text-xs font-normal">
                              ({progress.attendanceRate}%)
                            </div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-sm tabular-nums text-foreground">
                        {progress.coveredLessons}/{progress.totalLessons}
                      </td>
                      <td className="px-4 py-3 text-center text-sm tabular-nums text-foreground">
                        {progress.submittedAssignments}/{progress.totalAssignments}
                        {progress.gradedAssignments > 0 && (
                          <span className="ml-1 text-xs text-state-success-ink">
                            ({progress.gradedAssignments}✓)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-sm tabular-nums font-semibold text-foreground">
                        {progress.averageScore !== null
                          ? `${progress.averageScore}/10`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-center text-sm tabular-nums text-foreground">
                        {progress.examAttempts > 0
                          ? `${progress.passedExams}/${progress.examAttempts}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/students/${student.id}/edit`}
                          className="text-xs font-semibold text-primary hover:underline"
                        >
                          Chi tiết →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </section>

      {/* Lộ trình giáo trình (Phase T2.1) */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <header className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Lộ trình giáo trình
          </h2>
          <span className="text-xs font-medium text-muted-foreground">
            {gradebook.coveredLessons}/{gradebook.totalLessons} bài ·{" "}
            {gradebook.lessonCoverageRate}%
          </span>
        </header>
        <div className="p-4">
          {gradebook.lessons.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Khoá học chưa có giáo trình (curriculum) đang hoạt động.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {gradebook.lessons.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm"
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ l.taught ? "bg-state-success-soft text-state-success-ink" : "bg-muted text-muted-foreground" }`}
                  >
                    {l.order}
                  </span>
                  <span
                    className={
                      l.taught ? "text-foreground" : "text-muted-foreground"
                    }
                  >
                    {l.title}
                  </span>
                  {l.taught && l.sessionDate && (
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      Đã dạy {formatDateVN(l.sessionDate)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {/* Bảng điểm lớp (Phase T2.1) */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <header className="border-b border-border p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Bảng điểm lớp
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ma trận học viên × đề thi/bài tập đã giao. Ô hiện điểm thô hoặc trạng thái.
          </p>
        </header>
        <div className="overflow-x-auto">
          {gradebook.columns.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Lớp chưa có đề thi hoặc bài tập nào được giao (PUBLISHED).
            </p>
          ) : (
            <PhanTrangBang>
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Học viên
                    </th>
                    {gradebook.columns.map((c) => (
                      <th
                        key={c.id}
                        className="px-3 py-3 text-center text-xs font-semibold text-muted-foreground"
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ c.kind === "exam" ? "bg-primary-soft text-primary" : "bg-primary-soft text-primary" }`}
                          >
                            {c.kind === "exam" ? "Đề" : "BT"}
                          </span>
                          <span className="max-w-[120px] truncate font-medium normal-case text-foreground">
                            {c.title}
                          </span>
                          <span className="text-[10px] font-normal text-muted-foreground">
                            /{c.totalPoints}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {gradebook.rows.map((r) => (
                    <tr key={r.studentId} className="hover:bg-muted/60">
                      <td className="sticky left-0 z-10 bg-card px-4 py-2 font-medium text-foreground">
                        {r.name}
                        {r.studentCode && (
                          <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                            {r.studentCode}
                          </span>
                        )}
                      </td>
                      {gradebook.columns.map((c) => {
                        const cell = r.cells[c.id];
                        const label =
                          c.kind === "exam"
                            ? EXAM_STATUS_VI[cell.status] ?? cell.status
                            : SUB_STATUS_VI[cell.status] ?? cell.status;
                        return (
                          <td
                            key={c.id}
                            className="px-3 py-2 text-center tabular-nums"
                          >
                            {cell.score !== null ? (
                              <span
                                className={`font-semibold ${ cell.passed === false ? "text-state-danger-ink" : "text-foreground" }`}
                              >
                                {cell.score}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {label}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </PhanTrangBang>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
