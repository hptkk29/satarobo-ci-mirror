import { redirect } from "next/navigation";
import { safeCache } from "@/lib/cache/safe-cache";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { actorScopeKey } from "@/lib/cache/scope-key";
import { LineChart } from "@/components/charts/line-chart";
import { BarChart } from "@/components/charts/bar-chart";
import {
  summarizeFinance,
  revenueByMonth,
  revenueByCenter,
  summarizeSatisfaction,
  summarizeRetention,
  type PaymentRecord,
  type EnrollmentRecord,
  type RatingRecord,
} from "@/lib/reports/trung-tam";
import {
  resolveReportFilters,
  reportFilterCacheKey,
  reportDateWhere,
  type ReportFilters,
} from "@/lib/reports/filters";
import { ReportFilterBar } from "@/components/admin/report-filter-bar";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Báo cáo trung tâm | Admin" };
export const dynamic = "force-dynamic";

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} đ`;
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;

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

export default async function CenterReportPage({
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
  // Gate: báo cáo tài chính trung tâm → quản lý tài chính (Admin + quản lý cơ sở + Kế toán).
  if (!(await checkPermission("payments:manage"))) {
    redirect("/dashboard");
  }

  const actor = await resolveActor(session.user.id);
  const sp = await searchParams;
  const fc = await resolveReportFilters(actor, sp);

  // REQ-05: cache số liệu (finance/trend/byCenter/satisfaction/retention) theo scope + bộ lọc.
  // TTL 120s. Tất cả PRIMITIVE nên serialize an toàn.
  const { finance, trend, byCenter, satisfaction, retention, biCatBotSoLieu } = await safeCache(
    () => computeTrungTamReport(actor, fc.filters),
    [
      "trung-tam-report",
      actorScopeKey(actor),
      reportFilterCacheKey(fc.filters),
    ],
    { tags: [CACHE_TAGS.report], revalidate: 120 },
  )();

  // Tên cơ sở cho bảng/biểu đồ — query nhỏ, giữ LIVE (Map không serialize được).
  const centerRows = await scopedDb(actor).center.findMany({
    select: { id: true, name: true, code: true },
  });
  const centerName = new Map(centerRows.map((c) => [c.id, c.code ?? c.name]));
  const labelCenter = (id: string) =>
    id === "—" ? "Chưa gán cơ sở" : (centerName.get(id) ?? id);

  const trendData = trend.map((t) => ({
    month: t.month,
    "Đã xác nhận": t.confirmed,
    "Chờ xác nhận": t.pending,
  }));
  const centerChartData = byCenter.map((c) => ({
    name: labelCenter(c.centerId),
    "Doanh thu": c.confirmed,
    "Công nợ": c.debt,
  }));

  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Báo cáo trung tâm</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tài chính, hài lòng và tái tục theo cơ sở
        </p>
      </div>

      {/* 07/09 — vượt trần thì NÓI RA. Trước đây `take: 5000` cắt lặng lẽ: báo cáo vẫn
          ra một con số trông bình thường mà không dấu hiệu nào cho biết nó thiếu. */}
      {biCatBotSoLieu && (
        <p className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          Kỳ lọc này có nhiều hơn {TRAN_KHOAN_BAO_CAO.toLocaleString("vi-VN")} khoản thu
          nên số liệu bên dưới <b>chưa đủ</b>. Thu hẹp khoảng ngày hoặc lọc theo một cơ sở
          để có con số chính xác.
        </p>
      )}

      <PageHelp>
        <p>
          Tài chính (doanh thu xác nhận, công nợ), mức độ hài lòng và tỷ lệ tái
          tục — theo phạm vi cơ sở của bạn.
        </p>
      </PageHelp>

      <ReportFilterBar
        basePath="/bao-cao/trung-tam"
        centers={fc.visibleCenters}
        selection={fc.selection}
        dateFrom={fc.dateFromStr}
        dateTo={fc.dateToStr}
        allowAll={fc.isGlobalAllowed}
      />

      {/* Tài chính */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Doanh thu đã xác nhận"
          value={vnd(finance.confirmedRevenue)}
          hint={`${finance.confirmedCount} khoản đã duyệt`}
          tone="good"
        />
        <Stat
          label="Chờ kế toán xác nhận"
          value={vnd(finance.pendingRevenue)}
          tone={finance.pendingRevenue > 0 ? "warn" : "neutral"}
        />
        <Stat
          label="Công nợ"
          value={vnd(finance.debt)}
          hint={`Phải thu ${vnd(finance.totalReceivable)}`}
          tone={finance.debt > 0 ? "bad" : "good"}
        />
        <Stat
          label="Đã hoàn"
          // R-13 — `refundedAmount` nay là ĐỘ LỚN (dương). Trước 13/09/2026 nó cộng dồn
          // `amount` ÂM của dòng REFUNDED, nên `> 0` KHÔNG BAO GIỜ đúng ⇒ cảnh báo chết
          // vĩnh viễn và ô này hiện số âm.
          value={vnd(finance.refundedAmount)}
          tone={finance.refundedAmount > 0 ? "warn" : "neutral"}
        />
      </section>

      {/* Hài lòng + tái tục */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Hài lòng trung bình"
          value={
            satisfaction.count
              ? `${(Math.round(satisfaction.average * 10) / 10).toFixed(1)} / 5`
              : "—"
          }
          hint={`${satisfaction.count} lượt đánh giá`}
          tone={
            satisfaction.average >= 4
              ? "good"
              : satisfaction.count
                ? "warn"
                : "neutral"
          }
        />
        <Stat
          label="Tỷ lệ hài lòng (4-5★)"
          value={satisfaction.count ? pct(satisfaction.positiveRate) : "—"}
          tone={
            satisfaction.positiveRate >= 0.8
              ? "good"
              : satisfaction.count
                ? "warn"
                : "neutral"
          }
        />
        <Stat
          label="Tái tục"
          value={retention.totalStudents ? pct(retention.retentionRate) : "—"}
          hint={`${retention.returningStudents}/${retention.totalStudents} học viên tái tục`}
          tone={
            retention.retentionRate >= 0.5
              ? "good"
              : retention.totalStudents
                ? "warn"
                : "neutral"
          }
        />
        <Stat
          label="Tổng lượt ghi danh"
          value={`${retention.totalEnrollments}`}
          hint={`${retention.totalStudents} học viên`}
        />
      </section>

      {/* Xu hướng doanh thu */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Xu hướng doanh thu theo tháng
        </h2>
        {trendData.length > 0 ? (
          <LineChart
            data={trendData}
            xKey="month"
            lines={[
              { key: "Đã xác nhận", name: "Đã xác nhận", color: "#10B981" },
              { key: "Chờ xác nhận", name: "Chờ xác nhận", color: "#F59E0B" },
            ]}
            height={300}
            yFormat="vnd-compact"
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Chưa có khoản thanh toán trong kỳ.
          </p>
        )}
      </section>

      {/* Doanh thu / công nợ theo cơ sở */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Doanh thu & công nợ theo cơ sở
        </h2>
        {centerChartData.length > 0 ? (
          <BarChart
            data={centerChartData}
            xKey="name"
            bars={[
              { key: "Doanh thu", name: "Doanh thu", color: "#7C3AED" },
              { key: "Công nợ", name: "Công nợ", color: "#F97316" },
            ]}
            height={300}
            yFormat="vnd-compact"
          />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Chưa có dữ liệu cơ sở trong kỳ.
          </p>
        )}
      </section>

      {/* Bảng chi tiết theo cơ sở */}
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Chi tiết theo cơ sở
          </h2>
        </div>
        <PhanTrangBang cuonNgang>
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Cơ sở</th>
                <th className="px-4 py-2 text-right">Đã xác nhận</th>
                <th className="px-4 py-2 text-right">Chờ xác nhận</th>
                <th className="px-4 py-2 text-right">Phải thu</th>
                <th className="px-4 py-2 text-right">Công nợ</th>
              </tr>
            </thead>
            <tbody>
              {byCenter.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    Không có dữ liệu trong phạm vi cơ sở.
                  </td>
                </tr>
              ) : (
                byCenter.map((c) => (
                  <tr key={c.centerId} className="border-t">
                    <td className="px-4 py-2 font-medium">
                      {labelCenter(c.centerId)}
                    </td>
                    <td className="px-4 py-2 text-right text-state-success-ink">
                      {vnd(c.confirmed)}
                    </td>
                    <td className="px-4 py-2 text-right text-state-warning-ink">
                      {vnd(c.pending)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {vnd(c.receivable)}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-state-danger-ink">
                      {vnd(c.debt)}
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

// REQ-05: tính số liệu báo cáo trung tâm (fetch scoped + reduce thuần → PRIMITIVE).
/**
 * Trần số dòng Payment nạp về cho báo cáo.
 *
 * Nâng từ 5.000 lên 50.000 và — quan trọng hơn — vượt trần nay được BÁO RA thay vì cắt
 * lặng lẽ. Hệ hiện có ~400 khoản; 50.000 đủ nhiều năm mà vẫn chặn được truy vấn chạy loạn.
 */
const TRAN_KHOAN_BAO_CAO = 50_000;

async function computeTrungTamReport(actor: Actor, filters: ReportFilters) {
  const sdb = scopedDb(actor); // Payment + Class auto-scoped theo cơ sở (HO/SUPER_ADMIN bypass).
  const bypass = actor.isSuperAdmin || actor.isHoLevel;
  // Bộ lọc cơ sở (IDOR-safe từ resolveReportFilters) + khoảng ngày. null → no-op (giữ hành vi cũ).
  // Ngày lọc theo paidDate — chính là trục "doanh thu theo tháng" (revenueByMonth gom theo paidDate).
  const dateWhere = reportDateWhere(filters);

  // 1. Khoản thanh toán trong phạm vi cơ sở (Payment ∈ SCOPED_MODELS → auto-scope).
  const paymentRows = await sdb.payment.findMany({
    where: {
      // ⚠️ 07/09 — BỔ SUNG `deletedAt: null`. Thiếu nó thì khoản đã xoá sổ vẫn vào
      // doanh thu theo tháng và theo cơ sở.
      deletedAt: null,
      ...(filters.centerId ? { centerId: filters.centerId } : {}),
      ...(dateWhere ? { paidDate: dateWhere } : {}),
    },
    select: {
      centerId: true,
      amount: true,
      accountantStatus: true,
      paidDate: true,
      // R-13 (13/09/2026) — BẮT BUỘC: thiếu `id`/`adjustmentOfId` thì không biết một
      // khoản CONFIRMED đã bị dòng ĐIỀU CHỈNH thay hay chưa, và bản gốc bị đếm bằng số CŨ.
      id: true,
      adjustmentOfId: true,
    },
    // Lấy DƯ 1 dòng để BIẾT là có bị cắt hay không — xem `TRAN_KHOAN_BAO_CAO`.
    take: TRAN_KHOAN_BAO_CAO + 1,
  });
  // ⚠️ 07/09 — thôi CẮT CÂM. `take: 5000` cũ lặng lẽ bỏ phần dư: báo cáo vẫn ra một
  // con số trông bình thường, không dấu hiệu nào cho biết nó thiếu. Nay vượt trần thì
  // nói ra ở đầu trang (`biCatBotSoLieu`).
  //
  // Không đổi sang `aggregate` vì ba phép gộp (`financeSummary`, `revenueByMonth`,
  // `revenueByCenter` — lib/reports/trung-tam.ts) là hàm THUẦN chạy trên cả mảng; đổi
  // sang gộp ở SQL là viết lại cả ba, ngoài phạm vi vé này.
  const biCatBotSoLieu = paymentRows.length > TRAN_KHOAN_BAO_CAO;
  if (biCatBotSoLieu) paymentRows.length = TRAN_KHOAN_BAO_CAO;
  const payments: PaymentRecord[] = paymentRows.map((p) => ({
    id: p.id,
    centerId: p.centerId,
    amount: p.amount,
    accountantStatus: p.accountantStatus,
    paidDate: p.paidDate,
    adjustmentOfId: p.adjustmentOfId,
  }));

  // 2. Lớp trong phạm vi → map classId→centerId. Enrollment KHÔNG có centerId nên
  // lọc thủ công theo classIds đã scope (AC5: Enrollment không nằm trong SCOPED_MODELS).
  const classRows = await sdb.class.findMany({
    where: {
      deletedAt: null,
      ...(filters.centerId ? { centerId: filters.centerId } : {}),
    },
    select: { id: true, centerId: true },
    take: 2000,
  });
  const classToCenter = new Map(classRows.map((c) => [c.id, c.centerId]));
  const classIds = classRows.map((c) => c.id);
  const enrollmentRows = classIds.length
    ? await sdb.enrollment.findMany({
        where: {
          classId: { in: classIds },
          ...(dateWhere ? { enrolledAt: dateWhere } : {}),
        },
        select: {
          studentId: true,
          classId: true,
          finalPrice: true,
          tuition: true,
          enrolledAt: true,
        },
        take: 10000,
      })
    : [];
  const enrollments: EnrollmentRecord[] = enrollmentRows.map((e) => ({
    studentId: e.studentId,
    centerId: classToCenter.get(e.classId) ?? null,
    finalPrice: e.finalPrice,
    tuition: e.tuition,
    enrolledAt: e.enrolledAt,
  }));

  // 3. Hài lòng — rating sao của khảo sát cơ sở (CENTER_SURVEY). EvaluationRound ∈
  // SCOPED_MODELS + NULL_IS_GLOBAL (#03 Pha B): auto-scope OR-null — round global (null)
  // vẫn lọt vào, nên GIỮ filter tay visibleCenterIds dưới đây (đừng bỏ khi refactor,
  // bỏ là KPI cơ sở gộp cả rating đợt global toàn hệ thống).
  const roundRows = await sdb.evaluationRound.findMany({
    where: {
      scope: "CENTER_SURVEY",
      ...(bypass ? {} : { centerId: { in: actor.visibleCenterIds } }),
    },
    select: { id: true },
    take: 2000,
  });
  const roundIds = roundRows.map((r) => r.id);
  const ratingRows = roundIds.length
    ? await sdb.evalAnswer.findMany({
        where: {
          response: { roundId: { in: roundIds } },
          valueNumber: { not: null },
        },
        select: { valueNumber: true },
        take: 20000,
      })
    : [];
  const ratings: RatingRecord[] = ratingRows.map((a) => ({
    valueNumber: a.valueNumber,
  }));

  // === Tính toán (hàm THUẦN) ===
  const finance = summarizeFinance(payments, enrollments);
  const trend = revenueByMonth(payments);
  const byCenter = revenueByCenter(payments, enrollments);
  const satisfaction = summarizeSatisfaction(ratings);
  const retention = summarizeRetention(enrollments);

  return { finance, trend, byCenter, satisfaction, retention, biCatBotSoLieu };
}
