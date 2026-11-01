import Link from "next/link";
import {
  Pencil,
  CalendarClock,
  Target,
  CircleCheck,
  Rocket,
  Map,
  ClipboardList,
  FileText,
  ChevronRight,
  PlayCircle,
  CalendarDays,
  Clock,
  MapPin,
  User,
  TrendingUp,
  Sparkles,
} from "lucide-react";
import type {
  StudentHome,
  JourneyDot,
  StudentTodo,
  SkillBar,
  ResultRow,
} from "@/lib/portal/student-home";

function shortName(n: string): string {
  return n.trim().split(/\s+/).slice(-2).join(" ");
}
function initials(n: string): string {
  const w = n
    .trim()
    .split(/\s+/)
    .filter((x) => /\p{L}/u.test(x[0] ?? ""));
  return (
    w
      .slice(-2)
      .map((x) => x[0])
      .join("") || "HS"
  ).toUpperCase();
}

function Ring({
  pct,
  done,
  total,
}: {
  pct: number;
  done: number;
  total: number;
}) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const off = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/15 px-4 py-2.5 backdrop-blur-sm">
      <div className="relative grid size-16 shrink-0 place-items-center">
        <svg viewBox="0 0 72 72" className="size-16 -rotate-90">
          <circle
            cx="36"
            cy="36"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            className="text-white/25"
          />
          <circle
            cx="36"
            cy="36"
            r={r}
            fill="none"
            stroke="white"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={off}
          />
        </svg>
        <span className="absolute text-sm font-bold">{pct}%</span>
      </div>
      <div className="leading-tight">
        <p className="text-xs font-bold text-white/80">Tiến độ khóa học</p>
        <p className="text-sm font-bold">
          {done}/{total} buổi đã học
        </p>
      </div>
    </div>
  );
}

