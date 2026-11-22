import Link from "next/link";
import { safeCache } from "@/lib/cache/safe-cache";
import {
  Users,
  UserPlus,
  BookOpen,
  FileText,
  TrendingUp,
  Target,
  FlaskConical,
  GraduationCap,
  Wallet,
} from "lucide-react";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission, canViewLeadPii } from "@/lib/auth/check-permission";
import { maskLeadPiiFields } from "@/lib/lead/pii";
import type { Actor } from "@/lib/auth/actor";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { actorScopeKey } from "@/lib/cache/scope-key";
import { StatCardAdmin } from "@/components/design-system/admin/stat-card-admin";
import { StatusBadge } from "@/components/design-system/admin/status-badge";
import { DataTableShell } from "@/components/design-system/admin/data-table-shell";
import { LineChart } from "@/components/charts/line-chart";
import { BarChart } from "@/components/charts/bar-chart";
import {
  groupByWeek,
  monthKeyVN,
  type LeadReportRecord,
} from "@/lib/reports/lead";
import { LEAD_STATUS_LABEL, LEAD_STATUS_VARIANT } from "@/lib/leads/status";
import type { LeadStatus } from "@prisma/client";
import {
  buildRevenueTargetReport,
  computeAchievement,
} from "@/lib/reports/revenue-target";
import { getRevenueTargets } from "@/lib/reports/revenue-target-data";
import { getDebtRows, KHOAN_DA_DONG } from "@/lib/finance/debt";
import { giaoVienDuocQuyCong } from "@/lib/lms/session-ownership";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

// Đợt 3C #4 / 3B — Dashboard QUẢN LÝ + SUPER_ADMIN (tổng quan tuyển sinh + vận hành).
// BỐ CỤC GỌN (commit 1): KPI → biểu đồ → hoạt động gần đây. Các thẻ "việc tồn đọng"
// (lớp chờ duyệt, buổi chưa hoàn tất, ảnh/yêu cầu chờ duyệt) ĐÃ gom ở khu "Cần xử lý"
// (PendingTasksSection) cấp trang → KHÔNG lặp lại tại đây.
// 20/08: bỏ "checklist cơ sở" khỏi danh sách trên — tính năng đã gỡ, `centerChecklist()`
// trong lib/pending-tasks.ts trả null nên nhóm việc đó không còn sinh ra nữa.
// centerScope: != null → giới hạn cơ sở (CENTER_MANAGER không kèm SUPER_ADMIN).

// GĐ0 — hai bảng chép tay đã gỡ, lấy từ nguồn duy nhất @/lib/leads/status.
// Bản chép cũ thiếu TRIAL_IN_PROGRESS và REGISTERED (khai Record<string,string> nên
// TypeScript không bắt được) ⇒ hai trạng thái đó hiện raw enum ra dashboard. Nó còn
// gọi ENROLLED là "Đã đăng ký" trong khi REGISTERED mới là "Đã đăng ký"; nay đúng
// theo nguồn: ENROLLED = "Đã ghi danh".
const ACTIVE_LEAD: { deletedAt: null } = { deletedAt: null };

function lastNDaysData(leads: { createdAt: Date }[], days = 14) {
  const buckets: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
    });
    buckets[key] = 0;
  }
  leads.forEach((l) => {
    const key = new Date(l.createdAt).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
    });
    if (key in buckets) buckets[key]++;
  });
  return Object.entries(buckets).map(([date, count]) => ({
    date,
    leads: count,
  }));
}

