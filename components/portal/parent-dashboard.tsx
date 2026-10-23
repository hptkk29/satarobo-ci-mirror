import Link from "next/link";
import {
  Users,
  Wallet,
  Pencil,
  CalendarClock,
  CalendarDays,
  ArrowRight,
  ChevronRight,
  CheckCircle2,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ParentChildOverview } from "@/lib/portal/dashboard";
import type { NotificationRow } from "@/lib/portal/notifications";
import { PageHero, HeroMetric } from "@/components/portal/page-header";
import { formatDateVN } from "@/lib/format/date";

// Portal v2 (merge SataUI) — Dashboard phụ huynh, port trung thực giao diện SataUI
// (accent coral phụ huynh qua .portal-v2). RSC, data THẬT (getParentChildrenOverview
// + getParentNotifications), KHÔNG mock/zustand.

type Tone = "primary" | "caution" | "quiz" | "success";

function vnd(n: number): string {
  return n.toLocaleString("vi-VN") + "đ";
}
function initials(name: string): string {
  const w = name.trim().split(/\s+/);
  return (
    w
      .slice(-2)
      .map((x) => x[0])
      .join("") ||
    w[0]?.[0] ||
    "?"
  ).toUpperCase();
}
// Màu avatar per-con (giống SataUI: cam, xanh dương, xanh lá, tím...).
const AVATAR_COLORS = [
  "oklch(0.748 0.169 56.8)",
  "oklch(0.62 0.18 250)",
  "oklch(0.62 0.17 150)",
  "oklch(0.6 0.2 300)",
  "oklch(0.62 0.2 20)",
];
function toneBadge(t: Tone): string {
  return t === "caution"
    ? "bg-caution/10 text-caution"
    : t === "quiz"
      ? "bg-quiz/10 text-quiz"
      : t === "success"
        ? "bg-success/10 text-success"
        : "bg-primary/10 text-primary";
}

