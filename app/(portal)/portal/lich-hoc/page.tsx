import { requireActiveStudent } from "@/lib/portal/session";
import {
  getStudentSessions,
  getStudentProgressSummaries,
  getStudentAttendanceSummaries,
  type ClassAttendanceSummary,
} from "@/lib/portal/learning";
import { formatDateVN, formatDateDMY } from "@/lib/format/date";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lịch học | Sata Robo" };

export default async function LichHocPage() {
  const { studentId } = await requireActiveStudent();
  const [sessions, progress, summaries] = await Promise.all([
    getStudentSessions(studentId),
    getStudentProgressSummaries(studentId),
    getStudentAttendanceSummaries(studentId),
  ]);

  const upcoming = sessions.filter((s) => !s.past);
  const past = sessions.filter((s) => s.past).reverse();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-neutral-900">Lịch học</h1>

      {summaries.length > 0 && (
        <div className="space-y-3">
          {summaries.map((s) => (
            <AttendanceMetrics key={s.classId} s={s} />
          ))}
        </div>
      )}

      {progress.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {progress.map((p) => (
            <div
              key={p.classId}
              className="rounded-xl border border-orange-200 bg-orange-50 p-4"
            >
              <p className="text-sm font-semibold text-neutral-900">
                {p.courseName}
              </p>
              <p className="text-xs text-neutral-600">{p.className}</p>
              <p className="mt-2 text-lg font-bold text-orange-700">
                Đang học buổi {p.currentSession}
                <span className="text-sm font-medium text-neutral-600">
                  {" "}
                  / tổng {p.total || "—"}
                </span>
              </p>
              <p className="text-xs text-neutral-600">
                Đã học {p.attended} · Còn lại {p.remaining}
              </p>
              {p.expectedEndDate && (
                <p className="mt-1 text-xs text-neutral-600">
                  Dự kiến kết thúc: {formatDateVN(p.expectedEndDate)}
                </p>
              )}
              {p.nearingEnd && (
                <p className="mt-2 rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                  Sắp hết khoá — liên hệ trung tâm để tái tục cho con.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Section title="Sắp tới">
        {upcoming.length === 0 ? (
          <Empty>Chưa có buổi học nào được lên lịch.</Empty>
        ) : (
          upcoming.map((s) => <Row key={s.id} s={s} />)
        )}
      </Section>

      {past.length > 0 && (
        <Section title="Đã diễn ra">
          {past.map((s) => (
            <Row key={s.id} s={s} dim />
          ))}
        </Section>
      )}
    </div>
  );
}

function AttendanceMetrics({ s }: { s: ClassAttendanceSummary }) {
  const items: { label: string; value: number; tone: string }[] = [
    { label: "Tổng buổi", value: s.total, tone: "text-neutral-900" },
    { label: "Đã học", value: s.attended, tone: "text-green-700" },
    { label: "Vắng", value: s.absent, tone: "text-red-600" },
    { label: "Chờ học bù", value: s.needMakeup, tone: "text-amber-700" },
    { label: "Đã học bù", value: s.madeUp, tone: "text-[#7C3AED]" },
  ];
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-sm font-semibold text-neutral-900">{s.className}</p>
      <p className="text-xs text-neutral-600">{s.courseName}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-center"
          >
            <dd className={`text-lg font-bold ${it.tone}`}>{it.value}</dd>
            <dt className="text-[11px] text-neutral-500">{it.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-neutral-700">
        {title}
      </h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function Row({
  s,
  dim,
}: {
  s: {
    id: string;
    date: string;
    topic: string | null;
    className: string;
    lessonTitle: string | null;
    startTime: string | null;
    endTime: string | null;
  };
  dim?: boolean;
}) {
  const d = new Date(s.date);
  // #10 — giờ THẬT từ lịch lớp (startTime–endTime), không dùng giờ tạo record.
  const timeRange = s.startTime
    ? `${s.startTime}${s.endTime ? `–${s.endTime}` : ""}`
    : null;
  const weekday = d.toLocaleDateString("vi-VN", { weekday: "long" });
  const dateStr = formatDateDMY(d);
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 ${
        dim ? "opacity-70" : ""
      }`}
    >
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-orange-50 text-orange-700">
        <span className="text-base font-bold leading-none">{d.getDate()}</span>
        <span className="text-[10px]">Th{d.getMonth() + 1}</span>
      </div>
      <div className="min-w-0">
        <p className="font-medium text-neutral-900">
          {s.lessonTitle ?? s.topic ?? "Buổi học"}
        </p>
        <p className="text-xs text-neutral-600">
          {s.className} · {timeRange ? `${timeRange} · ` : ""}
          {weekday}, {dateStr}
        </p>
      </div>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
      {children}
    </li>
  );
}
