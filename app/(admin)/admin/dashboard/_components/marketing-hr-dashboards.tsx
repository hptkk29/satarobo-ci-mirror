import { TRANG_THAI_CHO_QUAN_LY } from "@/lib/work-request";
import Link from "next/link";
import { safeCache } from "@/lib/cache/safe-cache";
import { BarChart3, Briefcase, Users, CalendarClock } from "lucide-react";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { actorScopeKey } from "@/lib/cache/scope-key";

function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// REQ-04: số liệu dashboard marketing (aggregate theo scope → PRIMITIVE, bySource phẳng).
async function getMarketingStats(actor: Actor) {
  const now = new Date();
  const weekStart = startOfWeek(now);
  // FL0 — cách ly cơ sở: Lead ∈ SCOPED_MODELS → scopedDb lọc theo tầm nhìn cơ sở.
  const sdb = scopedDb(actor);
  const [bySource, newThisWeek, total, enrolledTotal] = await Promise.all([
    sdb.lead.groupBy({
      by: ["source"],
      where: { deletedAt: null },
      _count: { _all: true },
      orderBy: { _count: { source: "desc" } },
      take: 8,
    }),
    sdb.lead.count({ where: { deletedAt: null, createdAt: { gte: weekStart } } }),
    sdb.lead.count({ where: { deletedAt: null } }),
    sdb.lead.count({ where: { deletedAt: null, status: "DA_DANG_KY" } }),
  ]);
  return {
    bySource: bySource.map((s) => ({ source: s.source, count: s._count._all })),
    newThisWeek,
    total,
    enrolledTotal,
  };
}

// Đợt 3C #5 — Dashboard MARKETING (nguồn lead, hiệu quả kênh tóm tắt).
export async function MarketingDashboard({ name, actor, embedded = false }: { name: string; actor: Actor; embedded?: boolean }) {
  // REQ-04: cache theo scope, TTL 60s. Output primitive.
  const { bySource, newThisWeek, total, enrolledTotal } = await safeCache(
    () => getMarketingStats(actor),
    ["marketing-dashboard-stats", actorScopeKey(actor)],
    { tags: [CACHE_TAGS.dashboard], revalidate: 60 },
  )();

  const convRate = total > 0 ? Math.round((enrolledTotal / total) * 100) : 0;
  const maxCount = Math.max(1, ...bySource.map((s) => s.count));

  return (
    <div className="space-y-6">
      {!embedded && <h1 className="text-2xl font-bold text-foreground">Chào {name || "bạn"} 👋 · Marketing</h1>}
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Lead mới tuần này" value={newThisWeek} />
        <Stat label="Tổng lead" value={total} />
        <Stat label="Tỷ lệ chuyển đổi" value={`${convRate}%`} />
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <BarChart3 className="h-4 w-4" /> Nguồn lead theo kênh
        </h2>
        {bySource.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có lead.</p>
        ) : (
          <ul className="space-y-2">
            {bySource.map((s, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span className="w-40 truncate text-foreground" title={s.source ?? "—"}>{s.source ?? "(không nguồn)"}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(s.count / maxCount) * 100}%` }} />
                </div>
                <span className="w-10 text-right font-semibold tabular-nums text-foreground">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/marketing" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">Xem Tracking chi tiết →</Link>
      </section>
    </div>
  );
}

// REQ-04: số liệu dashboard HR (đếm theo scope → PRIMITIVE).
async function getHrStats(actor: Actor) {
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  // FL0 — cách ly cơ sở: Employee/ShiftAssignment ∈ SCOPED_MODELS → scopedDb lọc
  // theo tầm nhìn cơ sở. JobPosting không scoped → đi qua nguyên vẹn.
  // L5 chấm công v3 (06/09/2026): ShiftRegistration đã đóng băng → đếm ca trên lưới mới
  // (ShiftAssignment) và đơn từ đang chờ duyệt (WorkRequest) thay cho "xin nghỉ khẩn".
  const sdb = scopedDb(actor);
  const [activeStaff, openJobs, shiftRegsWeek, leaveReqs] = await Promise.all([
    sdb.employee.count({ where: { status: "ACTIVE" } }),
    sdb.jobPosting.count({ where: { status: "OPEN" } }),
    sdb.shiftAssignment.count({ where: { status: "ACTIVE", workDate: { gte: weekStart, lt: weekEnd } } }),
    sdb.workRequest.count({ where: { status: { in: [...TRANG_THAI_CHO_QUAN_LY] } } }),
  ]);
  return { activeStaff, openJobs, shiftRegsWeek, leaveReqs };
}

// Đợt 3C #5 — Dashboard HR (nhân sự, tuyển dụng, đăng ký ca).
export async function HrDashboard({ name, actor, embedded = false }: { name: string; actor: Actor; embedded?: boolean }) {
  // REQ-04: cache theo scope, TTL 60s.
  const { activeStaff, openJobs, shiftRegsWeek, leaveReqs } = await safeCache(
    () => getHrStats(actor),
    ["hr-dashboard-stats", actorScopeKey(actor)],
    { tags: [CACHE_TAGS.dashboard], revalidate: 60 },
  )();

  return (
    <div className="space-y-6">
      {!embedded && <h1 className="text-2xl font-bold text-foreground">Chào {name || "bạn"} 👋 · Nhân sự</h1>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Nhân viên đang làm" value={activeStaff} href="/nhan-su" icon={<Users className="h-5 w-5" />} />
        <Stat label="Tuyển dụng đang mở" value={openJobs} href="/jobs" icon={<Briefcase className="h-5 w-5" />} />
        <Stat label="Ca xếp tuần này" value={shiftRegsWeek} href="/cham-cong/phan-ca" icon={<CalendarClock className="h-5 w-5" />} />
        <Stat label="Đơn từ chờ duyệt" value={leaveReqs} href="/don-tu" tone={leaveReqs > 0 ? "danger" : "ok"} icon={<CalendarClock className="h-5 w-5" />} />
      </div>
    </div>
  );
}

function Stat({
  label, value, href, tone = "neutral", icon,
}: {
  label: string; value: number | string; href?: string; tone?: "neutral" | "ok" | "danger"; icon?: React.ReactNode;
}) {
  const toneCls = tone === "danger" ? "text-state-danger-ink" : tone === "ok" ? "text-state-success-ink" : "text-primary";
  const body = (
    <>
      <div className={`flex items-center gap-2 ${toneCls}`}>{icon}<span className="text-2xl font-bold tabular-nums">{value}</span></div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </>
  );
  return href ? (
    <Link href={href} className="rounded-xl border border-border bg-card p-4 hover:border-primary">{body}</Link>
  ) : (
    <div className="rounded-xl border border-border bg-card p-4">{body}</div>
  );
}
