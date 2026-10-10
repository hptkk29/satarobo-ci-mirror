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
import { LineChart } from "@/components/charts/line-chart";
import {
  buildCohortReport,
  type CohortEnrollmentRecord,
  type EnrollmentStatusValue,
} from "@/lib/reports/cohort";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Báo cáo cohort | Admin" };
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

// REQ-05: tính báo cáo cohort (fetch scoped + reduce thuần → object PRIMITIVE).
// filters: cơ sở (class.centerId) + khoảng ngày trên MỐC BẮT ĐẦU cohort
// (startedAt ?? enrolledAt). Bộ lọc null → giữ nguyên hành vi cũ.
async function computeCohortReport(actor: Actor, filters: ReportFilters) {
  // Class auto-scoped theo cơ sở (HO/SUPER_ADMIN bypass). ClassSession/Enrollment
  // đi qua sdb pass-through nhưng LỌC THỦ CÔNG theo classIds đã scope (AC5).
  const sdb = scopedDb(actor);
  const dateWhere = reportDateWhere(filters);

  // 1. Lớp trong phạm vi cơ sở (thu hẹp thêm theo cơ sở đã chọn — đã validate IDOR).
  const classRows = await sdb.class.findMany({
    where: {
      deletedAt: null,
      ...(filters.centerId ? { centerId: filters.centerId } : {}),
    },
    take: 1000,
    select: { id: true },
  });
  const classIds = classRows.map((c) => c.id);

  // 2. Tiến độ buổi theo lớp (loại buổi hủy khỏi tổng).
  const sessionRows = classIds.length
    ? await sdb.classSession.findMany({
        where: { classId: { in: classIds } },
        select: { classId: true, status: true },
      })
    : [];
  const classProgress = new Map<string, { total: number; completed: number }>();
  for (const s of sessionRows) {
    if (s.status === "CANCELLED") continue;
    const cur = classProgress.get(s.classId) ?? { total: 0, completed: 0 };
    cur.total++;
    if (s.status === "COMPLETED") cur.completed++;
    classProgress.set(s.classId, cur);
  }

  // 3. Ghi danh — nhóm theo kỳ bắt đầu (startedAt ?? enrolledAt). Lọc ngày theo cùng
  // mốc bắt đầu: startedAt trong khoảng, hoặc (startedAt null → dùng enrolledAt).
  const enrollmentRows = classIds.length
    ? await sdb.enrollment.findMany({
        where: {
          classId: { in: classIds },
          deletedAt: null,
          ...(dateWhere
            ? {
                OR: [
                  { startedAt: dateWhere },
                  { startedAt: null, enrolledAt: dateWhere },
                ],
              }
            : {}),
        },
        select: {
          classId: true,
          status: true,
          enrolledAt: true,
          startedAt: true,
        },
        take: 50_000,
      })
    : [];

  const records: CohortEnrollmentRecord[] = enrollmentRows.map((e) => {
    const prog = classProgress.get(e.classId) ?? { total: 0, completed: 0 };
    return {
      cohortDate: e.startedAt ?? e.enrolledAt,
      status: e.status as EnrollmentStatusValue,
      totalSessions: prog.total,
      completedSessions: prog.completed,
    };
  });

  return buildCohortReport(records);
}

type SearchParams = {
  searchParams: Promise<{
    center?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
};

export default async function CohortReportPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate: quản lý đào tạo / xem lớp (Đào tạo + quản lý cơ sở + Admin).
  if (!(await checkAnyPermission(PAGE_GATES["/bao-cao/cohort"]))) {
    redirect("/dashboard");
  }

  const actor = await resolveActor(session.user.id);
  const sp = await searchParams;
  const fc = await resolveReportFilters(actor, sp);

  // REQ-05: cache cross-request keyed THEO SCOPE + BỘ LỌC (không leak giữa cơ sở). TTL 120s.
  const report = await safeCache(
    () => computeCohortReport(actor, fc.filters),
    ["cohort-report", actorScopeKey(actor), reportFilterCacheKey(fc.filters)],
    { tags: [CACHE_TAGS.report], revalidate: 120 },
  )();

  const progressData = report.rows.map((r) => ({
    name: r.cohort,
    "Tiến độ TB (%)": r.avgProgress,
  }));
  const statusData = report.rows.map((r) => ({
    name: r.cohort,
    "Hoàn thành": r.completed,
    "Đang học": r.studying,
    Rút: r.withdrew,
  }));

  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Báo cáo cohort</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tiến độ và tỷ lệ hoàn thành theo kỳ nhập học
        </p>
      </div>

      <PageHelp>
        <p>
          Nhóm ghi danh theo kỳ bắt đầu — tiến độ trung bình và tỷ lệ hoàn thành
          / đang học / rút, theo phạm vi cơ sở của bạn.
        </p>
      </PageHelp>

      <ReportFilterBar
        basePath="/bao-cao/cohort"
        centers={fc.visibleCenters}
        selection={fc.selection}
        dateFrom={fc.dateFromStr}
        dateTo={fc.dateToStr}
        allowAll={fc.isGlobalAllowed}
      />

      {report.totalEnrollments === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Chưa có ghi danh trong phạm vi của bạn.
        </p>
      ) : null}

      <Card title="Tiến độ trung bình theo cohort">
        {progressData.length > 0 ? (
          <LineChart
            data={progressData}
            xKey="name"
            lines={[
              {
                key: "Tiến độ TB (%)",
                name: "Tiến độ TB (%)",
                color: "#7C3AED",
              },
            ]}
            height={300}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Chưa có dữ liệu.
          </p>
        )}
      </Card>

      <Card title="Trạng thái học viên theo cohort">
        {statusData.length > 0 ? (
          <BarChart
            data={statusData}
            xKey="name"
            bars={[
              { key: "Hoàn thành", name: "Hoàn thành", color: "#10B981" },
              { key: "Đang học", name: "Đang học", color: "#F97316" },
              { key: "Rút", name: "Rút", color: "#EF4444" },
            ]}
            height={300}
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Chưa có dữ liệu.
          </p>
        )}
      </Card>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Chi tiết theo cohort
          </h2>
        </div>
        <PhanTrangBang cuonNgang>
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Kỳ bắt đầu</th>
                <th className="px-4 py-2 text-right">Ghi danh</th>
                <th className="px-4 py-2 text-right">Tiến độ TB</th>
                <th className="px-4 py-2 text-right">Hoàn thành</th>
                <th className="px-4 py-2 text-right">Đang học</th>
                <th className="px-4 py-2 text-right">Rút</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    Không có ghi danh trong phạm vi cơ sở.
                  </td>
                </tr>
              ) : (
                report.rows.map((r) => (
                  <tr key={r.cohort} className="border-t">
                    <td className="px-4 py-2 font-medium">{r.cohort}</td>
                    <td className="px-4 py-2 text-right">{num(r.total)}</td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {r.avgProgress}%
                    </td>
                    <td className="px-4 py-2 text-right text-state-success-ink">
                      {num(r.completed)}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({r.completionRate}%)
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-primary">
                      {num(r.studying)}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({r.studyingRate}%)
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-state-danger-ink">
                      {num(r.withdrew)}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({r.withdrewRate}%)
                      </span>
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
