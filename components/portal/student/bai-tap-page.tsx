import { BookOpen, CircleCheck, Circle, Pencil, RotateCcw } from "lucide-react";
import type {
  AssignmentTrack,
  TrackItem,
} from "@/lib/portal/student-assignments";

// 06/09 — nhãn ngày do SERVER tính theo lịch VN (`it.nhanNgay`, `a.nhanHan`). Đây là
// Server Component; `getDate()` trong này chạy theo UTC trên Vercel và lệch một ngày
// trong khoảng 00:00–07:00 giờ VN.

export function StudentBaiTapPage({ data }: { data: AssignmentTrack }) {
  return (
    <div className="portal-v2 mx-auto w-full max-w-5xl space-y-6">
      {/* Hero cam */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/80 p-5 text-white sm:p-6">
        <BookOpen className="pointer-events-none absolute -right-3 -top-3 size-28 rotate-12 text-white/10" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/15 ring-4 ring-white/10">
              <BookOpen className="size-6" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-white/70">
                Khóa học
              </p>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                Bài tập của em
              </h1>
              <p className="mt-0.5 truncate text-xs font-medium text-white/80 sm:text-sm">
                {[
                  data.courseName,
                  data.teacher ? `Giáo viên: ${data.teacher}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="rounded-2xl bg-white/15 px-4 py-2 text-center backdrop-blur-sm">
              <span className="block text-lg font-bold">
                {data.done}/{data.total}
              </span>
              <span className="text-[11px] font-bold text-white/80">
                Buổi đã học
              </span>
            </span>
            <span className="rounded-2xl bg-white/15 px-4 py-2 text-center backdrop-blur-sm">
              <span className="block text-lg font-bold">
                {data.progressPct}%
              </span>
              <span className="text-[11px] font-bold text-white/80">
                Tiến độ
              </span>
            </span>
          </div>
        </div>
      </div>

      <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
        Lộ trình {data.total} buổi học
      </h2>
      {data.items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Chưa có buổi học nào.
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((it) => (
            <Row key={it.key} it={it} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ it }: { it: TrackItem }) {
  const a = it.assignment;
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${it.taught ? "border-success/20 bg-success/5" : "border-border bg-card"}`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-xl ${it.taught ? "bg-success text-white" : "bg-muted text-muted-foreground"}`}
      >
        {it.taught ? (
          <CircleCheck className="size-5" />
        ) : (
          <Circle className="size-5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-foreground">{it.nhan}</p>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">
          Ngày học: {it.nhanNgay || "—"}
        </p>
        {a && (
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">
            BT: {a.title}
            {a.nhanHan && (
              <>
                {" · Hạn: "}
                <b className="text-foreground">{a.nhanHan}</b>
              </>
            )}
          </p>
        )}
      </div>
      {!a ? (
        <span className="shrink-0 text-sm font-medium text-muted-foreground">
          Không có bài tập
        </span>
      ) : a.done ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-md bg-success/10 px-2 py-1 text-xs font-bold text-success">
            Đã làm
          </span>
          <a
            href={`/portal/bai-tap/${a.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <RotateCcw className="size-4" /> Làm lại
          </a>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          {a.overdue && (
            <span className="rounded-md bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive">
              Quá hạn
            </span>
          )}
          <a
            href={`/portal/bai-tap/${a.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Pencil className="size-4" /> Làm bài tập
          </a>
        </div>
      )}
    </div>
  );
}
