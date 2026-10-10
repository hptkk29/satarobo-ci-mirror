import { CalendarDays, Clock, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StudentSchedule, ScheduleSession } from "@/lib/portal/schedule";
import { PageHero } from "@/components/portal/page-header";

// Portal v2 — trang Lịch học (giống SataUI): hero + buổi kế tiếp + tuần này + sắp tới + lịch tháng.

// 06/09 — KHÔNG format ngày ở đây nữa. Đây là Server Component và Vercel chạy UTC:
// `getDate()/getDay()` trả lời theo giờ UTC, nên trong khoảng 00:00–07:00 giờ VN (phụ
// huynh xem lịch trước khi đưa con đi học) buổi CHIỀU NAY bị in sai ngày và mất nhãn
// "Hôm nay". Nhãn ngày/thứ nay tính sẵn ở server theo lịch VN — xem
// `BuoiHoc.nhanNgay/nhanThu/homNay` trong lib/portal/buoi-hoc.ts.

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-white/15 px-4 py-2 text-center backdrop-blur-sm">
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] font-semibold text-white/80">{label}</p>
    </div>
  );
}

export function SchedulePageV2({
  schedule,
  calendar,
}: {
  schedule: StudentSchedule;
  calendar: React.ReactNode;
}) {
  const s = schedule;
  return (
    <div className="portal-v2 mx-auto w-full max-w-6xl space-y-6">
      <PageHero
        icon={CalendarDays}
        title="Lịch học"
        subtitle={[
          s.studentName,
          s.courseName,
          s.className ? `Lớp ${s.className}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        metric={
          <div className="flex gap-2">
            <HeroStat value={`${s.rate}%`} label="Chuyên cần" />
            {/* "Đã học" cũ mập mờ: 10/12 là số buổi LỚP ĐÃ DẠY, không phải số buổi con
                có mặt (đó là % Chuyên cần bên trái). */}
            <HeroStat value={`${s.done}/${s.total}`} label="Buổi đã dạy" />
            <HeroStat value={`${s.remaining}`} label="Còn lại" />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left */}
        <div className="space-y-6 lg:col-span-2">
          {/* Buổi học tiếp theo */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Buổi học tiếp theo
            </h2>
            {s.next ? (
              <div className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-base font-bold text-foreground">
                    {s.next.nhan}
                  </p>
                  {s.next.homNay ? (
                    <span className="shrink-0 rounded-md bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                      Hôm nay
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                      {s.next.nhanNgayNgan}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  {s.next.time && (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-4 text-primary" /> {s.next.time}
                    </span>
                  )}
                  {(s.next.room || s.next.teacher || s.next.className) && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-4 text-primary" />{" "}
                      {[
                        s.next.className && `Lớp ${s.next.className}`,
                        s.next.room,
                        s.next.teacher && `GV ${s.next.teacher}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                Chưa có buổi học sắp tới.
              </p>
            )}
          </section>

          {/* Lịch học tuần này */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Lịch học tuần này
            </h2>
            <div className="rounded-2xl border border-border bg-card divide-y divide-border">
              {s.thisWeek.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Tuần này không có buổi học.
                </p>
              ) : (
                s.thisWeek.map((it) => <WeekRow key={it.id} it={it} />)
              )}
            </div>
          </section>

          {/* Các buổi học sắp tới */}
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
              Các buổi học sắp tới
            </h2>
            <div className="space-y-2">
              {s.upcoming.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                  Chưa có buổi học sắp tới.
                </p>
              ) : (
                s.upcoming.map((it, i) => (
                  <div
                    key={it.id}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3"
                  >
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-xl text-sm font-bold",
                        i === 0
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {it.order ?? "•"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">
                        {it.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
                        {[
                          `Dự kiến: ${it.nhanThu}, ${it.nhanNgay}`,
                          it.className && `Lớp ${it.className}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {i === 0 && (
                      <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                        {it.homNay ? "Hôm nay" : "Kế tiếp"}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Right: Lịch tháng */}
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
            <CalendarDays className="size-4 text-primary" /> Lịch tháng
          </h2>
          <div className="rounded-2xl border border-border bg-card p-3">
            {calendar}
          </div>
        </div>
      </div>
    </div>
  );
}

function WeekRow({ it }: { it: ScheduleSession }) {
  const today = it.homNay;
  // Buổi bị huỷ VẪN hiện trong tuần, gắn nhãn rõ — giấu đi thì phụ huynh vẫn đưa con tới.
  const daHuy = it.status === "CANCELLED";
  return (
    <div className="flex items-start gap-3 p-3">
      <div className="w-12 shrink-0 text-center">
        <p
          className={cn(
            "text-xs font-bold",
            today ? "text-primary" : "text-foreground",
          )}
        >
          {it.nhanThu}
        </p>
        <p className="text-xs font-medium text-muted-foreground">
          {it.nhanNgayNgan}
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-bold text-foreground",
            daHuy && "line-through opacity-60",
          )}
        >
          {it.title}
        </p>
        <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
          {[
            it.time,
            it.className && `Lớp ${it.className}`,
            it.room,
            it.teacher && `GV ${it.teacher}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-md px-2 py-0.5 text-xs font-bold",
          daHuy
            ? "bg-destructive/10 text-destructive"
            : today
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
        )}
      >
        {daHuy ? "Đã huỷ" : today ? "Hôm nay" : "Sắp tới"}
      </span>
    </div>
  );
}
