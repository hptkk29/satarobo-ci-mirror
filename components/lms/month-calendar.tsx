import { monthGrid, WEEKDAY_LABELS } from "@/lib/lms/calendar";
import { vnYmd } from "@/lib/time/vn";
import { DayCellEvents } from "@/components/lms/day-cell-events";

// Kiểu chuyển sang `lib/lms/cal-event.ts` — xuất lại ở đây để 5 nơi đang import từ
// file này không phải sửa.
export type { CalEvent } from "@/lib/lms/cal-event";
import type { CalEvent } from "@/lib/lms/cal-event";

const VN_MONTH = (m0: number) => `Tháng ${m0 + 1}`;

// Lịch tháng dùng chung (admin + portal). Server component, CSS grid thuần (không
// chart/animation lib → không vướng ESLint boundary).
export function MonthCalendar({
  year,
  month0,
  events,
}: {
  year: number;
  month0: number;
  events: CalEvent[];
}) {
  const weeks = monthGrid(year, month0);
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) {
    const list = byDay.get(e.iso);
    if (list) list.push(e);
    else byDay.set(e.iso, [e]);
  }
  // 06/09 — "hôm nay" theo LỊCH VN. Đây là Server Component và Vercel chạy UTC, nên
  // trong khoảng 00:00–07:00 giờ VN ô được tô cam là ngày HÔM QUA.
  const todayIso = vnYmd(new Date());

  return (
    <div>
      <p className="mb-2 text-sm font-medium">
        {VN_MONTH(month0)} / {year}
      </p>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-neutral-200 text-xs">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="bg-neutral-50 py-1 text-center font-medium text-neutral-600">
            {w}
          </div>
        ))}
        {weeks.flat().map((d) => {
          const evs = byDay.get(d.iso) ?? [];
          return (
            <div
              key={d.iso}
              className={`min-h-[72px] bg-white p-1 ${d.inMonth ? "" : "bg-neutral-50 text-neutral-300"}`}
            >
              <div className={`text-right ${d.iso === todayIso ? "font-bold text-orange-600" : ""}`}>
                {d.date.getDate()}
              </div>
              {/* 05/09 — bỏ dòng "+3" chết: nó không bấm được nên ngày đông lớp là ngày
                  không xem được. Nay 5 lớp/trang + nút lật ở góc dưới phải của từng ô. */}
              <DayCellEvents events={evs} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
