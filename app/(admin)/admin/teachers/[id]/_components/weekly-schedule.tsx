import { AlertTriangle } from "lucide-react";
import {
  buildWeeklySchedule,
  WEEKDAY_LABELS,
  type TeacherClassSlot,
} from "@/lib/teachers/schedule";

// FIX 10 phần 3 — lịch tuần GV + cảnh báo trùng giờ (server component, không animation).
export function WeeklySchedule({ slots }: { slots: TeacherClassSlot[] }) {
  const { days, conflicts } = buildWeeklySchedule(slots);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Lịch dạy trong tuần
        </h2>
        {conflicts.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-state-danger-soft px-2.5 py-0.5 text-xs font-semibold text-state-danger-ink">
            <AlertTriangle className="h-3.5 w-3.5" /> {conflicts.length} xung đột giờ
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
        {days.map((entries, d) => (
          <div key={d} className="rounded-lg bg-muted p-2">
            <p className="mb-1.5 text-center text-xs font-bold text-muted-foreground">
              {WEEKDAY_LABELS[d]}
            </p>
            <div className="space-y-1.5">
              {entries.length === 0 ? (
                <p className="text-center text-[11px] text-muted-foreground">—</p>
              ) : (
                entries.map((e, i) => (
                  <div
                    key={`${e.classId}-${i}`}
                    className={`rounded-md border p-1.5 text-[11px] leading-tight ${ e.conflict ? "border-state-danger bg-state-danger-soft text-state-danger-ink" : e.role === "assistant" ? "border-state-info-soft bg-state-info-soft text-state-info-ink" : "border-primary-soft bg-primary-soft text-primary" }`}
                  >
                    <div className="font-semibold tabular-nums">
                      {e.start}–{e.end}
                    </div>
                    <div className="truncate" title={e.label}>{e.label}</div>
                    {e.role === "assistant" && <div className="opacity-70">(trợ giảng)</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {conflicts.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-state-danger-ink">
          {conflicts.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {WEEKDAY_LABELS[c.day]}: “{c.a}” trùng giờ “{c.b}”
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
