import Link from "next/link";
import { vnParts } from "@/lib/time/vn";
import { requireActiveStudent } from "@/lib/portal/session";
import { monthGridRange, shiftMonth } from "@/lib/lms/calendar";
import { getStudentCalendarEvents } from "@/lib/lms/calendar-data";
import { MonthCalendar } from "@/components/lms/month-calendar";
import { getStudentSchedule } from "@/lib/portal/schedule";
import { SchedulePageV2 } from "@/components/portal/schedule-page";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Lịch học | Sata Robo",
  robots: { index: false },
};

function parseInt10(v: string | undefined, fallback: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

// Cổng học sinh — Lịch học (tái dùng SchedulePageV2, hero coral như cổng phụ huynh).
export default async function StudentCalendarPage({
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
  const [events, schedule] = await Promise.all([
    getStudentCalendarEvents(studentId, from, to),
    getStudentSchedule(studentId),
  ]);

  const prev = shiftMonth(year, month0, -1);
  const next = shiftMonth(year, month0, 1);
  const calendar = (
    <div className="space-y-2">
      <div className="flex justify-end gap-1">
        <Link
          href={`/portal/hoc-sinh/lich?y=${prev.year}&m=${prev.month0}`}
          scroll={false}
          className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
        >
          ‹
        </Link>
        <Link
          href={`/portal/hoc-sinh/lich?y=${next.year}&m=${next.month0}`}
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