// REQ-04: số liệu tổng hợp dashboard quản lý (aggregate theo scope, KHÔNG list per-user).
// Tự tính `now` bên trong → sau khi cache hết hạn (TTL) tự làm mới mốc thời gian. Output
// toàn PRIMITIVE (số + mảng {string,number}) → serialize qua unstable_cache an toàn.
async function getManagerStats(actor: Actor) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 86_400_000);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const currentPeriod = monthKeyVN(now);

  // FL0 — cách ly cơ sở: Lead/Student/Payment/TrialClass(V2)/ClassSession ∈ SCOPED_MODELS
  // → scopedDb lọc theo tầm nhìn cơ sở. News không scoped → đi qua nguyên vẹn.
  // RevenueTarget ∈ SCOPE_EXEMPT → scope TAY qua getRevenueTargets(actor).
  const sdb = scopedDb(actor);
  const [
    totalLeads,
    newLeadsThisMonth,
    newLeadsLastMonth,
    enrolledLeads,
    totalStudents,
    totalPosts,
    leadsLast14Days,
    leadsByStatus,
    leadsForWeekly,
    revenuePayments,
    revenueTargets,
    trialV2Classes,
    sessionsToday,
    debtRows,
  ] = await Promise.all([
    sdb.lead.count({ where: ACTIVE_LEAD }),
    sdb.lead.count({
      where: { ...ACTIVE_LEAD, createdAt: { gte: monthStart } },
    }),
    sdb.lead.count({
      where: { ...ACTIVE_LEAD, createdAt: { gte: lastMonth, lt: monthStart } },
    }),
    sdb.lead.count({ where: { ...ACTIVE_LEAD, status: "DA_DANG_KY" } }),
    sdb.student.count({ where: { deletedAt: null } }),
    sdb.news.count({ where: { isPublished: true } }),
    sdb.lead.findMany({
      where: { ...ACTIVE_LEAD, createdAt: { gte: fourteenDaysAgo } },
      select: { createdAt: true },
    }),
    sdb.lead.groupBy({
      by: ["status"],
      where: ACTIVE_LEAD,
      _count: { id: true },
    }),
    // Phễu lead theo TUẦN (8 tuần) — chỉ cần createdAt + status.
    sdb.lead.findMany({
      where: { ...ACTIVE_LEAD, createdAt: { gte: eightWeeksAgo } },
      select: { createdAt: true, status: true },
    }),
    // Doanh thu THỰC = Σ Payment(accountantStatus=CONFIRMED) — 6 tháng gần nhất.
    sdb.payment.findMany({
      where: { ...KHOAN_DA_DONG, paidDate: { gte: sixMonthsAgo } },
      select: { amount: true, centerId: true, paidDate: true },
      take: 50_000,
    }),
    getRevenueTargets(actor),
    // Hẹn trải nghiệm HÔM NAY — CHỈ V2.
    // 26/08: bỏ nhánh đếm `TrialClass` (V1). Dữ liệu V1 đã được gộp sang V2
    // (scripts/gop-trial-v1-sang-v2.ts) nên đếm cả hai là đếm ĐÔI cùng một cuộc hẹn.
    // TrialClassSession không scoped → cách ly qua parent TrialClassV2 (SCOPED).
    sdb.trialClassV2.findMany({
      where: {
        sessions: {
          some: { date: { gte: dayStart, lt: dayEnd }, status: "SCHEDULED" },
        },
      },
      select: {
        sessions: {
          where: { date: { gte: dayStart, lt: dayEnd }, status: "SCHEDULED" },
          select: { id: true },
        },
      },
    }),
    // GV đứng lớp HÔM NAY — ClassSession (SCOPED); GV thực = actualTeacherId ?? class.teacherId.
    sdb.classSession.findMany({
      where: { date: { gte: dayStart, lt: dayEnd } },
      select: {
        actualTeacherId: true,
        // Không select thì `giaoVienDuocQuyCong` nhận thiếu và bug quay lại im lặng —
        // đây chính là chỗ `tsc` đã bắt được khi tham số thành BẮT BUỘC.
        substituteTeacherId: true,
        class: { select: { teacherId: true } },
      },
    }),
    // Công nợ học phí (Payment 2 tầng) — TÁI DÙNG lib getDebtRows (đã cách ly qua Class).
    getDebtRows(sdb as unknown as Parameters<typeof getDebtRows>[0]),
  ]);

  const monthDelta =
    newLeadsLastMonth > 0
      ? ((newLeadsThisMonth - newLeadsLastMonth) / newLeadsLastMonth) * 100
      : 0;
  const conversionRate =
    totalLeads > 0 ? ((enrolledLeads / totalLeads) * 100).toFixed(1) : "0";
  const dailyLeadsChart = lastNDaysData(leadsLast14Days);
  const statusBars = leadsByStatus
    .map((s) => ({
      status: LEAD_STATUS_LABEL[s.status as LeadStatus] ?? s.status,
      count: s._count.id,
    }))
    .sort((a, b) => b.count - a.count);

  // câu 16 (a) — doanh thu THỰC vs MỤC TIÊU kỳ hiện tại (ghép qua helper thuần).
  const revenueReport = buildRevenueTargetReport(
    revenuePayments.map((p) => ({
      amount: p.amount,
      centerId: p.centerId,
      paidDate: p.paidDate,
    })),
    revenueTargets,
  );
  const currentRevRow = revenueReport.find((r) => r.period === currentPeriod);
  const revenueActual = currentRevRow?.actual ?? 0;
  const revenueTarget = currentRevRow?.target ?? null;
  const revenueAchieved = (
    currentRevRow ?? computeAchievement(revenueActual, revenueTarget)
  ).achievedRate;

  // câu 16 (c) — buổi trải nghiệm hôm nay. 26/08: chỉ đếm V2 (hệ V1 đã gộp sang V2).
  const trialsToday = trialV2Classes.reduce((s, c) => s + c.sessions.length, 0);

  // câu 16 (d) — số GV đứng lớp hôm nay (distinct theo GV thực).
  //
  // ⚠️ Trước 08/09/2026 viết `actualTeacherId ?? class.teacherId` — BỎ SÓT
  // `substituteTeacherId`, nên hôm nào có buổi đổi giáo viên là con số này đếm nhầm
  // người. Luật quy công ở MỘT chỗ: `lib/lms/session-ownership.ts`.
  const teacherSet = new Set<string>();
  for (const s of sessionsToday) {
    const tid = giaoVienDuocQuyCong(s);
    if (tid) teacherSet.add(tid);
  }
  const teachersToday = teacherSet.size;

  // câu 16 (e) — công nợ học phí còn lại (chỉ debt > 0).
  const totalDebt = debtRows.reduce(
    (sum, r) => sum + (r.debt > 0 ? r.debt : 0),
    0,
  );
  const debtCount = debtRows.filter((r) => r.debt > 0).length;

  // Phễu lead theo TUẦN (8 tuần gần nhất) — tổng vs chuyển đổi.
  const weeklyRecords: LeadReportRecord[] = leadsForWeekly.map((l) => ({
    status: l.status,
    source: null,
    centerId: null,
    commissionSource: null,
    createdAt: l.createdAt,
  }));
  const weeklyBars = groupByWeek(weeklyRecords, 8, now).map((w) => ({
    week: w.label,
    total: w.total,
    converted: w.converted,
  }));

  return {
    totalLeads,
    newLeadsThisMonth,
    enrolledLeads,
    totalStudents,
    totalPosts,
    monthDelta,
    conversionRate,
    dailyLeadsChart,
    statusBars,
    revenueActual,
    revenueAchieved,
    trialsToday,
    teachersToday,
    totalDebt,
    debtCount,
    weeklyBars,
  };
}

