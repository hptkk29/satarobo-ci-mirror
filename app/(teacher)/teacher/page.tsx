// app/(teacher)/teacher/page.tsx — L5: trang chủ site GV = "Tổng quan" (phiếu GV
// câu 45). Bố cục port ĐÚNG theo TeachUI dashboard: banner nhắc điểm danh trước
// giờ học · 3 StatCard (lớp phụ trách / buổi chưa điểm danh / buổi chưa nhận xét)
// · "Lớp dạy hôm nay" · 2 cột (chưa điểm danh / chưa nhận xét) · bài tập đang mở.
//
// TẤT CẢ dữ liệu là THẬT qua scopedDb (actor.assignedClassIds) — không mock.
// "Đã điểm danh?" suy từ có/không bản ghi Attendance; "đã nhận xét x/y" dùng
// summarizeSessionFeedback (cùng helper trang /nhan-xet để 2 nơi không lệch).
//
// Cửa sổ quét việc tồn: 30 ngày gần nhất tính cả hôm nay (bounded — dashboard
// "cần xử lý" chỉ quan tâm buổi gần; buổi cũ hơn 30 ngày hiếm khi còn phải xử lý).
//
// ⚠️ Câu 46: GV KHÔNG xem SĐT/email phụ huynh. Trang này chỉ chạm tên lớp/buổi +
// đếm — không đưa contact PH (hay cả tên HV) vào payload client.
import Link from "next/link";
import {
  AlarmClock,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  ClipboardCheck,
  ClipboardPen,
  Clock,
  FlaskConical,
  NotebookPen,
  School,
  Users,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import {
  groupMarkedBySession,
  groupRosterByClass,
  sessionsMissingAttendance,
} from "@/lib/lms/attendance-pending";
import { summarizeSessionFeedback } from "@/lib/lms/session-feedback-roster";
import { getTeacherTrialTable } from "@/lib/lms/teacher-schedule";
import { demChoDanhGia } from "@/lib/lms/trial-row-status";
import { vnDateOnly } from "@/lib/time/vn";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SuccessBanner } from "./_components/ui/empty-state";
import { SessionStatusPill } from "./_components/ui/session-status-pill";
import { StatCard } from "./_components/ui/stat-card";

export const metadata = { title: "Tổng quan | Giáo viên Sata Robo" };

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh (UTC+7, không DST)
const TZ = "Asia/Ho_Chi_Minh";

/** [00:00, 24:00) hôm nay theo giờ tường VN, trả mốc UTC để query Timestamptz. */
function vnTodayRange(now: Date): { from: Date; to: Date } {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const startUtc =
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) -
    VN_OFFSET_MS;
  return {
    from: new Date(startUtc),
    to: new Date(startUtc + 24 * 60 * 60 * 1000),
  };
}

const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: TZ,
});

/** "Thứ Bảy, 27 tháng 6 năm 2026" theo giờ VN. */
function greetingDate(now: Date): string {
  const wd = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    timeZone: TZ,
  }).format(now);
  const num = (opt: Intl.DateTimeFormatOptions) =>
    Number(new Intl.DateTimeFormat("en", { ...opt, timeZone: TZ }).format(now));
  const cap = wd.charAt(0).toUpperCase() + wd.slice(1);
  return `${cap}, ${num({ day: "numeric" })} tháng ${num({ month: "numeric" })} năm ${num({ year: "numeric" })}`;
}

/** Tên gọi (từ cuối bắt đầu bằng chữ cái) — "Hoàng Phan Tuấn Kiệt" → "Kiệt". */
function firstName(full: string): string {
  const parts = full
    .trim()
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p));
  return parts.length ? parts[parts.length - 1]! : full;
}

/** Số phút từ NOW đến lúc buổi (theo startTime "HH:mm" của lớp) bắt đầu hôm nay. */
function minutesUntil(
  startTime: string,
  vnMidnightMs: number,
  nowMs: number,
): number | null {
  const [h, m] = startTime.split(":").map(Number);
  if (h == null || m == null || Number.isNaN(h) || Number.isNaN(m)) return null;
  const startUtc = vnMidnightMs + h * 3_600_000 + m * 60_000;
  return Math.round((startUtc - nowMs) / 60_000);
}

