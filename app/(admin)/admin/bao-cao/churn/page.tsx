import { redirect } from "next/navigation";
import { safeCache } from "@/lib/cache/safe-cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { actorScopeKey } from "@/lib/cache/scope-key";
import { buildChurnReport, type ChurnEnrollmentRecord } from "@/lib/reports/churn";
import {
  resolveReportFilters,
  reportFilterCacheKey,
  reportDateWhere,
  type ReportFilters,
} from "@/lib/reports/filters";
import { ReportFilterBar } from "@/components/admin/report-filter-bar";
import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Báo cáo churn / rời lớp | Admin" };
export const dynamic = "force-dynamic";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const num = (n: number) => n.toLocaleString("vi-VN");

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

// REQ-05: tính báo cáo churn (fetch scoped + reduce thuần → object PRIMITIVE).
async function computeChurnReport(actor: Actor, filters: ReportFilters) {
  const sdb = scopedDb(actor);
  const dateWhere = reportDateWhere(filters); // lọc theo Enrollment.startedAt.

  // Class LÀ model scoped → trả về CHỈ lớp trong tầm nhìn cơ sở. Bộ lọc cơ sở giới
  // hạn thêm tập lớp về đúng 1 cơ sở đã chọn. Enrollment KHÔNG có centerId (không
  // auto-scope) → cách ly bằng cách giới hạn theo classId của các lớp đã scoped +
  // suy centerId từ map class→center (AC: cách ly cơ sở).
  const classes = await sdb.class.findMany({
    where: filters.centerId ? { centerId: filters.centerId } : undefined,
    select: { id: true, centerId: true },
  });
  const classIds = classes.map((c) => c.id);
  const classCenter = new Map(classes.map((c) => [c.id, c.centerId]));

  const [enrollments, centers] = await Promise.all([
    classIds.length
      ? sdb.enrollment.findMany({
          where: {
            classId: { in: classIds },
            deletedAt: null,
            // ⚠️ VÁ 04/09/2026 — điều kiện lọc phải PHẢN CHIẾU ĐÚNG mốc mà phần
            // tính dùng: `startedAt ?? enrolledAt` (xem dòng dựng `startedAt`
            // bên dưới).
            //
            // Bản cũ lọc thuần `startedAt`, nên ghi danh chưa có ngày bắt đầu bị
            // loại NGAY Ở TRUY VẤN dù báo cáo sẵn sàng dùng `enrolledAt` của
            // chúng. Đo trên dữ liệu thật: 109/522 ghi danh (**20,9%**) không có
            // `startedAt` — và cả 109 đều có `enrolledAt`. Tức cứ đặt khoảng ngày
            // là mất một phần năm dữ liệu, cho ra tỉ lệ churn cao/thấp giả mà
            // không có dấu hiệu nào.
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
            status: true,
            classId: true,
            startedAt: true,
            enrolledAt: true,
            endedAt: true,
            updatedAt: true,
          },
          take: 50_000,
        })
      : Promise.resolve([]),
    sdb.center.findMany({ select: { id: true, name: true } }),
  ]);

  const centerNames = Object.fromEntries(centers.map((c) => [c.id, c.name]));
  const records: ChurnEnrollmentRecord[] = enrollments.map((e) => ({
    status: e.status,
    centerId: classCenter.get(e.classId) ?? null,
    startedAt: e.startedAt ?? e.enrolledAt,
    // WITHDREW nhưng thiếu endedAt → KPI đếm (theo status) nhưng bảng theo tháng bỏ
    // qua (cần mốc để xếp kỳ) ⇒ lệch "1 · 16.7%" vs bảng 0. Dùng updatedAt (≈ lúc
    // đổi sang WITHDREW) làm mốc kết thúc dự phòng để 2 con số khớp nhau.
    endedAt: e.endedAt ?? (e.status === "WITHDREW" ? e.updatedAt : null),
  }));

  return buildChurnReport(records, centerNames);
}