export async function ManagerDashboard({
  userId,
  name,
  actor,
  embedded = false,
}: {
  userId: string;
  name: string;
  actor: Actor;
  embedded?: boolean;
}) {
  const now = new Date();
  const endOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
  );

  // S-1 (26/08/2026) — HAI cổng khác nhau, đừng gộp:
  //
  //  • `xemDuocLead` = có được nhìn DANH SÁCH phiếu không. Panel này là panel MẶC
  //    ĐỊNH của `/admin/dashboard`: vai nào không khớp bảng panel (Đào tạo, và bất
  //    kỳ vai mới nào) đều rơi vào đây. Đào tạo chưa từng có `leads:view-all` /
  //    `leads:view-own`, nhưng vẫn đọc được tên phụ huynh + gần trọn SĐT của 8
  //    phiếu mới nhất. Không có `where` nào chặn được chuyện đó — chỉ có việc
  //    KHÔNG TRUY VẤN.
  //  • `canViewPii` = có được nhìn SĐT/tên thật không (Q9 gỡ của Quản lý cơ sở).
  //
  // Quản lý cơ sở qua cổng 1 nhưng trượt cổng 2 ⇒ vẫn thấy bảng, số đã che.
  const [xemDuocLead, canViewPii] = await Promise.all([
    (async () =>
      (await checkPermission("leads:view-all")) || (await checkPermission("leads:view-own")))(),
    canViewLeadPii(),
  ]);

  // Live (KHÔNG cache): leads mới nhất (hiển thị, có Date) + việc CỦA TÔI hôm nay
  // (theo userId — cache theo scope sẽ lẫn task người khác nên GIỮ live).
  const sdb = scopedDb(actor);
  // ⚠️ Đặt tên `*Raw`: hai dòng ngay dưới CHE PII rồi mới đặt tên cuối cùng. Hợp nhất
  // 16/09 từng làm mất cặp tên này (bản `main` không che ở đây) — mất là SĐT/tên phụ
  // huynh đi thẳng ra bảng cho vai không có `leads:view-pii`.
  const [recentLeadsRaw, myTasksTodayRaw] = await Promise.all([
    sdb.lead.findMany({
      where: ACTIVE_LEAD,
      take: 8,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        parentName: true,
        phone: true,
        status: true,
        createdAt: true,
      },
    }),
    sdb.leadTask.findMany({
      where: {
        assignedToId: userId,
        status: "OPEN",
        dueAt: { lte: endOfToday },
      },
      include: {
        lead: { select: { id: true, parentName: true, phone: true } },
      },
      orderBy: { dueAt: "asc" },
      take: 20,
    }),
  ]);

  // Che ở SERVER, một lần, ngay sau khi đọc — mọi chỗ dùng bên dưới ăn theo.
  const recentLeads = recentLeadsRaw.map((l) => maskLeadPiiFields(l, canViewPii));
  const myTasksToday = myTasksTodayRaw.map((t) => ({
    ...t,
    lead: { ...t.lead, ...maskLeadPiiFields({ parentName: t.lead.parentName }, canViewPii) },
  }));

  // REQ-04: cache số liệu tổng hợp theo scope (KPI + biểu đồ, đều primitive → serialize
  // an toàn). TTL 60s. actorScopeKey chống leak cross-cơ-sở. `now` tính trong hàm cache.
  const {
    totalLeads,
    newLeadsThisMonth,
    enrolledLeads,
    totalStudents,
    totalPosts,
    monthDelta,
    conversionRate,
    dailyLeadsChart,
    statusBars,
    revenueActual,
    revenueAchieved,
    trialsToday,
    teachersToday,
    totalDebt,
    debtCount,
    weeklyBars,
  } = await safeCache(
    () => getManagerStats(actor),
    ["manager-dashboard-stats", actorScopeKey(actor)],
    { tags: [CACHE_TAGS.dashboard], revalidate: 60 },
  )();

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Xin chào, {name.split(" ").slice(-1)[0] || "Admin"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tổng quan hệ thống ·{" "}
            {now.toLocaleDateString("vi-VN", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
        </div>
      )}

      {/* Việc CÁ NHÂN hôm nay (lead task của chính mình) — khác với khu "Cần xử lý"
          tổng hợp ở trên; giữ vì có giờ hẹn + thao tác nhanh. */}
      {myTasksToday.length > 0 && (
        <div className="rounded-xl border border-primary-soft bg-primary-soft p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-primary">
              Việc của tôi hôm nay ({myTasksToday.length})
            </h2>
            <Link
              href="/leads?view=kanban"
              className="text-xs text-primary hover:underline"
            >
              Xem pipeline →
            </Link>
          </div>
          <ul className="space-y-2">
            {myTasksToday.map((t) => {
              const overdue = t.dueAt.getTime() < now.getTime();
              return (
                <li key={t.id}>
                  <Link
                    href={`/leads/${t.lead.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm hover:bg-primary-soft/40"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <strong className="text-foreground">{t.title}</strong>
                      <span className="text-muted-foreground">
                        {" "}
                        · {t.lead.parentName}
                      </span>
                    </span>
                    <span
                      className={`flex-shrink-0 text-xs ${overdue ? "font-bold text-state-danger-ink" : "text-muted-foreground"}`}
                    >
                      {t.dueAt.toLocaleTimeString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {overdue ? " · Quá hạn" : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* (1) KPI câu 16 — 5 chỉ số quản lý: doanh thu/mục tiêu · khách mới · học thử
          hôm nay · GV đứng lớp hôm nay · công nợ. Mọi số đã cách ly cơ sở qua scopedDb. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCardAdmin
          label="Doanh thu / mục tiêu (tháng)"
          value={vnd(revenueActual)}
          trend={
            revenueAchieved !== null
              ? {
                  direction: revenueAchieved >= 1 ? "up" : "down",
                  value: `${(revenueAchieved * 100).toFixed(0)}% mục tiêu`,
                }
              : undefined
          }
          icon={<Target className="w-4 h-4" />}
          iconColor="purple"
        />
        <StatCardAdmin
          label="Khách hàng mới (tháng)"
          value={newLeadsThisMonth}
          trend={
            monthDelta !== 0
              ? {
                  direction: monthDelta > 0 ? "up" : "down",
                  value: `${monthDelta > 0 ? "+" : ""}${monthDelta.toFixed(0)}% so với tháng trước`,
                }
              : undefined
          }
          icon={<UserPlus className="w-4 h-4" />}
          iconColor="orange"
        />
        <StatCardAdmin
          label="Hẹn học thử hôm nay"
          value={trialsToday}
          icon={<FlaskConical className="w-4 h-4" />}
          iconColor="orange"
        />
        <StatCardAdmin
          label="GV đứng lớp hôm nay"
          value={teachersToday}
          icon={<GraduationCap className="w-4 h-4" />}
          iconColor="purple"
        />
        <StatCardAdmin
          label="Công nợ học phí"
          value={vnd(totalDebt)}
          trend={
            debtCount > 0
              ? { direction: "down", value: `${debtCount} ghi danh còn nợ` }
              : undefined
          }
          icon={<Wallet className="w-4 h-4" />}
          iconColor="orange"
        />
      </div>

      {/* (1b) Chỉ số tuyển sinh phụ (giữ từ bản cũ). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCardAdmin
          label="Tổng leads"
          value={totalLeads}
          icon={<Users className="w-4 h-4" />}
          iconColor="orange"
        />
        {/* BUG-009: nhãn rõ — đếm bảng Student (khác "Leads ENROLLED" đếm bảng Lead). */}
        <StatCardAdmin
          label="Tổng học viên"
          value={totalStudents}
          icon={<BookOpen className="w-4 h-4" />}
          iconColor="purple"
        />
        <StatCardAdmin
          label="Tỉ lệ chuyển đổi (lead)"
          value={`${conversionRate}%`}
          icon={<TrendingUp className="w-4 h-4" />}
          iconColor="orange"
        />
      </div>

      {/* (2) Biểu đồ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="font-semibold text-foreground mb-1">
            Leads 14 ngày qua
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Số lead mới mỗi ngày
          </p>
          {dailyLeadsChart.length > 0 ? (
            <LineChart
              data={dailyLeadsChart}
              xKey="date"
              lines={[{ key: "leads", name: "Leads", color: "#F97316" }]}
              showLegend={false}
              height={260}
            />
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
              Chưa có dữ liệu
            </div>
          )}
        </div>
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="font-semibold text-foreground mb-1">
            Phân bố theo trạng thái
          </h2>
          <p className="text-xs text-muted-foreground mb-4">Tất cả leads</p>
          {statusBars.length > 0 ? (
            <BarChart
              data={statusBars}
              xKey="status"
              bars={[{ key: "count", name: "Số lượng", color: "#F97316" }]}
              height={260}
            />
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
              Chưa có dữ liệu
            </div>
          )}
        </div>
      </div>

      {/* (2b) Phễu lead theo TUẦN — tổng vs chuyển đổi (REGISTERED/ENROLLED), 8 tuần gần nhất. */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="font-semibold text-foreground mb-1">
          Phễu lead theo tuần
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Lead mới vs đã chuyển đổi mỗi tuần (8 tuần gần nhất)
        </p>
        <BarChart
          data={weeklyBars}
          xKey="week"
          bars={[
            { key: "total", name: "Lead mới", color: "#F97316" },
            { key: "converted", name: "Chuyển đổi", color: "#7C3AED" },
          ]}
          height={260}
        />
      </div>

      {/* (3) Hoạt động gần đây — CHỈ cho người có quyền xem lead. Vai không có
          quyền (vd Đào tạo) rơi vào panel này thì khối dưới đây không tồn tại,
          không phải "rỗng": dữ liệu cũng không được truy vấn ở trên. */}
      {xemDuocLead && (
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-foreground">Leads mới nhất</h2>
          <Link
            href="/leads"
            className="text-sm font-semibold text-primary hover:underline"
          >
            Xem tất cả →
          </Link>
        </div>
        <DataTableShell>
          <PhanTrangBang>
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Phụ huynh</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="hover:bg-muted transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      {lead.parentName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {/* Đã che ở SERVER bằng `maskLeadPiiFields` (xem chỗ dựng `recentLeads`).
                          KHÔNG tự chế mặt nạ ở đây: bản cũ giữ 4 số ĐẦU nên lộ cả đầu số
                          + 1 chữ số, nhiều hơn mặt nạ chuẩn — và hai mặt nạ khác nhau
                          trong cùng hệ thống thì không ai biết cái nào là thật. */}
                      {lead.phone}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        variant={
                          LEAD_STATUS_VARIANT[lead.status as LeadStatus] ??
                          "neutral"
                        }
                      >
                        {LEAD_STATUS_LABEL[lead.status as LeadStatus] ??
                          lead.status}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {new Date(lead.createdAt).toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
                {recentLeads.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-12 text-center text-muted-foreground"
                    >
                      Chưa có lead nào
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </PhanTrangBang>
        </DataTableShell>
      </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <FileText className="w-5 h-5 text-primary shrink-0" />
          <div>
            <p className="text-muted-foreground">Tin tức đang publish</p>
            <p className="font-semibold text-foreground">{totalPosts} bài</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
          <Users className="w-5 h-5 text-primary shrink-0" />
          <div>
            <p className="text-muted-foreground">Leads ENROLLED tất cả</p>
            <p className="font-semibold text-foreground">
              {enrolledLeads} người
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