export default async function TeacherHomePage() {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  const now = new Date();
  const { from: todayStart, to: todayEnd } = vnTodayRange(now);
  const windowFrom = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Buổi 30 ngày gần nhất (tới hết hôm nay) của lớp mình, trừ buổi đã hủy.
  const sessions = classIds.length
    ? await sdb.classSession.findMany({
        where: {
          classId: { in: classIds },
          status: { not: "CANCELLED" },
          date: { gte: windowFrom, lte: todayEnd },
        },
        select: {
          id: true,
          date: true,
          topic: true,
          status: true,
          classId: true,
          class: {
            select: {
              name: true,
              startTime: true,
              endTime: true,
              room: { select: { name: true } },
            },
          },
        },
        orderBy: { date: "asc" },
      })
    : [];

  const sessionIds = sessions.map((s) => s.id);

  // Tổng học viên đang học (distinct) — đọc QUA quan hệ class (enrollment dev
  // centerId=null bị scopedDb lọc nếu query thẳng). Chỉ đếm, không lộ tên/PII.
  const rosters = classIds.length
    ? await sdb.class.findMany({
        where: { id: { in: classIds } },
        select: {
          // `id` để dựng rosterByClass cho phép đếm "buổi chưa điểm danh" bên dưới —
          // hai ô trên cùng một dashboard phải đọc CÙNG một sĩ số.
          id: true,
          enrollments: {
            where: rosterWhere("dang-hoc"),
            select: { studentId: true },
          },
        },
      })
    : [];
  const totalStudents = new Set(
    rosters.flatMap((c) => c.enrollments.map((e) => e.studentId)),
  ).size;

  // Attendance + feedback gom 1 lượt cho các buổi trên; open assignments đếm riêng.
  // (cùng pattern /nhan-xet: fetch tách rồi tổng hợp in-memory — tránh nested
  // include phức tạp qua scopedDb). Assignment lọc theo classId ∈ assignedClassIds.
  const [attRows, fbRows, openAssignments, trialTable] = await Promise.all([
    sessionIds.length
      ? sdb.attendance.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { sessionId: true, studentId: true, status: true },
        })
      : Promise.resolve([]),
    sessionIds.length
      ? sdb.studentSessionFeedback.findMany({
          where: { classSessionId: { in: sessionIds } },
          select: { classSessionId: true, studentId: true },
        })
      : Promise.resolve([]),
    classIds.length
      ? sdb.assignment.count({
          where: { classId: { in: classIds }, status: "PUBLISHED" },
        })
      : Promise.resolve(0),
    // Suất trải nghiệm — CÙNG lời gọi mà /teacher/trial dùng (cùng cửa sổ 7 ngày tới +
    // 90 ngày lịch sử), để ô đếm và bảng không thể nói ngược nhau.
    //
    // KHÔNG qua scopedDb: `TrialClassSession` ∉ SCOPED_MODELS, hàm tự giới hạn own-rows
    // theo teacherId (buổi mình dạy HOẬC lớp mình phụ trách).
    getTeacherTrialTable(session.user.id, { today: vnDateOnly(now) }),
  ]);

  const attBySession = new Map<
    string,
    { studentId: string; status: string }[]
  >();
  for (const a of attRows) {
    const list = attBySession.get(a.sessionId) ?? [];
    list.push({ studentId: a.studentId, status: a.status });
    attBySession.set(a.sessionId, list);
  }
  const fbBySession = new Map<string, string[]>();
  for (const f of fbRows) {
    const list = fbBySession.get(f.classSessionId) ?? [];
    list.push(f.studentId);
    fbBySession.set(f.classSessionId, list);
  }

  type Sess = (typeof sessions)[number];
  const statOf = (s: Sess) =>
    summarizeSessionFeedback(
      attBySession.get(s.id) ?? [],
      fbBySession.get(s.id) ?? [],
    );

  const todaySessions = sessions.filter(
    (s) => s.date >= todayStart && s.date < todayEnd,
  );
  // "Chưa điểm danh" = buổi (trong cửa sổ, đã tới ngày) điểm danh chưa PHỦ ĐỦ sĩ số.
  //
  // ⚠️ KHÔNG dùng `statOf(s).attendanceTaken` ("có ≥1 dòng Attendance"): buổi chấm
  // thiếu người, và buổi chỉ có đúng một dòng do duyệt phiếu xin nghỉ của phụ huynh,
  // đều biến mất khỏi ô này — giáo viên không còn đường nào biết mình còn nợ điểm
  // danh (QA vòng 1, BUG-029; cùng gốc với cột "Cần xử lý" ở /teacher/lop, nay hai
  // nơi gọi CHUNG một hàm nên không thể nói ngược nhau nữa).
  const rosterByClass = groupRosterByClass(rosters);
  const markedBySession = groupMarkedBySession(
    attRows.map((a) => ({ sessionId: a.sessionId, studentId: a.studentId })),
  );
  const missingIds = new Set(
    sessionsMissingAttendance({
      sessions: sessions.map((s) => ({ id: s.id, classId: s.classId })),
      markedBySession,
      rosterByClass,
    }).map((s) => s.id),
  );
  const needAttendance = sessions.filter((s) => missingIds.has(s.id));
  // Ô thứ năm: suất trải nghiệm đã dạy mà chưa nhập phiếu.
  //
  // Trước 03/09 trang chủ đếm đúng 4 việc và KHÔNG việc nào là Trial ⇒ giáo viên còn
  // phiếu treo vẫn thấy bảng sạch, không có dấu hiệu nào để biết phải vào /teacher/trial.
  // Trial có mặt ở /teacher/lich, nhưng đó là LỊCH chứ không phải VIỆC.
  const trialRows = [...trialTable.upcoming, ...trialTable.done];
  const trialChoDanhGia = demChoDanhGia(trialRows);
  // Chỉ bày ô khi giáo viên THẬT SỰ có dạy trải nghiệm: phần lớn giáo viên không
  // đứng ca Trial nào, thêm một ô "0" vĩnh viễn là làm loãng ba ô còn lại.
  const coTrial = trialRows.length > 0;
  // "Chưa nhận xét" = buổi đã điểm danh, có HV đi học, nhận xét chưa đủ.
  const needEvaluation = sessions.filter((s) => {
    const st = statOf(s);
    return st.attendanceTaken && st.attended > 0 && !st.complete;
  });

  // Nhắc điểm danh: buổi hôm nay chưa điểm danh, sắp bắt đầu (hoặc vừa bắt đầu
  // trong 30'). Ưu tiên buổi gần giờ nhất; urgent nếu ≤15'.
  const vnMidnightMs = todayStart.getTime();
  const nowMs = now.getTime();
  const reminder = todaySessions
    // Cùng tiêu chí với ô đếm: buổi mới chấm được nửa lớp thì VẪN nhắc.
    .filter((s) => missingIds.has(s.id) && s.class.startTime)
    .map((s) => ({
      s,
      minutes: minutesUntil(s.class.startTime!, vnMidnightMs, nowMs),
    }))
    .filter(
      (x): x is { s: Sess; minutes: number } =>
        x.minutes != null && x.minutes >= -30,
    )
    .sort((a, b) => a.minutes - b.minutes)[0];
  const reminderUrgent = reminder != null && reminder.minutes <= 15;

  const attHref = (s: Sess) =>
    `/teacher/lop?classId=${s.classId}&sessionId=${s.id}`;
  // 21/08 — luồng giáo viên chốt lại: Lớp của tôi → mở lớp → chọn buổi → điểm danh →
  // nhận xét + ảnh. Hai màn XUYÊN LỚP (/teacher/diem-danh, /teacher/nhan-xet) không còn
  // thuộc luồng GV — chức năng đó chuyển sang admin/sale (/admin/attendance). Vì vậy
  // mọi lối bấm ở đây đi thẳng vào Class Hub, KHÔNG vòng qua hai màn kia.
  const evalHref = (s: Sess) =>
    `/teacher/lop?classId=${s.classId}&tab=nhan-xet&rvSession=${s.id}`;
  const timeRange = (s: Sess) =>
    s.class.startTime && s.class.endTime
      ? `${s.class.startTime}–${s.class.endTime}`
      : dayFmt.format(s.date);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          Xin chào, {firstName(session.user.name ?? "thầy/cô")}{" "}
          <span aria-hidden>👋</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {greetingDate(now)}
        </p>
      </div>

      {/* Nhắc điểm danh trước giờ học */}
      {reminder && (
        <Link
          href={attHref(reminder.s)}
          className={cn(
            "mb-6 flex items-center gap-4 rounded-xl border px-5 py-4 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            reminderUrgent
              ? "border-primary-soft bg-primary-soft hover:bg-primary-soft-hover dark:border-primary dark:bg-primary-soft dark:hover:bg-primary-soft-hover"
              : "border-state-info-soft bg-state-info-soft hover:bg-state-info-soft-hover dark:border-state-info",
          )}
        >
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white",
              reminderUrgent ? "bg-primary" : "bg-state-info",
            )}
          >
            <AlarmClock className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "font-bold",
                reminderUrgent
                  ? "text-primary-ink dark:text-primary-ink"
                  : "text-state-info-ink",
              )}
            >
              {reminder.minutes > 0
                ? `Lớp ${reminder.s.class.name} bắt đầu sau ${reminder.minutes} phút`
                : `Lớp ${reminder.s.class.name} đã bắt đầu`}
              {reminderUrgent ? " — điểm danh ngay" : ""}
            </p>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {[
                timeRange(reminder.s),
                reminder.s.class.room?.name,
                reminder.s.topic,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span
            className={cn(
              "hidden shrink-0 items-center gap-1 rounded-lg px-3.5 py-2 text-sm font-semibold text-white sm:inline-flex",
              reminderUrgent ? "bg-primary" : "bg-state-info",
            )}
          >
            <ClipboardCheck className="h-4 w-4" aria-hidden /> Điểm danh
          </span>
        </Link>
      )}

      {/* Stat tổng quan */}
      <div
        className={cn(
          "mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2",
          coTrial ? "lg:grid-cols-5" : "lg:grid-cols-4",
        )}
      >
        <StatCard
          icon={School}
          value={classIds.length}
          label="Lớp tôi phụ trách"
          tone="brand"
        />
        <StatCard
          icon={Users}
          value={totalStudents}
          label="Học viên đang học"
          tone="blue"
        />
        <StatCard
          icon={ClipboardCheck}
          value={needAttendance.length}
          label="Buổi chưa điểm danh"
          tone={needAttendance.length ? "amber" : "green"}
        />
        <StatCard
          icon={ClipboardPen}
          value={needEvaluation.length}
          label="Buổi chưa nhận xét"
          tone={needEvaluation.length ? "amber" : "green"}
        />
        {coTrial && (
          // Bọc <Link>: bốn ô trên chỉ là số đếm của thứ đã có danh sách ngay bên dưới,
          // còn Trial thì không — không có lối bấm thì ô này báo có việc mà không chỉ
          // được đi đâu làm.
          <Link href="/teacher/trial" className="block">
            <StatCard
              icon={FlaskConical}
              value={trialChoDanhGia}
              label="Trial chờ đánh giá"
              tone={trialChoDanhGia ? "amber" : "green"}
              hint={`${trialRows.length} suất trải nghiệm của bạn`}
            />
          </Link>
        )}
      </div>

      {/* Lớp dạy hôm nay */}
      <section className="t-card mb-6 overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <CalendarDays className="h-4 w-4 text-primary-ink" aria-hidden />
            Lớp dạy hôm nay ({todaySessions.length})
          </h2>
          <Badge variant="secondary">{dayFmt.format(now)}</Badge>
        </header>
        {todaySessions.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Hôm nay bạn không có lớp.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {todaySessions.map((s) => {
              // "Xong" ở đây phải cùng nghĩa với ô đếm phía trên, nếu không thì
              // dashboard vừa báo "1 buổi chưa điểm danh" vừa gắn dấu xong cho đúng
              // buổi đó.
              const done = !missingIds.has(s.id);
              return (
                <li key={s.id}>
                  <Link
                    href={attHref(s)}
                    className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                  >
                    <div className="flex w-16 shrink-0 flex-col items-center rounded-lg bg-primary-soft py-2 text-primary-ink">
                      <span className="text-base leading-none font-extrabold">
                        {s.class.startTime ?? "—"}
                      </span>
                      {s.class.room?.name && (
                        <span className="mt-1 text-[11px] font-medium text-primary-ink">
                          {s.class.room.name}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground">
                        {s.class.name}
                      </p>
                      {s.topic && (
                        <p className="truncate text-sm text-muted-foreground">
                          {s.topic}
                        </p>
                      )}
                    </div>
                    {done ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-state-success-soft px-2.5 py-1 text-xs font-semibold text-state-success-ink">
                        <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Đã
                        điểm danh
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-state-warning-soft px-2.5 py-1 text-xs font-semibold text-state-warning-ink">
                        Chưa điểm danh
                      </span>
                    )}
                    <ChevronRight
                      className="h-5 w-5 shrink-0 text-muted-foreground/50"
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Cần xử lý: điểm danh / nhận xét */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PendingList
          title="Lớp chưa điểm danh"
          icon={CalendarCheck}
          sessions={needAttendance}
          emptyText="Đã điểm danh đầy đủ các buổi."
          href={attHref}
          renderMeta={(s) => `${dayFmt.format(s.date)} · ${timeRange(s)}`}
          seeAllHref="/teacher/lop"
        />
        <PendingList
          title="Buổi chưa nhận xét"
          icon={ClipboardPen}
          sessions={needEvaluation}
          emptyText="Đã nhận xét đầy đủ học viên."
          href={evalHref}
          renderMeta={(s) => {
            const st = statOf(s);
            return `${dayFmt.format(s.date)} · đã nhận xét ${st.reviewed}/${st.attended} HV`;
          }}
          seeAllHref="/teacher/lop"
        />
      </div>

      {/* Tổng quan bài tập */}
      <section className="t-card mt-6 overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <NotebookPen className="h-4 w-4 text-primary-ink" aria-hidden />
            Bài tập &amp; kiểm tra đang mở
          </h2>
          <Link
            href="/teacher/cham-bai"
            className="rounded-sm text-sm font-semibold text-primary-ink outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
          >
            Xem tất cả
          </Link>
        </header>
        <div className="px-5 py-4">
          {openAssignments === 0 ? (
            <SuccessBanner icon={CircleCheck}>
              Không có bài tập nào đang chờ.
            </SuccessBanner>
          ) : (
            <p className="text-sm text-muted-foreground">
              Bạn đang có{" "}
              <span className="font-bold text-foreground">
                {openAssignments}
              </span>{" "}
              bài tập / kiểm tra đang mở ở các lớp.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function PendingList<
  T extends {
    id: string;
    status: string;
    class: { name: string };
  },
>({
  title,
  icon: Icon,
  sessions,
  emptyText,
  href,
  renderMeta,
  seeAllHref,
}: {
  title: string;
  icon: typeof CalendarCheck;
  sessions: T[];
  emptyText: string;
  href: (s: T) => string;
  renderMeta: (s: T) => string;
  /** Trang liệt kê đầy đủ — hiện ở chân thẻ khi danh sách bị cắt bớt. */
  seeAllHref: string;
}) {
  // Đây là màn "việc hôm nay", không phải trang danh sách. Đổ hết 39 buổi vào đây
  // thì thẻ này cao gấp mười lần thẻ bên cạnh và đẩy phần bài tập xuống dưới màn —
  // giáo viên phải cuộn qua một cột dài mới thấy được thứ khác. Cắt còn 8 dòng;
  // con số đầy đủ vẫn nằm ở huy hiệu bên phải tiêu đề, và có lối sang trang đủ.
  const LIMIT = 8;
  const shown = sessions.slice(0, LIMIT);
  const rest = sessions.length - shown.length;

  return (
    <section className="t-card overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Icon className="h-4 w-4 text-primary-ink" aria-hidden />
          {title}
        </h2>
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
            sessions.length
              ? "bg-state-warning-soft text-state-warning-ink"
              : "bg-state-success-soft text-state-success-ink",
          )}
        >
          {sessions.length} buổi
        </span>
      </header>
      {sessions.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((s) => (
            <li key={s.id}>
              <Link
                href={href(s)}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">
                    {s.class.name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" aria-hidden />
                    {renderMeta(s)}
                  </p>
                </div>
                <SessionStatusPill status={s.status} />
                <ChevronRight
                  className="h-5 w-5 shrink-0 text-muted-foreground/50"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
          {rest > 0 && (
            <li>
              <Link
                href={seeAllHref}
                className="flex items-center justify-center gap-1 px-5 py-3 text-sm font-semibold text-primary-ink transition-colors hover:bg-muted/50 hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
              >
                Xem tất cả {sessions.length} buổi
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
