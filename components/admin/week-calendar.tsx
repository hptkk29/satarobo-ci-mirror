import { format, eachDayOfInterval, isSameDay } from "date-fns";
import { vi } from "date-fns/locale";
import { MapPin, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ScheduleSession {
  id: string;
  date: Date;
  className: string;
  courseName?: string | null;
  centerName?: string | null;
  topic?: string | null;
  attendanceCount?: number;
  href?: string;
}

interface WeekCalendarProps {
  sessions: ScheduleSession[];
  weekStart: Date;
  weekEnd: Date;
}

export function WeekCalendar({ sessions, weekStart, weekEnd }: WeekCalendarProps) {
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  const today = new Date();

  // Group by yyyy-MM-dd key for stable lookup.
  const sessionsByDay = new Map<string, ScheduleSession[]>();
  for (const day of days) {
    sessionsByDay.set(format(day, "yyyy-MM-dd"), []);
  }
  for (const s of sessions) {
    const key = format(s.date, "yyyy-MM-dd");
    const bucket = sessionsByDay.get(key);
    if (bucket) bucket.push(s);
  }

  return (
    <>
      {/* Mobile: stacked day sections */}
      <div className="lg:hidden space-y-4">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const daySessions = sessionsByDay.get(key) ?? [];
          const isToday = isSameDay(day, today);
          return (
            <div key={key}>
              <div
                className={cn(
                  "flex items-baseline gap-2 mb-2 pb-1 border-b",
                  isToday && "border-primary",
                )}
              >
                <h3
                  className={cn(
                    "font-semibold text-sm uppercase",
                    isToday && "text-primary",
                  )}
                >
                  {format(day, "EEEE", { locale: vi })}
                </h3>
                <span className="text-sm text-muted-foreground">
                  {format(day, "dd/MM/yyyy")}
                </span>
                {isToday && (
                  <span className="text-xs px-1.5 py-0.5 bg-primary-soft text-primary rounded">
                    Hôm nay
                  </span>
                )}
              </div>
              {daySessions.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">— Không có buổi nào —</p>
              ) : (
                <div className="space-y-2">
                  {daySessions.map((s) => (
                    <SessionCard key={s.id} session={s} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: 7-column grid */}
      <div className="hidden lg:grid lg:grid-cols-7 gap-2">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const daySessions = sessionsByDay.get(key) ?? [];
          const isToday = isSameDay(day, today);
          return (
            <div key={key} className="flex flex-col min-h-[300px]">
              <div
                className={cn(
                  "text-center pb-2 mb-2 border-b-2",
                  isToday ? "border-primary" : "border-border",
                )}
              >
                <div
                  className={cn(
                    "text-xs uppercase font-semibold",
                    isToday && "text-primary",
                  )}
                >
                  {format(day, "EEE", { locale: vi })}
                </div>
                <div
                  className={cn(
                    "text-lg font-bold",
                    isToday && "text-primary",
                  )}
                >
                  {format(day, "dd/MM")}
                </div>
              </div>
              <div className="flex-1 space-y-2">
                {daySessions.map((s) => (
                  <SessionCard key={s.id} session={s} compact />
                ))}
                {daySessions.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center italic mt-4">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function SessionCard({
  session,
  compact = false,
}: {
  session: ScheduleSession;
  compact?: boolean;
}) {
  const inner = (
    <div className="border border-state-info-soft bg-state-info-soft rounded-lg p-2 text-xs hover:border-state-info hover:shadow-sm transition">
      <div className="font-semibold text-sm leading-tight text-foreground">
        {session.className}
      </div>
      {!compact && session.courseName && (
        <div className="text-xs text-muted-foreground mt-0.5">{session.courseName}</div>
      )}
      {session.topic && (
        <div className="flex items-start gap-1 mt-1 text-foreground">
          <FileText className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span className={cn("truncate", compact && "line-clamp-1")}>
            {session.topic}
          </span>
        </div>
      )}
      {session.centerName && (
        <div className="flex items-start gap-1 mt-1 text-muted-foreground">
          <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span className="truncate">{session.centerName}</span>
        </div>
      )}
      {typeof session.attendanceCount === "number" && session.attendanceCount > 0 && (
        <div className="mt-1 text-[10px] text-state-info-ink">
          {session.attendanceCount} HV đã điểm danh
        </div>
      )}
    </div>
  );

  if (session.href) {
    return (
      <a href={session.href} className="block">
        {inner}
      </a>
    );
  }
  return inner;
}
