import Link from "next/link";
import { vnParts } from "@/lib/time/vn";
import { requireActiveStudent } from "@/lib/portal/session";
import { monthGridRange, shiftMonth } from "@/lib/lms/calendar";
import { getStudentCalendarEvents } from "@/lib/lms/calendar-data";
import { MonthCalendar } from "@/components/lms/month-calendar";
import { isPortalV2Enabled } from "@/lib/flags";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { SchedulePageV2 } from "@/components/portal/schedule-page";

export const dynamic = "force-dynamic";

function parseInt10(v: string | undefined, fallback: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export default async function PortalCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { studentId } = await requireActiveStudent();
  const sp = await searchParams;
  // 06/09 — tháng mặc định theo LỊCH VN. `now.getFullYear()/getMonth()` chạy theo TZ
  // tiến trình; Vercel là UTC, nên trong khoảng 00:00–07:00 giờ VN ngày mùng 1 thì lịch
  // mở ra ở THÁNG TRƯỚC và phụ huynh tưởng con không có buổi nào.
  const homNay = vnParts(new Date());
  const year = parseInt10(sp.y, homNay.year);
  const month0 = parseInt10(sp.m, homNay.month);
  const { from, to } = monthGridRange(year, month0);
  const events = await getStudentCalendarEvents(studentId, from, to);

  const prev = shiftMonth(year, month0, -1);
  const next = shiftMonth(year, month0, 1);

  // Portal v2 — trang Lịch học giống SataUI.
  if (isPortalV2Enabled()) {
    const schedule = await getStudentSchedule(studentId);
    const calendar = (
      <div className="space-y-2">
        <div className="flex justify-end gap-1">
          <Link
            href={`/portal/lich?y=${prev.year}&m=${prev.month0}`}
            scroll={false}
            className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
          >
            ‹
          </Link>
          <Link
            href={`/portal/lich?y=${next.year}&m=${next.month0}`}
            scroll={false}
            className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
          >
            ›
          </Link>
        </div>
        <MonthCalendar year={year} month0={month0} events={events} />
      </div>
    );
    return schedule ? (
      <SchedulePageV2 schedule={schedule} calendar={calendar} />
    ) : (
      <div className="p-6 text-sm text-muted-foreground">Chưa có lịch học.</div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Lịch học</h1>
        <div className="flex gap-2 text-sm">
          <Link
            href={`/portal/lich?y=${prev.year}&m=${prev.month0}`}
            scroll={false}
            className="rounded border px-2 py-1"
          >
            ←
          </Link>
          <Link
            href={`/portal/lich?y=${next.year}&m=${next.month0}`}
            scroll={false}
            className="rounded border px-2 py-1"
          >
            →
          </Link>
        </div>
      </div>
      <MonthCalendar year={year} month0={month0} events={events} />
    </div>
  );
}