export function ParentDashboardV2({
  parentName,
  children: kids,
  notifications,
}: {
  parentName: string;
  children: ParentChildOverview[];
  notifications: NotificationRow[];
}) {
  const actions: {
    id: string;
    icon: LucideIcon;
    tone: Tone;
    title: string;
    desc: string;
    href: string;
    cta: string;
  }[] = [];
  for (const c of kids) {
    if (c.debt > 0)
      actions.push({
        id: `fin-${c.id}`,
        icon: Wallet,
        tone: "caution",
        title: "Học phí chưa đóng",
        desc: `${c.name} · ${vnd(c.debt)}`,
        href: "/portal/hoc-phi",
        cta: "Xem học phí",
      });
    if (c.needMakeup > 0)
      actions.push({
        id: `mk-${c.id}`,
        icon: CalendarClock,
        tone: "quiz",
        title: `${c.needMakeup} buổi cần học bù`,
        desc: `${c.name} · buổi vắng chưa được học bù`,
        href: "/portal/yeu-cau",
        cta: "Đăng ký",
      });
    if (c.pendingHomework > 0)
      actions.push({
        id: `hw-${c.id}`,
        icon: Pencil,
        tone: "primary",
        title: `${c.pendingHomework} bài chưa nộp`,
        desc: `${c.name} · nhắc con hoàn thành đúng hạn`,
        href: "/portal/bai-tap",
        cta: "Xem",
      });
  }
  const recentNotis = notifications.slice(0, 4);

  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      <PageHero
        icon={Users}
        overline="Cổng phụ huynh"
        title={`Chào ${parentName} 👋`}
        subtitle={`Đồng hành cùng ${kids.length} con tại SataRobo.`}
        metric={
          <HeroMetric
            label={actions.length > 0 ? "Việc cần xử lý" : "Số con"}
            value={actions.length > 0 ? `${actions.length}` : `${kids.length}`}
          />
        }
      />

      {/* Cần bạn xử lý */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
          <span className="grid size-6 place-items-center rounded-md bg-primary/10 text-primary">
            <CheckCircle2 className="size-4" />
          </span>
          Cần bạn xử lý
          {actions.length > 0 && (
            <Badge className="rounded-md border-none bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              {actions.length}
            </Badge>
          )}
        </h2>
        {actions.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success">
            <CheckCircle2 className="size-5 shrink-0" /> Mọi việc đều ổn — không
            có khoản nào cần xử lý ngay.
          </div>
        ) : (
          <div className="space-y-2">
            {actions.map((a) => (
              <Link
                key={a.id}
                href={a.href}
                className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition-colors hover:border-accent/40 hover:bg-muted"
              >
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-xl",
                    toneBadge(a.tone),
                  )}
                >
                  <a.icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-foreground">
                    {a.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
                    {a.desc}
                  </p>
                </div>
                <span className="hidden shrink-0 items-center gap-0.5 text-xs font-bold text-primary sm:inline-flex">
                  {a.cta} <ChevronRight className="size-3.5" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Các con */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
          Các con của bạn
        </h2>
        {kids.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Tài khoản chưa được liên kết với học viên nào. Liên hệ trung tâm
            Sata Robo để được hỗ trợ.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {kids.map((c, i) => (
              <div
                key={c.id}
                className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-white"
                    style={{
                      backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
                    }}
                  >
                    {initials(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-bold text-foreground">
                      {c.name}
                    </h3>
                    <p className="truncate text-xs font-medium text-muted-foreground">
                      {[c.courseName, c.className]
                        .filter(Boolean)
                        .join(" · ") ||
                        c.studentCode ||
                        "Chưa xếp lớp"}
                    </p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <span className="text-muted-foreground">
                      Tiến độ khóa học
                    </span>
                    <span className="shrink-0 tabular-nums text-primary">
                      {c.courseProgressRate}% · {c.daDienRa}/{c.totalSessions}
                    </span>
                  </div>
                  {/* Thanh vẽ theo TIẾN ĐỘ KHOÁ — cùng số với phần trăm in bên cạnh. Trước
                      04/09 cả hai lấy `attendanceRate` nên dòng "Tiến độ khoá học" in
                      "82% · 9/20" — 9/20 là 45%, hai số cãi nhau ngay trên một dòng. */}
                  <Progress value={c.courseProgressRate} className="h-1.5" />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat
                    label="Chuyên cần"
                    value={`${c.attendanceRate}%`}
                    tone={c.attendanceRate >= 90 ? "success" : "caution"}
                  />
                  <MiniStat
                    label="Bài chờ"
                    value={`${c.pendingHomework}`}
                    tone={c.pendingHomework > 0 ? "primary" : "success"}
                  />
                  <MiniStat
                    label="Học phí"
                    value={c.debt > 0 ? "Còn nợ" : "Đủ"}
                    tone={c.debt > 0 ? "caution" : "success"}
                  />
                </div>
                <div className="mt-auto flex items-center gap-2 pt-1">
                  <Link
                    href="/portal/ho-so-con"
                    className="min-w-0 flex-1 truncate rounded-xl border border-border bg-card py-2 text-center text-sm font-bold text-foreground transition-colors hover:bg-muted"
                  >
                    Hồ sơ
                  </Link>
                  <Link
                    href="/portal/ho-so-con"
                    className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <span className="truncate">Cổng học sinh</span>{" "}
                    <ArrowRight className="size-4 shrink-0" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Lịch học + Thông báo */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Lịch học
            </h2>
            <Link
              href="/portal/lich"
              className="inline-flex items-center gap-0.5 text-sm font-bold text-primary hover:underline"
            >
              Xem lịch <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <Link
            href="/portal/lich"
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <CalendarDays className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">
                Lịch buổi học của con
              </p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                Xem lịch tháng + buổi sắp tới
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
          </Link>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Thông báo
            </h2>
            <Link
              href="/portal/thong-bao"
              className="inline-flex items-center gap-0.5 text-sm font-bold text-primary hover:underline"
            >
              Tất cả <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="rounded-2xl border border-border bg-card p-2">
            {recentNotis.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Không có thông báo.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {recentNotis.map((n) => (
                  <Link
                    key={n.id}
                    href="/portal/thong-bao"
                    className="flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-muted"
                  >
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                      <Bell className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="line-clamp-1 text-sm font-bold text-foreground">
                        {n.title}
                      </p>
                      <p className="line-clamp-2 text-xs font-medium text-muted-foreground">
                        {n.body}
                      </p>
                      <p className="pt-0.5 text-xs font-medium text-muted-foreground/80">
                        {formatDateVN(n.publishedAt)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone;
}) {
  const cls =
    tone === "success"
      ? "text-success"
      : tone === "caution"
        ? "text-caution"
        : tone === "quiz"
          ? "text-quiz"
          : "text-primary";
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-1.5 text-center">
      <p className={cn("text-sm font-bold leading-tight tabular-nums", cls)}>
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs font-medium leading-tight text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