export default async function ChurnReportPage({
  searchParams,
}: {
  searchParams: Promise<{ center?: string; dateFrom?: string; dateTo?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("enrollments:view-all"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const actor = await resolveActor(session.user.id);
  const sp = await searchParams;
  const fc = await resolveReportFilters(actor, sp);

  // REQ-05: cache cross-request keyed THEO SCOPE (không leak giữa cơ sở) + bộ lọc. TTL 120s.
  const report = await safeCache(
    () => computeChurnReport(actor, fc.filters),
    ["churn-report", actorScopeKey(actor), reportFilterCacheKey(fc.filters)],
    { tags: [CACHE_TAGS.report], revalidate: 120 },
  )();

  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Báo cáo churn / rời lớp</h1>
        <p className="text-sm text-muted-foreground">
          Tỉ lệ học viên rời lớp theo kỳ và theo cơ sở — mẫu số là số đang học ở đầu kỳ.
        </p>
      </div>

      <ReportFilterBar
        basePath="/bao-cao/churn"
        centers={fc.visibleCenters}
        selection={fc.selection}
        dateFrom={fc.dateFromStr}
        dateTo={fc.dateToStr}
        allowAll={fc.isGlobalAllowed}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tổng ghi danh" value={num(report.summary.total)} />
        <Stat label="Đang học" value={num(report.summary.active)} />
        <Stat
          label="Đã rời lớp"
          value={num(report.summary.withdrew)}
          hint={`Tỉ lệ rời ${pct(report.summary.churnRate)}`}
        />
        <Stat label="Đã hoàn thành" value={num(report.summary.completed)} />
      </div>

      {report.summary.total === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Chưa có dữ liệu ghi danh trong phạm vi của bạn.
        </p>
      ) : null}

      {/* Xu hướng theo tháng */}
      <Card title="Xu hướng rời lớp theo tháng">
        <LineChart
          data={report.byMonth.map((m) => ({
            name: m.period,
            "Đang học đầu kỳ": m.activeAtStart,
            "Rời lớp": m.withdrew,
          }))}
          xKey="name"
          lines={[
            { key: "Đang học đầu kỳ", name: "Đang học đầu kỳ", color: "#7C3AED" },
            { key: "Rời lớp", name: "Rời lớp", color: "#F97316" },
          ]}
          height={300}
        />
      </Card>

      {/* Bảng tỉ lệ churn theo tháng */}
      <Card title="Tỉ lệ churn theo tháng">
        <PhanTrangBang cuonNgang>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Kỳ</th>
                <th className="px-3 py-2 text-right">Đang học đầu kỳ</th>
                <th className="px-3 py-2 text-right">Rời lớp</th>
                <th className="px-3 py-2 text-right">Tỉ lệ churn</th>
              </tr>
            </thead>
            <tbody>
              {report.byMonth.map((m) => (
                <tr key={m.period} className="border-t">
                  <td className="px-3 py-2">{m.period}</td>
                  <td className="px-3 py-2 text-right">{num(m.activeAtStart)}</td>
                  <td className="px-3 py-2 text-right">{num(m.withdrew)}</td>
                  {/* Không có ai "đang học đầu kỳ" → tỉ lệ không xác định, hiện "—"
                      thay vì "0.0%" (chia cho 0) gây hiểu nhầm là không có ai rời. */}
                  <td className="px-3 py-2 text-right font-medium">
                    {m.activeAtStart > 0 ? pct(m.churnRate) : "—"}
                  </td>
                </tr>
              ))}
              {report.byMonth.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-center text-muted-foreground" colSpan={4}>
                    Chưa có dữ liệu.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </PhanTrangBang>
      </Card>

      {/* Theo cơ sở */}
      <Card title="Rời lớp theo cơ sở">
        <BarChart
          data={report.byCenter.map((c) => ({
            name: c.label,
            "Tổng ghi danh": c.total,
            "Rời lớp": c.withdrew,
          }))}
          xKey="name"
          bars={[
            { key: "Tổng ghi danh", name: "Tổng ghi danh", color: "#7C3AED" },
            { key: "Rời lớp", name: "Rời lớp", color: "#F97316" },
          ]}
          height={300}
        />
        <div className="mt-3 overflow-x-auto">
          <PhanTrangBang>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Cơ sở</th>
                  <th className="px-3 py-2 text-right">Tổng</th>
                  <th className="px-3 py-2 text-right">Rời lớp</th>
                  <th className="px-3 py-2 text-right">Tỉ lệ rời</th>
                </tr>
              </thead>
              <tbody>
                {report.byCenter.map((c) => (
                  <tr key={c.key} className="border-t">
                    <td className="px-3 py-2">{c.label}</td>
                    <td className="px-3 py-2 text-right">{num(c.total)}</td>
                    <td className="px-3 py-2 text-right">{num(c.withdrew)}</td>
                    <td className="px-3 py-2 text-right font-medium">{pct(c.churnRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        </div>
      </Card>
    </div>
  );
}
