import Link from "next/link";
import { safeCache } from "@/lib/cache/safe-cache";
import { CalendarDays, ClipboardCheck, FileWarning, AlertTriangle } from "lucide-react";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { buildWeeklySchedule, WEEKDAY_LABELS, type TeacherClassSlot } from "@/lib/teachers/schedule";

// REQ-04: số liệu dashboard giáo viên. Data THEO USER (teacherId=userId) nên cache key =
// userId (không phải scope). Output PRIMITIVE (startTime/endTime là string, scheduleDays
// int[], conflicts {day,a,b} — không Date/Map) → serialize an toàn.
async function getTeacherStats(userId: string) {
  const now = new Date();
  const todayWd = now.getDay(); // 0=CN..6=T7
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Cách ly cơ sở: Class/ClassSession ∈ SCOPED_MODELS → sdb tự inject centerId.
  // AssignmentSubmission KHÔNG scoped → scope tay qua assignment.class.centerId (AC7).
  const actor = await resolveActor(userId);
  const sdb = scopedDb(actor);
  const visibleClassCenters = getModelVisibleCenterIds("Class", actor);
  const classCenterScope =
    visibleClassCenters === "ALL" ? {} : { centerId: { in: visibleClassCenters } };

  const myClasses = await sdb.class.findMany({
    where: { teacherId: userId, deletedAt: null, status: { in: ["PLANNED", "RECRUITING", "ACTIVE"] } },
    select: {
      id: true, name: true, classCode: true, scheduleDays: true, startTime: true, endTime: true,
      room: { select: { code: true } },
      _count: { select: { enrollments: { where: { status: { in: ENROLLMENT_ACTIVE_STATUS_LIST }, deletedAt: null } } } },
    },
  });

  const [sessionsToday, toGrade] = await Promise.all([
    sdb.classSession.findMany({
      where: { class: { teacherId: userId }, date: { gte: dayStart, lt: dayEnd } },
      select: { id: true, status: true, class: { select: { name: true, classCode: true } } },
      orderBy: { date: "asc" },
    }),
    sdb.assignmentSubmission.count({
      where: {
        assignment: { class: { teacherId: userId, ...classCenterScope } },
        status: { in: ["SUBMITTED", "LATE"] },
        score: null,
      },
    }),
  ]);

  const todayClasses = myClasses.filter((c) => c.scheduleDays.includes(todayWd));
  const incompleteCount = sessionsToday.filter((s) => s.status !== "COMPLETED").length;

  const slots: TeacherClassSlot[] = myClasses.map((c) => ({
    id: c.id,
    label: c.classCode ?? c.name,
    scheduleDays: c.scheduleDays,
    startTime: c.startTime,
    endTime: c.endTime,
    role: "teacher",
  }));
  const { conflicts } = buildWeeklySchedule(slots);

  return { todayClasses, incompleteCount, toGrade, conflicts };
}

// Đợt 3C — Dashboard GIÁO VIÊN. KHÔNG doanh thu/lead/quản trị.
export async function TeacherDashboard({ userId, name, embedded = false }: { userId: string; name: string; embedded?: boolean }) {
  // REQ-04: cache theo USER (userId), TTL 60s.
  const { todayClasses, incompleteCount, toGrade, conflicts } = await safeCache(
    () => getTeacherStats(userId),
    ["teacher-dashboard-stats", userId],
    { tags: [CACHE_TAGS.dashboard], revalidate: 60 },
  )();

  return (
    <div className="space-y-6">
      {!embedded && <h1 className="text-2xl font-bold text-foreground">Chào {name || "thầy/cô"} 👋</h1>}

      {/* Lớp hôm nay */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <CalendarDays className="h-4 w-4" /> Lớp dạy hôm nay ({todayClasses.length})
        </h2>
        {todayClasses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Hôm nay không có lớp.</p>
        ) : (
          <ul className="divide-y divide-border">
            {todayClasses.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-medium text-foreground">{c.classCode ? `${c.classCode} · ` : ""}{c.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {c.startTime && c.endTime ? `${c.startTime}–${c.endTime}` : ""}
                    {c.room?.code ? ` · P.${c.room.code}` : ""} · {c._count.enrollments} HV
                  </span>
                </div>
                <Link href="/attendance" className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
                  <ClipboardCheck className="h-3.5 w-3.5" /> Điểm danh
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DashStat label="Buổi hôm nay chưa hoàn tất" value={incompleteCount} href="/sessions" tone={incompleteCount > 0 ? "warn" : "ok"} icon={<ClipboardCheck className="h-5 w-5" />} />
        <DashStat label="Bài đã nộp cần chấm" value={toGrade} href="/assignments" tone={toGrade > 0 ? "warn" : "ok"} icon={<FileWarning className="h-5 w-5" />} />
        <DashStat label="Xung đột giờ trong tuần" value={conflicts.length} href="#" tone={conflicts.length > 0 ? "danger" : "ok"} icon={<AlertTriangle className="h-5 w-5" />} />
      </div>

      {conflicts.length > 0 && (
        <section className="rounded-xl border border-state-danger-soft bg-state-danger-soft p-4 text-sm text-state-danger-ink">
          <p className="mb-1 font-semibold">Lịch dạy bị trùng giờ:</p>
          <ul className="space-y-0.5">
            {conflicts.map((c, i) => (
              <li key={i}>{WEEKDAY_LABELS[c.day]}: “{c.a}” trùng “{c.b}”</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DashStat({
  label, value, href, tone, icon,
}: {
  label: string; value: number; href: string; tone: "ok" | "warn" | "danger"; icon: React.ReactNode;
}) {
  const toneCls = tone === "danger" ? "text-state-danger-ink" : tone === "warn" ? "text-state-warning-ink" : "text-state-success-ink";
  return (
    <Link href={href} className="rounded-xl border border-border bg-card p-4 hover:border-primary">
      <div className={`flex items-center gap-2 ${toneCls}`}>{icon}<span className="text-2xl font-bold tabular-nums">{value}</span></div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </Link>
  );
}
