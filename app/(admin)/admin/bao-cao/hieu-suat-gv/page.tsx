import { redirect } from "next/navigation";
import { safeCache } from "@/lib/cache/safe-cache";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { actorScopeKey } from "@/lib/cache/scope-key";
import { BarChart } from "@/components/charts/bar-chart";
import {
  buildTeacherPerformanceReport,
  type EnrollmentStatusValue,
  type TeacherAttendanceRecord,
  type TeacherEnrollmentRecord,
  type TeacherInfo,
  type TeacherScoreRecord,
  type TeacherSessionRecord,
} from "@/lib/reports/teacher-performance";
import type {
  AttendanceStatusValue,
  MakeupStatusValue,
  SessionStatusValue,
} from "@/lib/labels";
import {
  resolveReportFilters,
  reportFilterCacheKey,
  reportDateWhere,
  type ReportFilters,
} from "@/lib/reports/filters";
import { giaoVienDuocQuyCong } from "@/lib/lms/session-ownership";
import { ReportFilterBar } from "@/components/admin/report-filter-bar";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Báo cáo hiệu suất GV | Admin" };
export const dynamic = "force-dynamic";

const num = (n: number) => n.toLocaleString("vi-VN");

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default async function TeacherPerformanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    center?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate: quản lý đào tạo / xem lớp (Đào tạo + quản lý cơ sở + Admin).
  if (!(await checkAnyPermission(PAGE_GATES["/bao-cao/hieu-suat-gv"]))) {
    redirect("/dashboard");
  }

  const actor = await resolveActor(session.user.id);
  const sp = await searchParams;
  const fc = await resolveReportFilters(actor, sp);

  // REQ-05: cache phần nặng (nhiều query + reduce) theo scope + bộ lọc. TTL 120s. Output primitive.
  const report = await safeCache(
    () => computeTeacherPerformanceReport(actor, fc.filters),
    [
      "teacher-performance-report",
      actorScopeKey(actor),
      reportFilterCacheKey(fc.filters),
    ],
    { tags: [CACHE_TAGS.report], revalidate: 120 },
  )();

  const chartData = report.rows
    .filter((r) => r.sessionsTaught > 0)
    .slice(0, 12)
    .map((r) => ({ name: r.teacherName, "Buổi đã dạy": r.sessionsTaught }));

  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">
          Báo cáo hiệu suất giáo viên
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Buổi dạy, chuyên cần và điểm học bạ theo giáo viên
        </p>
      </div>

      <PageHelp>
        <p>
          Số buổi đã dạy, chuyên cần lớp phụ trách, số học viên và điểm học bạ
          trung bình — theo phạm vi cơ sở của bạn.
        </p>
      </PageHelp>

      <ReportFilterBar
        basePath="/bao-cao/hieu-suat-gv"
        centers={fc.visibleCenters}
        selection={fc.selection}
        dateFrom={fc.dateFromStr}
        dateTo={fc.dateToStr}
        allowAll={fc.isGlobalAllowed}
      />

      <Card title="Số buổi đã dạy theo giáo viên">
        {chartData.length > 0 ? (
          <BarChart
            data={chartData}
            xKey="name"
            bars={[
              { key: "Buổi đã dạy", name: "Buổi đã dạy", color: "#F97316" },
            ]}
            height={300}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Chưa có buổi học hoàn tất trong phạm vi.
          </p>
        )}
      </Card>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Chi tiết theo giáo viên
          </h2>
        </div>
        <PhanTrangBang cuonNgang>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Giáo viên</th>
                <th className="px-4 py-2 text-right">Buổi đã dạy</th>
                <th className="px-4 py-2 text-right">Chuyên cần</th>
                <th className="px-4 py-2 text-right">Học viên</th>
                <th className="px-4 py-2 text-right">Điểm học bạ TB</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    Không có giáo viên phụ trách lớp trong phạm vi cơ sở.
                  </td>
                </tr>
              ) : (
                report.rows.map((r) => (
                  <tr key={r.teacherId} className="border-t">
                    <td className="px-4 py-2 font-medium">{r.teacherName}</td>
                    <td className="px-4 py-2 text-right">
                      {num(r.sessionsTaught)}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {r.attendanceCounted > 0 ? `${r.attendanceRate}%` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {num(r.studentCount)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.avgReportScore != null ? `${r.avgReportScore}/4` : "—"}
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

// REQ-05: tính báo cáo hiệu suất GV (fetch scoped + reduce thuần → object PRIMITIVE).
async function computeTeacherPerformanceReport(
  actor: Actor,
  filters: ReportFilters,
) {
  // Class auto-scoped theo cơ sở (HO/SUPER_ADMIN bypass). Các model KHÔNG scoped
  // (ClassSession/Attendance/ReportCard*) đi qua sdb pass-through nhưng LỌC THỦ CÔNG
  // theo classIds/enrollmentIds đã scope → giữ cách ly cơ sở (AC5).
  const sdb = scopedDb(actor);
  // Bộ lọc cơ sở (IDOR-safe) áp vào Class (→ lan xuống buổi/điểm danh/ghi danh qua classIds);
  // ngày áp vào ClassSession.date (trục "số buổi đã dạy"/chuyên cần). null → no-op (giữ hành vi cũ).
  const dateWhere = reportDateWhere(filters);

  // 1. Lớp trong phạm vi cơ sở + GV phụ trách.
  const classRows = await sdb.class.findMany({
    where: {
      deletedAt: null,
      ...(filters.centerId ? { centerId: filters.centerId } : {}),
    },
    take: 500,
    select: { id: true, teacherId: true },
  });
  const classIds = classRows.map((c) => c.id);
  const classToTeacher = new Map<string, string>();
  for (const c of classRows)
    if (c.teacherId) classToTeacher.set(c.id, c.teacherId);

  // QRY-16: 3 query dưới CHỈ phụ thuộc classIds → chạy song song (thay 3 await tuần tự).
  const [sessionRows, attendanceRows, enrollmentRows] = await Promise.all([
    // 2. Buổi học của các lớp này (ClassSession không scoped → lọc theo classIds + ngày buổi).
    classIds.length
      ? sdb.classSession.findMany({
          where: {
            classId: { in: classIds },
            ...(dateWhere ? { date: dateWhere } : {}),
          },
          select: {
            classId: true,
            status: true,
            actualTeacherId: true,
            // Cột này TỪNG THIẾU ở đây — không select thì `giaoVienDuocQuyCong` nhận
            // `undefined` và bug quay lại im lặng.
            substituteTeacherId: true,
          },
        })
      : Promise.resolve([]),
    // 3. Điểm danh các buổi của những lớp này (lọc theo ngày buổi qua quan hệ session).
    classIds.length
      ? sdb.attendance.findMany({
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
      : Promise.resolve([]),
    // 4. Ghi danh thuộc các lớp này (đếm HV + bắc cầu tới học bạ).
    classIds.length
      ? sdb.enrollment.findMany({
          where: { classId: { in: classIds }, deletedAt: null },
          select: { id: true, studentId: true, classId: true, status: true },
        })
      : Promise.resolve([]),
  ]);
  const enrollmentToClass = new Map(
    enrollmentRows.map((e) => [e.id, e.classId]),
  );
  const enrollmentIds = enrollmentRows.map((e) => e.id);

  // 5. Học bạ + điểm tiêu chí (ReportCard ∈ SCOPED_MODELS #03 Pha B — filter
  //    enrollmentIds đã scope vẫn giữ, auto-scope chỉ là lớp bọc thêm).
  const reportCardRows = enrollmentIds.length
    ? await sdb.reportCard.findMany({
        where: { enrollmentId: { in: enrollmentIds } },
        select: { id: true, enrollmentId: true, teacherId: true },
      })
    : [];
  const reportCardToTeacher = new Map<string, string>();
  for (const rc of reportCardRows) {
    const teacherId =
      rc.teacherId ??
      classToTeacher.get(enrollmentToClass.get(rc.enrollmentId) ?? "");
    if (teacherId) reportCardToTeacher.set(rc.id, teacherId);
  }
  const reportCardIds = reportCardRows.map((rc) => rc.id);
  const scoreRows = reportCardIds.length
    ? await sdb.reportCardScore.findMany({
        where: { reportCardId: { in: reportCardIds } },
        select: { reportCardId: true, level: true },
      })
    : [];

  // 6. GV cần đưa vào báo cáo = GV phụ trách lớp ∪ GV được QUY CÔNG buổi.
  //
  // ⚠️ Trước 08/09/2026 chỗ này viết `actualTeacherId ?? classToTeacher.get(classId)` —
  // BỎ SÓT `substituteTeacherId`. Mỗi lần quản lý đổi giáo viên cho một buổi
  // (`lib/classes/adjust.ts:245`), buổi ấy bị quy công cho người KHÔNG dạy. Luật quy
  // công ở MỘT chỗ: `giaoVienDuocQuyCong` (`lib/lms/session-ownership.ts`).
  const teacherIdSet = new Set<string>(classToTeacher.values());
  for (const s of sessionRows) {
    const tId =
      giaoVienDuocQuyCong({
        actualTeacherId: s.actualTeacherId,
        substituteTeacherId: s.substituteTeacherId,
      }) ?? classToTeacher.get(s.classId);
    if (tId) teacherIdSet.add(tId);
  }
  const teacherIds = [...teacherIdSet];
  // User KHÔNG thuộc SCOPED_MODELS → sdb pass-through (chỉ lấy id→tên gắn nhãn).
  const userRows = teacherIds.length
    ? await sdb.user.findMany({
        where: { id: { in: teacherIds } },
        select: { id: true, name: true },
      })
    : [];
  const teachers: TeacherInfo[] = userRows.map((u) => ({
    id: u.id,
    name: u.name,
  }));

  // ── Gắn teacherId vào từng record cho hàm THUẦN ────────────────────────────
  const sessions: TeacherSessionRecord[] = [];
  for (const s of sessionRows) {
    // Cùng luật với vòng ở trên — hai chỗ tính lệch nhau là báo cáo tự mâu thuẫn.
    const teacherId =
      giaoVienDuocQuyCong({
        actualTeacherId: s.actualTeacherId,
        substituteTeacherId: s.substituteTeacherId,
      }) ?? classToTeacher.get(s.classId);
    if (teacherId)
      sessions.push({ teacherId, status: s.status as SessionStatusValue });
  }

  const attendances: TeacherAttendanceRecord[] = [];
  for (const a of attendanceRows) {
    const teacherId = classToTeacher.get(a.session.classId);
    if (teacherId) {
      attendances.push({
        teacherId,
        status: a.status as AttendanceStatusValue,
        makeupStatus: a.makeupStatus as MakeupStatusValue,
        sessionStatus: a.session.status as SessionStatusValue,
      });
    }
  }

  const enrollments: TeacherEnrollmentRecord[] = [];
  for (const e of enrollmentRows) {
    const teacherId = classToTeacher.get(e.classId);
    if (teacherId) {
      enrollments.push({
        teacherId,
        studentId: e.studentId,
        status: e.status as EnrollmentStatusValue,
      });
    }
  }

  const scores: TeacherScoreRecord[] = [];
  for (const sc of scoreRows) {
    const teacherId = reportCardToTeacher.get(sc.reportCardId);
    if (teacherId) scores.push({ teacherId, level: sc.level });
  }

  return buildTeacherPerformanceReport({
    teachers,
    sessions,
    attendances,
    enrollments,
    scores,
  });
}
