import Link from "next/link";
import { CheckCircle2, AlertTriangle, ClipboardList } from "lucide-react";
import { resolveActor } from "@/lib/auth/actor";
import { getPendingTasks, summarizePendingTasks, type TaskUser } from "@/lib/pending-tasks";

// Module nhắc việc PHẦN 2 — khu "Cần xử lý" trên dashboard (server component).
export async function PendingTasksSection({ user }: { user: TaskUser }) {
  // Actor resolve 1 lần/request (React.cache) → lọc nhóm việc theo cờ RBAC_V2 + sinh shadow.
  const groups = await getPendingTasks(user, await resolveActor(user.id));
  if (groups.length === 0) return null;

  const { total, overdue } = summarizePendingTasks(groups);
  const active = groups.filter((g) => g.count > 0);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <ClipboardList className="h-4 w-4 text-primary" /> Cần xử lý
        </h2>
        <div className="flex items-center gap-2">
          {overdue > 0 && (
            <span className="rounded-full bg-state-danger-soft px-2.5 py-0.5 text-xs font-bold text-state-danger-ink">
              {overdue} quá hạn
            </span>
          )}
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-white">
            {total} việc
          </span>
        </div>
      </div>

      {active.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl bg-state-success-soft p-3 text-sm text-state-success-ink">
          <CheckCircle2 className="h-4 w-4" /> Đã sạch — không có việc nào cần xử lý.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {active.map((g) => (
            <Link
              key={g.type}
              href={g.href}
              className={`flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors ${ g.overdueCount > 0 ? "border-state-danger-soft bg-state-danger-soft/50 hover:border-state-danger" : "border-border hover:border-primary" }`}
            >
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{g.label}</p>
                {g.items.length > 0 && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {g.items.map((i) => i.label).slice(0, 2).join(" · ")}
                    {g.count > 2 && ` …+${g.count - 2}`}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-foreground">
                  {g.count}
                </span>
                {g.overdueCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-state-danger-ink">
                    <AlertTriangle className="h-3 w-3" /> {g.overdueCount} quá hạn
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