export function StudentHomeV2({ data }: { data: StudentHome }) {
  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      {/* Hero cam */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/80 p-5 text-white sm:p-6">
        <Rocket className="pointer-events-none absolute -right-3 -top-3 size-28 rotate-12 text-white/10" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/15 text-lg font-bold ring-4 ring-white/10">
              {initials(data.studentName)}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-white/70">
                Cổng học sinh
              </p>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                Chào {shortName(data.studentName)}! 🚀
              </h1>
              <p className="mt-0.5 truncate text-xs font-medium text-white/80 sm:text-sm">
                {[data.courseName, data.className]
                  .filter(Boolean)
                  .join(" · ") || "Khóa học của em"}
              </p>
            </div>
          </div>
          <Ring pct={data.progressPct} done={data.done} total={data.total} />
        </div>
      </div>

      {/* 4 thẻ số liệu */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={Pencil}
          tone="primary"
          value={`${data.pendingCount} bài`}
          label="Cần làm"
        />
        <Stat
          icon={CalendarClock}
          tone="info"
          value={data.nextLabel ?? "—"}
          label="Buổi tiếp theo"
        />
        <Stat
          icon={Target}
          tone="caution"
          value={`${data.done}/${data.total}`}
          label="Buổi đã học"
        />
        <Stat
          icon={CircleCheck}
          tone="success"
          value={`${data.attendanceRate}%`}
          label="Chuyên cần"
        />
      </div>

      {/* Hành trình khóa học */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-5 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
            <Map className="size-4 text-primary" /> Hành trình khóa học
          </h2>
          <span className="text-xs font-bold text-muted-foreground">
            {data.done}/{data.total} buổi
          </span>
        </div>
        {data.journey.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chưa có buổi học nào.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto pb-2">
              <div className="flex min-w-max items-start gap-1.5 px-1">
                {data.journey.map((d) => (
                  // Khoá theo id buổi, không theo số buổi: con học 2 lớp thì có hai
                  // chấm cùng số 1, cùng số 2… và khoá React sẽ trùng.
                  <Dot key={d.id} dot={d} />
                ))}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs font-medium text-muted-foreground">
              <Legend cls="bg-primary" label="Đã học" />
              <Legend cls="bg-success" label="Học bù" />
              <Legend
                cls="border-2 border-destructive bg-card"
                label="Vắng (cần bù)"
              />
              <Legend cls="border-2 border-border bg-card" label="Sắp tới" />
              <Legend
                cls="bg-primary ring-2 ring-success"
                label="Hôm nay / Đang học"
              />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
              <Box value={data.total} label="Tổng buổi" />
              <Box value={data.done} label="Đã học" tone="primary" />
              <Box value={data.remaining} label="Còn lại" />
              <Box value={data.absent} label="Vắng" tone="destructive" />
              <Box value={data.makeupNeed} label="Cần học bù" tone="caution" />
              <Box value={data.makeupDone} label="Đã học bù" tone="success" />
            </div>
          </>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {/* Việc cần làm */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
                <ClipboardList className="size-4 text-primary" /> Việc cần làm
              </h2>
              {data.todos.length > 0 && (
                <span className="grid size-6 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                  {data.todos.length}
                </span>
              )}
            </div>
            {data.todos.length === 0 ? (
              <p className="py-4 text-center text-sm font-semibold text-success">
                Không có việc cần làm 🎉
              </p>
            ) : (
              <>
                <div className="space-y-2.5">
                  {data.todos.map((t) => (
                    <TodoRow key={`${t.kind}-${t.id}`} t={t} />
                  ))}
                </div>
                <Link
                  href={data.todos[0].href}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <PlayCircle className="size-5" /> Vào làm bài ngay
                </Link>
              </>
            )}
          </section>

          {/* Kết quả của em */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
                <TrendingUp className="size-4 text-primary" /> Kết quả của em
              </h2>
              {data.avgScore != null && (
                <span className="inline-flex items-center gap-1 rounded-lg bg-success/10 px-2 py-1 text-xs font-bold text-success">
                  🔥 {data.avgScore} điểm
                </span>
              )}
            </div>
            {data.results.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Chưa có kết quả chấm điểm.
              </p>
            ) : (
              <div className="space-y-2">
                {data.results.map((r, i) => (
                  <ResultRowView key={i} r={r} />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {/* Lớp học tiếp theo */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
              <CalendarDays className="size-4 text-primary" /> Lớp học tiếp theo
            </h2>
            {!data.nextClass ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Chưa có lịch sắp tới.
              </p>
            ) : (
              <>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <p className="text-base font-bold text-foreground">
                    {data.nextClass.title}
                  </p>
                  <span className="shrink-0 rounded-md bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                    {data.nextClass.label}
                  </span>
                </div>
                <div className="space-y-2 text-sm font-medium text-muted-foreground">
                  {data.nextClass.time && (
                    <p className="flex items-center gap-2">
                      <Clock className="size-4 text-primary" />{" "}
                      {data.nextClass.time}
                    </p>
                  )}
                  {data.nextClass.room && (
                    <p className="flex items-center gap-2">
                      <MapPin className="size-4 text-primary" />{" "}
                      {data.nextClass.room}
                    </p>
                  )}
                  {data.nextClass.teacher && (
                    <p className="flex items-center gap-2">
                      <User className="size-4 text-primary" /> GV{" "}
                      {data.nextClass.teacher}
                    </p>
                  )}
                </div>
                <Link
                  href="/portal/hoc-sinh/lich"
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
                >
                  Xem lịch học <ChevronRight className="size-4" />
                </Link>
              </>
            )}
          </section>

          {/* Kỹ năng của em */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
              <Sparkles className="size-4 text-primary" /> Kỹ năng của em
            </h2>
            {data.skills.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Chưa có đánh giá kỹ năng.
              </p>
            ) : (
              <div className="space-y-3">
                {data.skills.map((s, i) => (
                  <SkillRow key={i} s={s} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// 06/09 — hai trạng thái MỚI phải có hình riêng, nếu không chúng rơi vào nhánh cuối và
// trông y hệt "chưa diễn ra": buổi ĐÃ HUỶ và buổi giáo viên CHƯA CHẤM.
const DOT_CLS: Record<JourneyDot["status"], string> = {
  today: "size-5 rounded-full bg-primary ring-2 ring-success ring-offset-2 ring-offset-card",
  done: "size-5 rounded-full bg-primary",
  makeup: "size-5 rounded-full bg-success",
  absent: "size-5 rounded-full border-2 border-destructive bg-card",
  "chua-cham": "size-5 rounded-full border-2 border-dashed border-caution bg-card",
  "da-huy": "size-5 rounded-full border-2 border-muted-foreground/40 bg-muted",
  future: "size-5 rounded-full border-2 border-border bg-card",
};
const DOT_TEN: Record<JourneyDot["status"], string> = {
  today: "Hôm nay",
  done: "Đã học",
  makeup: "Đã học bù",
  absent: "Vắng",
  "chua-cham": "Chưa điểm danh",
  "da-huy": "Buổi đã huỷ",
  future: "Chưa diễn ra",
};

function Dot({ dot }: { dot: JourneyDot }) {
  const cls = DOT_CLS[dot.status];
  const solid =
    dot.status === "done" || dot.status === "makeup" || dot.status === "today";
  const nhan = [DOT_TEN[dot.status], dot.title, dot.className && `Lớp ${dot.className}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex w-9 flex-col items-center gap-1.5">
      {dot.status === "today" ? (
        <span className="mb-0.5 whitespace-nowrap rounded-full bg-primary/10 px-1.5 text-[9px] font-bold uppercase text-primary">
          Hôm nay
        </span>
      ) : (
        <span className="mb-0.5 h-3.5" />
      )}
      <span title={nhan} className={cls} />
      <span
        className={`text-[10px] font-bold tabular-nums ${solid ? "text-foreground" : "text-muted-foreground"} ${dot.status === "da-huy" ? "line-through" : ""}`}
      >
        {dot.idx}
      </span>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-3 rounded-full ${cls}`} /> {label}
    </span>
  );
}

function Box({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "primary" | "destructive" | "caution" | "success";
}) {
  const c =
    tone === "primary"
      ? "text-primary"
      : tone === "destructive"
        ? "text-destructive"
        : tone === "caution"
          ? "text-caution"
          : tone === "success"
            ? "text-success"
            : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-2.5 text-center">
      <p className={`text-lg font-bold tabular-nums ${c}`}>{value}</p>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

function TodoRow({ t }: { t: StudentTodo }) {
  const Icon = t.kind === "KIỂM TRA" ? FileText : Pencil;
  return (
    <Link
      href={t.href}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted/50"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-foreground">
          {t.title}
        </span>
        <span className="mt-0.5 block text-xs font-medium text-muted-foreground">
          <b className={t.kind === "KIỂM TRA" ? "text-quiz" : "text-primary"}>
            {t.kind}
          </b>{" "}
          {t.meta}
        </span>
      </span>
      <span
        className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold ${t.overdue ? "bg-destructive/10 text-destructive" : "bg-caution/10 text-caution"}`}
      >
        {t.overdue ? "Quá hạn" : "Cần làm"}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function ResultRowView({ r }: { r: ResultRow }) {
  const pct = r.total > 0 ? Math.round((r.score / r.total) * 100) : 0;
  const tone =
    pct >= 80
      ? "text-success"
      : pct >= 50
        ? "text-caution"
        : "text-destructive";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {r.title}
      </p>
      <p className={`shrink-0 text-sm font-bold tabular-nums ${tone}`}>
        {r.score}/{r.total}
      </p>
    </div>
  );
}

function SkillRow({ s }: { s: SkillBar }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-semibold">
        <span className="text-foreground">{s.label}</span>
        <span className="tabular-nums text-primary">{s.pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${s.pct}%` }}
        />
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  tone,
  value,
  label,
}: {
  icon: typeof Pencil;
  tone: "primary" | "info" | "caution" | "success";
  value: string;
  label: string;
}) {
  const box =
    tone === "primary"
      ? "bg-primary/10 text-primary"
      : tone === "info"
        ? "bg-info/10 text-info"
        : tone === "caution"
          ? "bg-caution/10 text-caution"
          : "bg-success/10 text-success";
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <span
        className={`grid size-10 shrink-0 place-items-center rounded-xl ${box}`}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-lg font-bold text-foreground">{value}</p>
        <p className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
      </div>
    </div>
  );
}
