import { redirect } from "next/navigation";
import { safeCache } from "@/lib/cache/safe-cache";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { actorScopeKey } from "@/lib/cache/scope-key";
import {
  resolveReportFilters,
  reportFilterCacheKey,
  reportDateWhere,
  type ReportFilters,
} from "@/lib/reports/filters";
import { ReportFilterBar } from "@/components/admin/report-filter-bar";
import { BarChart } from "@/components/charts/bar-chart";
import {
  computeTrainingReport,
  type AttendanceRecord,
  type ClassRecord,
  type HomeworkRecord,
  type LessonRecord,
} from "@/lib/reports/dao-tao";
import type {
  AttendanceStatusValue,
  MakeupStatusValue,
  SessionStatusValue,
} from "@/lib/labels";
import type { HomeworkAssignmentStatusValue } from "@/lib/reports/dao-tao";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Báo cáo đào tạo | Admin" };
export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-state-success-ink"
      : tone === "warn"
        ? "text-state-warning-ink"
        : tone === "bad"
          ? "text-state-danger-ink"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

type SearchParams = {
  searchParams: Promise<{
    center?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
};

export default async function TrainingReportPage({
  searchParams,
}: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate: quản lý đào tạo / xem lớp (Đào tạo + quản lý cơ sở + Admin).
  if (!(await checkAnyPermission(PAGE_GATES["/bao-cao/dao-tao"]))) {
    redirect("/dashboard");
  }

  const actor = await resolveActor(session.user.id);
  const sp = await searchParams;
  const fc = await resolveReportFilters(actor, sp);

  // REQ-05: cache phần nặng (nhiều query + reduce) theo scope + BỘ LỌC. TTL 120s. Output primitive.
  const report = await safeCache(
    () => loadTrainingReport(actor, fc.filters),
    ["dao-tao-report", actorScopeKey(actor), reportFilterCacheKey(fc.filters)],
    { tags: [CACHE_TAGS.report], revalidate: 120 },
  )();

  // Top lớp theo chuyên cần (sắp giảm dần) cho bar-chart — giới hạn 12 để mobile gọn.
  const chartData = [...report.perClass]
    .filter((c) => c.counted > 0)
    .sort((a, b) => b.attendanceRate - a.attendanceRate)
    .slice(0, 12)
    .map((c) => ({
      name: c.classCode ?? c.className,
      "Chuyên cần (%)": c.attendanceRate,
    }));

  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Báo cáo đào tạo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chuyên cần, bài tập và học bù theo cơ sở
        </p>
      </div>

      <PageHelp>
        <p>
          Chuyên cần, hoàn thành bài tập, buổi thiếu đề thi và ca học bù — theo
          phạm vi cơ sở của bạn.
        </p>
      </PageHelp>

      <ReportFilterBar
        basePath="/bao-cao/dao-tao"
        centers={fc.visibleCenters}
        selection={fc.selection}
        dateFrom={fc.dateFromStr}
        dateTo={fc.dateToStr}
        allowAll={fc.isGlobalAllowed}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Tỷ lệ chuyên cần"
          value={`${report.overallAttendanceRate}%`}
          hint={`${report.totalClasses} lớp trong phạm vi`}
          tone={report.overallAttendanceRate >= 80 ? "good" : "warn"}
        />
        <Stat
          label="Hoàn thành bài tập"
          value={`${report.homeworkCompletionRate}%`}
          hint={`${report.homeworkCompleted}/${report.homeworkTotal} bài`}
          tone={report.homeworkCompletionRate >= 80 ? "good" : "warn"}
        />
        <Stat
          label="Bài giảng thiếu đề thi"
          value={`${report.lessonsMissingExam}`}
          hint={`trên ${report.lessonsTotal} bài giảng · toàn chương trình (không lọc theo cơ sở)`}
          tone={report.lessonsMissingExam > 0 ? "bad" : "good"}
        />
        <Stat
          label="Ca học bù"
          value={`${report.makeupMadeUp + report.makeupNeeded}`}
          hint={`${report.makeupMadeUp} đã bù · ${report.makeupNeeded} chờ bù`}
          tone={report.makeupNeeded > 0 ? "warn" : "neutral"}
        />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Tỷ lệ chuyên cần theo lớp
        </h2>
        {chartData.length > 0 ? (
          <BarChart
            data={chartData}
            xKey="name"
            bars={[
              {
                key: "Chuyên cần (%)",
                name: "Chuyên cần (%)",
                color: "#7C3AED",
              },
            ]}
            height={300}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Chưa có dữ liệu điểm danh trong kỳ.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Chi tiết theo lớp
          </h2>
        </div>
        <PhanTrangBang cuonNgang>
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Lớp</th>
                <th className="px-4 py-2 text-right">Buổi tính</th>
                <th className="px-4 py-2 text-right">Đi học</th>
                <th className="px-4 py-2 text-right">Vắng</th>
                <th className="px-4 py-2 text-right">Chờ bù</th>
                <th className="px-4 py-2 text-right">Đã bù</th>
                <th className="px-4 py-2 text-right">Chuyên cần</th>
              </tr>
            </thead>
            <tbody>
              {report.perClass.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    Không có lớp trong phạm vi cơ sở.
                  </td>
                </tr>
              ) : (
                report.perClass.map((c) => (
                  <tr key={c.classId} className="border-t">
                    <td className="px-4 py-2 font-medium">
                      {c.classCode ? (
                        <span className="text-muted-foreground">
                          {c.classCode} ·{" "}
                        </span>
                      ) : null}
                      {c.className}
                    </td>
                    <td className="px-4 py-2 text-right">{c.counted}</td>
                    <td className="px-4 py-2 text-right text-state-success-ink">
                      {c.attended}
                    </td>
                    <td className="px-4 py-2 text-right text-state-danger-ink">
                      {c.absent}
                    </td>
                    <td className="px-4 py-2 text-right text-state-warning-ink">
                      {c.needMakeup}
                    </td>
                    <td className="px-4 py-2 text-right text-primary">
                      {c.madeUp}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {c.counted > 0 ? `${c.attendanceRate}%` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </section>
    </div>
  );
}

// REQ-05: tính báo cáo đào tạo (fetch scoped + reduce thuần → object PRIMITIVE).
// filters: cơ sở (class.centerId) + khoảng ngày trên NGÀY BUỔI HỌC (ClassSession.date)
// — buổi là thực thể mang mốc thời gian của báo cáo (điểm danh/bài tập gắn theo buổi).
// Bộ lọc null → giữ nguyên hành vi cũ.
async function loadTrainingReport(actor: Actor, filters: ReportFilters) {
  // Class auto-scoped theo cơ sở (HO/SUPER_ADMIN bypass). Các model KHÔNG scoped
  // (Attendance/ClassSession/HomeworkAssignment/Lesson) đi qua sdb pass-through —
  // tránh import @/lib/db trần (R6-F1); cách ly cơ sở đảm bảo bằng lọc classIds.
  const sdb = scopedDb(actor);
  const dateWhere = reportDateWhere(filters);

  // 1. Lớp trong phạm vi cơ sở (thu hẹp thêm theo cơ sở đã chọn — đã validate IDOR).
  const classRows = await sdb.class.findMany({
    where: {
      deletedAt: null,
      ...(filters.centerId ? { centerId: filters.centerId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, name: true, classCode: true },
  });
  const classIds = classRows.map((c) => c.id);
  const classes: ClassRecord[] = classRows.map((c) => ({
    id: c.id,
    name: c.name,
    classCode: c.classCode,
  }));

  // 2. Điểm danh các buổi của những lớp này (qua session.classId — ClassSession
  // không scoped, nên LỌC THỦ CÔNG theo classIds đã scope ở trên — AC5).
  const attendanceRows = classIds.length
    ? await sdb.attendance.findMany({
        where: {
          session: {
            classId: { in: classIds },
            ...(dateWhere ? { date: dateWhere } : {}),
          },
        },
        select: {
          status: true,
          makeupStatus: true,
          session: { select: { classId: true, status: true } },
        },
      })
    : [];
  const attendances: AttendanceRecord[] = attendanceRows.map((a) => ({
    classId: a.session.classId,
    status: a.status as AttendanceStatusValue,
    makeupStatus: a.makeupStatus as MakeupStatusValue,
    sessionStatus: a.session.status as SessionStatusValue,
  }));

  // 3. Bài tập giao. HomeworkAssignment KHÔNG có relation tới ClassSession (chỉ cột
  // phẳng classSessionId) → lấy map sessionId→classId từ ClassSession của các lớp,
  // rồi lọc homework theo sessionIds. ClassSession không scoped → lọc theo classIds.
  const sessionRows = classIds.length
    ? await sdb.classSession.findMany({
        where: {
          classId: { in: classIds },
          ...(dateWhere ? { date: dateWhere } : {}),
        },
        select: { id: true, classId: true },
      })
    : [];
  const sessionToClass = new Map(sessionRows.map((s) => [s.id, s.classId]));
  const sessionIds = sessionRows.map((s) => s.id);
  const homeworkRows = sessionIds.length
    ? await sdb.homeworkAssignment.findMany({
        where: { classSessionId: { in: sessionIds } },
        select: { status: true, classSessionId: true },
      })
    : [];
  const homework: HomeworkRecord[] = homeworkRows.map((h) => ({
    classId: sessionToClass.get(h.classSessionId) ?? "",
    status: h.status as HomeworkAssignmentStatusValue,
  }));

  // 4. Bài giảng (Lesson) + cờ thiếu đề thi (không có Exam liên kết). Lesson không
  // scoped theo cơ sở (thuộc Curriculum dùng chung) → lấy toàn bộ chưa archive.
  const lessonRows = await sdb.lesson.findMany({
    where: { archivedAt: null },
    orderBy: [{ curriculumId: "asc" }, { order: "asc" }],
    take: 1000,
    select: { id: true, title: true, _count: { select: { exams: true } } },
  });
  const lessons: LessonRecord[] = lessonRows.map((l) => ({
    id: l.id,
    title: l.title,
    hasExam: l._count.exams > 0,
  }));

  return computeTrainingReport({ classes, attendances, homework, lessons });
}
