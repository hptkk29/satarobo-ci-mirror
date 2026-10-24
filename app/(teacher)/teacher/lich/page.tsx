// app/(teacher)/teacher/lich/page.tsx — L6: "Lịch dạy" (phiếu GV câu 47) + 3 view
// Tháng/Tuần/Danh sách (port visual từ mock satarobo-ui-giaovien sessions/page.tsx).
//
// Điều hướng THUẦN server qua searchParams (không client state):
//   ?view=thang|tuan|ds (default "thang" — lịch tháng; "ds" = danh sách + SessionActions)
//   ?moc=YYYY-MM-DD     (mốc tháng/tuần; với view ds → lọc đúng 1 ngày)
// Mọi nút chuyển view / prev-next đều là Link CHỈ-query ("?view=...") — chạy đúng cả
// trên host giaovien (clean URL /lich) LẪN localhost/preview (path thật /teacher/lich).
//
// Buổi lớp: lọc theo actor.assignedClassIds HOẶC buổi GV dạy thay/thực dạy
// (substituteTeacherId/actualTeacherId = userId). Đọc qua withMakeupException:
// ClassSession ∈ MAKEUP_EXCEPTION_MODELS → GV dạy bù LIÊN CƠ SỞ thấy đúng buổi ở cơ sở
// khác (câu 47 "dạy nhiều cơ sở OK"). An toàn: WHERE khoá theo assignedClassIds/userId
// nên chỉ lộ buổi CỦA CHÍNH GV, không phải toàn bộ buổi cơ sở khác.
// Overlay: buổi Trial (teacherId = mình) + ca làm việc (userId = mình) + ngày nghỉ
// (toàn hệ thống hoặc cơ sở mình) — đọc qua lib/lms/teacher-schedule (own-rows).
//
// ⚠️ Câu 46: KHÔNG hiển thị SĐT/email/contact phụ huynh — chỉ tên lớp + giờ + chủ đề.
// ⚠️ Múi giờ: mọi phép tính ngày theo giờ tường VN (UTC+7, không DST) — biểu diễn mỗi
// ngày VN bằng mốc "UTC 00:00" (dayUtc) để so sánh cột @db.Date; riêng ClassSession.date
// là Timestamptz → trừ 7h ra mốc UTC thật (toVnInstant) khi query.
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CalendarOff,
  CalendarRange,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Clock,
  List,
  type LucideIcon,
} from "lucide-react";
import type { HolidayType, SessionStatus } from "@prisma/client";
import type { VariantProps } from "class-variance-authority";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, withMakeupException } from "@/lib/db-scope";
import { isSessionLifecycleV2Enabled } from "@/lib/flags";
import { sessionTimeRange } from "@/lib/classes/slots";
import { getMyAssignments } from "@/lib/cham-cong/my-schedule";
import {
  getTeacherTrialSessions,
  getVisibleHolidays,
  type TeacherTrialSessionRow,
} from "@/lib/lms/teacher-schedule";
import { cn } from "@/lib/utils";
import { caseCuaGiaoVien } from "@/lib/hoc-bu/case-doc";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "../_components/ui/empty-state";
import { PageHeader } from "../_components/ui/page-header";
import { ScheduleToolbar } from "./_components/schedule-toolbar";
import { SessionActions } from "./_components/session-actions";

export const metadata = { title: "Lịch làm việc | Giáo viên Sata Robo" };

/* ───────────────────────────── Helpers ngày (giờ VN) ─────────────────────────────
 * Quy ước "dayUtc": Date tại UTC 00:00 của một NGÀY theo lịch VN — cộng/trừ DAY_MS
 * không lệch vì UTC không có DST. Dùng thẳng cho cột @db.Date (Prisma trả UTC 00:00). */

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh (UTC+7, không DST)
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_BACK = 3; // view ds mặc định: buổi COMPLETED gần đây
const DAYS_FORWARD = 28; // ~4 tuần tới

/** dayUtc của NGÀY HÔM NAY theo giờ tường VN. */
function vnTodayUtc(now = new Date()): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  return new Date(
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()),
  );
}
/** "YYYY-MM-DD" của một dayUtc — khóa nhóm + giá trị ?moc=. */
function isoKey(dayUtc: Date): string {
  return dayUtc.toISOString().slice(0, 10);
}
function addDaysUtc(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}
/** Thứ Hai của tuần chứa dayUtc (tuần VN bắt đầu Thứ 2). */
function startOfWeekUtc(d: Date): Date {
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Thứ 2 … 6 = CN
  return addDaysUtc(d, -dow);
}
function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonthsUtc(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
/** dayUtc → mốc UTC THẬT của 00:00 giờ VN (query cột Timestamptz như ClassSession.date). */
function toVnInstant(dayUtc: Date): Date {
  return new Date(dayUtc.getTime() - VN_OFFSET_MS);
}
/** Parse ?moc=YYYY-MM-DD — round-trip qua isoKey để loại ngày ảo (2026-02-31). */
function parseMoc(raw?: string): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  if (y < 2000 || y > 2100) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return isoKey(t) === raw ? t : null;
}
const two = (n: number) => String(n).padStart(2, "0");

const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});
/** Khóa nhóm theo NGÀY (giờ VN) cho Timestamptz — "YYYY-MM-DD" khớp isoKey của dayUtc. */
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

/* ───────────────────────────────── Nhãn hiển thị ───────────────────────────────── */

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const SESSION_STATUS: Record<
  SessionStatus,
  { label: string; variant: BadgeVariant }
> = {
  SCHEDULED: { label: "Đã lên lịch", variant: "secondary" },
  IN_PROGRESS: { label: "Đang diễn ra", variant: "default" },
  COMPLETED: { label: "Đã dạy", variant: "outline" },
  CANCELLED: { label: "Đã hủy", variant: "destructive" },
};

const HOLIDAY_TYPE_LABEL: Record<HolidayType, string> = {
  HOLIDAY: "Nghỉ lễ",
  MAINTENANCE: "Bảo trì",
  EVENT: "Sự kiện",
  OTHER: "Ngày nghỉ",
};

const WEEKDAYS = [
  "Thứ 2",
  "Thứ 3",
  "Thứ 4",
  "Thứ 5",
  "Thứ 6",
  "Thứ 7",
  "Chủ nhật",
];
const DOW_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/* ─────────────────────────────── Kiểu dữ liệu view ─────────────────────────────── */

type ViewMode = "thang" | "tuan" | "ds";

/** Buổi lớp (projection từ query — khớp select bên dưới). */
type ClassSessionRow = {
  id: string;
  classId: string;
  date: Date;
  topic: string | null;
  status: SessionStatus;
  lessonId: string | null;
  class: { name: string; startTime: string | null; endTime: string | null };
};

/** Gom theo ngày: buổi lớp + buổi Trial (labelDate để format tiêu đề nhóm). */
type DayAgg = {
  labelDate: Date;
  classes: ClassSessionRow[];
  trials: TeacherTrialSessionRow[];
  /** Case dạy bù GV này dạy (docs/hoc-bu/DAC-TA.md) — cùng lịch, cùng công dạy. */
  bus: BuRow[];
};
type BuRow = Awaited<ReturnType<typeof caseCuaGiaoVien>>[number];
/** Ca làm trong ngày: mã ca + khung giờ từ lưới phân ca; `leave` = ô nghỉ đã duyệt. */
type DayShift = { labels: string[]; leave: boolean };
type DayHoliday = { name: string; typeLabel: string };

/**
 * Giờ hiển thị buổi lớp: lấy từ CHÍNH buổi (`s.date` đã mang giờ từ lúc sinh), độ dài
 * suy từ khung giờ lớp.
 *
 * ⚠️ 07/08 — trước đây ưu tiên `class.startTime–endTime`. Với lớp dùng Kế hoạch lịch học
 * nhiều giai đoạn, hai field đó chỉ là BẢN SAO của giai đoạn đang hiệu lực: buổi 08:00
 * của giai đoạn 2 vẫn bị in là "17:30–19:30" của giai đoạn 1, và khoá sort cũng sai nên
 * buổi sáng bị xếp sau buổi chiều của lớp khác trong cùng ngày.
 *
 * Đi qua `sessionTimeRange` (không tự format nữa) để dùng chung chốt chặn buổi cũ còn ở
 * 00:00 giờ VN — buổi chưa backfill giờ vẫn in giờ lớp thay vì "00:00".
 */
function sessionStart(s: ClassSessionRow): string {
  return sessionTimeRange(s.date, s.class.startTime, s.class.endTime).start;
}
function classTime(s: ClassSessionRow): string {
  const r = sessionTimeRange(s.date, s.class.startTime, s.class.endTime);
  return r.end ? `${r.start}–${r.end}` : r.start;
}

/** Trộn buổi lớp + Trial của 1 ngày, sort theo giờ bắt đầu ("HH:mm" so chuỗi được). */
function mergeDayItems(agg: DayAgg | undefined) {
  if (!agg) return [];
  return [
    ...agg.classes.map((s) => ({
      kind: "class" as const,
      sort: sessionStart(s),
      s,
    })),
    ...agg.trials.map((t) => ({
      kind: "trial" as const,
      sort: t.startTime,
      t,
    })),
    ...agg.bus.map((b) => ({
      kind: "bu" as const,
      sort: b.startTime,
      b,
    })),
  ].sort((a, b) => a.sort.localeCompare(b.sort));
}

/* ──────────────────────────────────── Page ──────────────────────────────────── */

const VALID_STATUS = new Set<string>([
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

export default async function TeacherSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    moc?: string;
    q?: string;
    type?: string;
    status?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate — guard cho type-narrow

  const sp = await searchParams;
  // Mặc định LỊCH THÁNG (07/08/2026 — yêu cầu chủ dự án). "ds"/"tuan" vẫn vào được
  // qua nút chuyển view; ô ngày trong lịch tháng vẫn nhảy sang ?view=ds&moc=<ngày>.
  const view: ViewMode =
    sp.view === "ds" || sp.view === "tuan" ? sp.view : "thang";
  // Bộ lọc toolbar (giữ trong searchParams — server lọc trước khi gom theo ngày).
  const q = (sp.q ?? "").trim().toLowerCase();
  const typeFilter = sp.type === "lop" || sp.type === "trial" ? sp.type : "all";
  const statusFilter =
    sp.status && VALID_STATUS.has(sp.status) ? sp.status : "all";
  const todayUtc = vnTodayUtc();
  const todayKey = isoKey(todayUtc);
  const mocUtc = parseMoc(sp.moc);
  const anchor = mocUtc ?? todayUtc; // mốc điều hướng tháng/tuần (default hôm nay VN)

  // Khoảng ngày [fromDay, toDay) theo view (dayUtc — nửa mở).
  let fromDay: Date;
  let toDay: Date;
  let monthStart = todayUtc; // chỉ dùng khi view=thang
  let weekStart = todayUtc; // chỉ dùng khi view=tuan
  if (view === "thang") {
    monthStart = startOfMonthUtc(anchor);
    const daysInMonth = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const gridStart = startOfWeekUtc(monthStart);
    const leading = Math.round(
      (monthStart.getTime() - gridStart.getTime()) / DAY_MS,
    );
    const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;
    fromDay = gridStart;
    toDay = addDaysUtc(gridStart, totalCells);
  } else if (view === "tuan") {
    weekStart = startOfWeekUtc(anchor);
    fromDay = weekStart;
    toDay = addDaysUtc(weekStart, 7);
  } else if (mocUtc) {
    // ds + moc: đúng 1 ngày (click từ ô lịch tháng).
    fromDay = mocUtc;
    toDay = addDaysUtc(mocUtc, 1);
  } else {
    // ds mặc định: GIỮ NGUYÊN hành vi cũ [hôm nay−3, hôm nay+28].
    fromDay = addDaysUtc(todayUtc, -DAYS_BACK);
    toDay = addDaysUtc(todayUtc, DAYS_FORWARD + 1);
  }

  const actor = await resolveActor(session.user.id);
  const sdb = withMakeupException(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];
  const assigned = new Set(classIds);

  // Buổi của lớp mình HOẶC buổi mình dạy thay/thực dạy (userId). withMakeupException
  // bỏ lọc cơ sở cho ClassSession (∈ MAKEUP_EXCEPTION_MODELS) → buổi dạy bù/thay ở cơ
  // sở khác hiện đúng. WHERE khoá theo assignedClassIds/userId nên chỉ buổi CỦA GV.
  const [sessions, trials, shiftRows, holidayRows, bus] = await Promise.all([
    sdb.classSession.findMany({
      where: {
        date: { gte: toVnInstant(fromDay), lt: toVnInstant(toDay) },
        OR: [
          { classId: { in: classIds } },
          { substituteTeacherId: session.user.id },
          { actualTeacherId: session.user.id },
        ],
      },
      select: {
        id: true,
        classId: true,
        date: true,
        topic: true,
        status: true,
        lessonId: true, // #06 — có bài giảng → hiện "Đề xuất sửa giáo án"
        class: { select: { name: true, startTime: true, endTime: true } },
      },
      orderBy: { date: "asc" },
      take: 500,
    }),
    getTeacherTrialSessions(session.user.id, fromDay, toDay),
    getMyAssignments(session.user.id, fromDay, toDay),
    // Vá 24/07 — getVisibleHolidays nhận actor, tự tính per-model scope Holiday.
    getVisibleHolidays(actor, fromDay, toDay),
    caseCuaGiaoVien(session.user.id, fromDay, toDay),
  ]);

  // #06 — gate "Hoàn tất buổi" (lifecycle v2). Đọc 1 lần, truyền xuống card.
  const lifecycleV2 = isSessionLifecycleV2Enabled();

  // ── Lọc theo toolbar (loại sự kiện / trạng thái / từ khoá) ──────────────────────
  // Chỉ lọc SỰ KIỆN (buổi lớp + Trial). Ca làm & ngày nghỉ là bối cảnh ngày → giữ
  // nguyên (trừ khi lọc theo trạng thái buổi thì cũng không ẩn — chúng không có
  // "trạng thái buổi"). status áp cho buổi lớp; Trial không có SessionStatus.
  const fSessions = sessions.filter((s) => {
    if (typeFilter === "trial") return false;
    if (statusFilter !== "all" && s.status !== statusFilter) return false;
    if (
      q &&
      !(
        s.class.name.toLowerCase().includes(q) ||
        (s.topic ?? "").toLowerCase().includes(q)
      )
    )
      return false;
    return true;
  });
  const fTrials = trials.filter((t) => {
    if (typeFilter === "lop") return false;
    // Trial bị loại khi lọc theo trạng thái buổi lớp cụ thể (không phải "all").
    if (statusFilter !== "all") return false;
    if (q && !t.trialClassName.toLowerCase().includes(q)) return false;
    return true;
  });

  // Buổi dạy bù: đi cùng nhóm "không phải lớp chính" như Trial khi lọc theo loại.
  const fBus = bus.filter((b) => {
    if (typeFilter === "lop") return false;
    if (statusFilter !== "all") return false;
    if (q && !`${b.khoa} ${b.buoi}`.toLowerCase().includes(q)) return false;
    return true;
  });

  // ── Gom theo NGÀY (khóa "YYYY-MM-DD" giờ VN) ────────────────────────────────────
  const byDay = new Map<string, DayAgg>();
  const dayAgg = (key: string, labelDate: Date): DayAgg => {
    let g = byDay.get(key);
    if (!g) {
      g = { labelDate, classes: [], trials: [], bus: [] };
      byDay.set(key, g);
    }
    return g;
  };
  for (const s of fSessions)
    dayAgg(dayKeyFmt.format(s.date), s.date).classes.push(s);
  // @db.Date trả UTC 00:00 = 07:00 VN cùng ngày lịch → isoKey khớp khóa VN.
  for (const t of fTrials) dayAgg(isoKey(t.date), t.date).trials.push(t);
  for (const b of fBus) dayAgg(isoKey(b.date), b.date).bus.push(b);

  // L5 chấm công v3: ca làm đọc từ lưới ShiftAssignment (Quản lý xếp), không còn tự đăng ký.
  const shiftsByDay = new Map<string, DayShift>();
  for (const r of shiftRows) {
    shiftsByDay.set(isoKey(r.date), {
      labels: [r.timeLabel ? `${r.code} ${r.timeLabel}` : `${r.code} · ${r.name}`],
      leave: r.isLeave, // ô nghỉ đã duyệt (P/X) — vẫn hiện, kèm nhãn
    });
  }

  // Ngày nghỉ có thể kéo dài [date, endDate] → trải ra từng ngày, clamp vào khoảng view.
  const holidayByDay = new Map<string, DayHoliday>();
  for (const h of holidayRows) {
    const start = Math.max(h.date.getTime(), fromDay.getTime());
    const end = Math.min(
      (h.endDate ?? h.date).getTime(),
      toDay.getTime() - DAY_MS,
    );
    for (let t = start; t <= end; t += DAY_MS) {
      const key = isoKey(new Date(t));
      if (!holidayByDay.has(key)) {
        holidayByDay.set(key, {
          name: h.name,
          typeLabel: HOLIDAY_TYPE_LABEL[h.type],
        });
      }
    }
  }

  // Query string giữ mốc khi chuyển Tháng↔Tuần (toggle "Danh sách" KHÔNG mang moc —
  // quay về danh sách đầy đủ như cũ, tránh kẹt ở chế độ lọc 1 ngày).
  const mocQS = mocUtc ? `&moc=${isoKey(mocUtc)}` : "";
  // Giữ bộ lọc toolbar khi chuyển view / tháng-tuần (nối vào href điều hướng).
  const filterParams = new URLSearchParams();
  if (q) filterParams.set("q", (sp.q ?? "").trim());
  if (typeFilter !== "all") filterParams.set("type", typeFilter);
  if (statusFilter !== "all") filterParams.set("status", statusFilter);
  const filterQS = filterParams.toString() ? `&${filterParams.toString()}` : "";

  // Phụ đề đổi theo view + trạng thái lọc 1 ngày.
  const subtitle =
    view === "ds" && mocUtc
      ? `Các buổi trong ngày ${isoKey(mocUtc).split("-").reverse().join("/")}.`
      : view === "ds"
        ? `Buổi dạy của bạn từ ${DAYS_BACK} ngày trước đến ${DAYS_FORWARD} ngày tới — gồm cả buổi dạy thay và dạy bù, kể cả ở cơ sở khác.`
        : // KHÔNG mô tả bằng tên màu ("tô cam nhạt", "ô vàng"): câu này đã sai một
          // lần khi đổi nhận diện, và người mù màu vốn không đọc được theo màu.
          // Chú giải ngay dưới đây có ô mẫu + nhãn — đó mới là chỗ giải nghĩa.
          "Lịch dạy lớp, Trial và ca làm việc.";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lịch làm việc"
        subtitle={subtitle}
        actions={
          /* Chuyển view — Link CHỈ-query, giữ mốc + bộ lọc đang xem. */
          <div className="inline-flex rounded-lg border border-border bg-muted/50 p-1">
            <ToggleLink
              active={view === "thang"}
              href={`?view=thang${mocQS}${filterQS}`}
              label="Tháng"
              icon={CalendarDays}
            />
            <ToggleLink
              active={view === "tuan"}
              href={`?view=tuan${mocQS}${filterQS}`}
              label="Tuần"
              icon={CalendarRange}
            />
            <ToggleLink
              active={view === "ds"}
              href={`?view=ds${filterQS}`}
              label="Danh sách"
              icon={List}
            />
          </div>
        }
      />

      <ScheduleToolbar q={sp.q ?? ""} type={typeFilter} status={statusFilter} />

      {view !== "ds" && <Legend />}

      {view === "thang" && (
        <MonthView
          monthStart={monthStart}
          fromDay={fromDay}
          toDay={toDay}
          todayKey={todayKey}
          filterQS={filterQS}
          byDay={byDay}
          shiftsByDay={shiftsByDay}
          holidayByDay={holidayByDay}
        />
      )}

      {view === "tuan" && (
        <WeekView
          weekStart={weekStart}
          todayKey={todayKey}
          filterQS={filterQS}
          byDay={byDay}
          shiftsByDay={shiftsByDay}
          holidayByDay={holidayByDay}
          assigned={assigned}
        />
      )}

      {view === "ds" && (
        <ListView
          byDay={byDay}
          shiftsByDay={shiftsByDay}
          holidayByDay={holidayByDay}
          assigned={assigned}
          lifecycleV2={lifecycleV2}
          singleDay={!!mocUtc}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────── View: Danh sách ─────────────────────────────── */

function ListView({
  byDay,
  shiftsByDay,
  holidayByDay,
  assigned,
  lifecycleV2,
  singleDay,
}: {
  byDay: Map<string, DayAgg>;
  shiftsByDay: Map<string, DayShift>;
  holidayByDay: Map<string, DayHoliday>;
  assigned: Set<string>;
  lifecycleV2: boolean;
  singleDay: boolean;
}) {
  const keys = [...byDay.keys()].sort();
  return (
    <div className="space-y-5">
      {singleDay && (
        // "?view=ds" chứ không phải "?" — từ khi mặc định là lịch tháng, "?" sẽ
        // rơi về view Tháng, không còn đúng nghĩa "toàn bộ danh sách".
        <Link
          href="?view=ds"
          scroll={false}
          className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Toàn bộ lịch dạy
        </Link>
      )}
      {keys.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title={
            singleDay
              ? "Không có buổi dạy nào trong ngày này."
              : "Không có buổi dạy nào trong khoảng thời gian này."
          }
        />
      ) : (
        keys.map((key) => {
          const agg = byDay.get(key)!;
          const holiday = holidayByDay.get(key);
          const shift = shiftsByDay.get(key);
          return (
            <section key={key} className="space-y-2">
              <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold capitalize text-foreground">
                {dayFmt.format(agg.labelDate)}
                {holiday && (
                  <span className="rounded bg-state-warning-soft px-1.5 py-0.5 text-[10px] font-semibold normal-case text-state-warning-ink">
                    {holiday.typeLabel} · {holiday.name}
                  </span>
                )}
                {shift && (
                  <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold normal-case text-primary-ink">
                    {shift.labels.join(" · ")}
                    {shift.leave ? " · xin nghỉ" : ""}
                  </span>
                )}
              </h2>
              <div className="space-y-2">
                {mergeDayItems(agg).map((it) =>
                  it.kind === "class" ? (
                    <ClassSessionCard
                      key={it.s.id}
                      s={it.s}
                      isSubstitute={!assigned.has(it.s.classId)}
                      lifecycleV2={lifecycleV2}
                    />
                  ) : it.kind === "trial" ? (
                    <TrialCard key={it.t.id} t={it.t} />
                  ) : (
                    <BuCard key={it.b.id} b={it.b} />
                  ),
                )}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

/** Card buổi lớp — GIỮ NGUYÊN nội dung + SessionActions như bản danh sách cũ. */
function ClassSessionCard({
  s,
  isSubstitute,
  lifecycleV2,
}: {
  s: ClassSessionRow;
  isSubstitute: boolean;
  lifecycleV2: boolean;
}) {
  const st = SESSION_STATUS[s.status];
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{s.class.name}</CardTitle>
          <div className="flex shrink-0 items-center gap-1.5">
            {isSubstitute && <Badge variant="outline">Dạy thay</Badge>}
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground">{classTime(s)}</p>
        {s.topic && (
          <p className="mt-0.5 text-sm text-muted-foreground">{s.topic}</p>
        )}
        {s.status !== "CANCELLED" && (
          <Link
            href={`/teacher/lop?classId=${s.classId}&sessionId=${s.id}`}
            className="mt-2 inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-primary-ink outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
          >
            Mở điểm danh →
          </Link>
        )}
        <SessionActions
          sessionId={s.id}
          status={s.status}
          hasLesson={s.lessonId != null}
          lifecycleV2={lifecycleV2}
        />
      </CardContent>
    </Card>
  );
}

/** Card buổi Trial trong danh sách — chỉ tên lớp trải nghiệm + giờ (câu 46: không HV/PH). */
function TrialCard({ t }: { t: TeacherTrialSessionRow }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{t.trialClassName}</CardTitle>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge className="border-transparent bg-primary-soft text-primary-ink">
              Trial
            </Badge>
            <Badge variant={t.status === "COMPLETED" ? "outline" : "secondary"}>
              {t.status === "COMPLETED" ? "Đã dạy" : "Đã lên lịch"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground">
          {t.startTime}–{t.endTime}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">Lớp trải nghiệm</p>
        <Link
          href="/teacher/trial"
          className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline"
        >
          Phiếu đánh giá Trial
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

/** Card buổi DẠY BÙ — mở trang điểm danh của case (docs/hoc-bu/DAC-TA.md). */
function BuCard({ b }: { b: BuRow }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Học bù · {b.khoa}</CardTitle>
          <Badge variant={b.status === "COMPLETED" ? "outline" : "secondary"}>
            {b.status === "COMPLETED" ? "Đã dạy" : "Đã lên lịch"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground">
          {b.startTime}–{b.endTime} · {b.soBe} bé
        </p>
        <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{b.buoi}</p>
        <Link
          href={`/teacher/hoc-bu/${b.id}`}
          className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary-ink hover:underline"
        >
          {b.status === "COMPLETED" ? "Xem điểm danh" : "Mở điểm danh"}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────── View: Tháng ──────────────────────────────── */

function MonthView({
  monthStart,
  fromDay,
  toDay,
  todayKey,
  filterQS,
  byDay,
  shiftsByDay,
  holidayByDay,
}: {
  monthStart: Date;
  fromDay: Date;
  toDay: Date;
  todayKey: string;
  filterQS: string;
  byDay: Map<string, DayAgg>;
  shiftsByDay: Map<string, DayShift>;
  holidayByDay: Map<string, DayHoliday>;
}) {
  const month0 = monthStart.getUTCMonth();
  const year = monthStart.getUTCFullYear();
  const cellCount = Math.round((toDay.getTime() - fromDay.getTime()) / DAY_MS);
  const cells = Array.from({ length: cellCount }, (_, i) => {
    const dayUtc = addDaysUtc(fromDay, i);
    return {
      key: isoKey(dayUtc),
      dayNum: dayUtc.getUTCDate(),
      inMonth: dayUtc.getUTCMonth() === month0,
    };
  });

  // Đếm buổi (lớp + Trial) TRONG tháng đang xem (bỏ ngày tràn từ tháng kề).
  const monthPrefix = isoKey(monthStart).slice(0, 7);
  let monthCount = 0;
  for (const [key, agg] of byDay) {
    if (key.startsWith(monthPrefix))
      monthCount += agg.classes.length + agg.trials.length + agg.bus.length;
  }

  return (
    <div>
      <CalNav
        label={`Tháng ${month0 + 1}/${year}`}
        count={`${monthCount} buổi trong tháng`}
        prevHref={`?view=thang&moc=${isoKey(addMonthsUtc(monthStart, -1))}${filterQS}`}
        nextHref={`?view=thang&moc=${isoKey(addMonthsUtc(monthStart, 1))}${filterQS}`}
        todayHref={`?view=thang${filterQS}`}
        todayLabel="Tháng này"
      />
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[600px]">
          <div className="mb-1.5 grid grid-cols-7 gap-1.5">
            {DOW_SHORT.map((d) => (
              <p
                key={d}
                className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {d}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((c) => {
              const agg = byDay.get(c.key);
              const items = mergeDayItems(agg); // buổi lớp + Trial, sort theo giờ
              const holiday = holidayByDay.get(c.key);
              const shift = shiftsByDay.get(c.key);
              const isToday = c.key === todayKey;
              const shown = items.slice(0, 2);
              const overflow = items.length - shown.length;
              return (
                // Click ô → danh sách đúng ngày đó (href CHỈ-query). CỐ Ý KHÔNG
                // `scroll={false}`: đây là bấm XEM CHI TIẾT một ngày — cả thân trang
                // đổi từ lưới lịch sang danh sách, phải cuộn lên đầu mới thấy ngày vừa chọn.
                <Link
                  key={c.key}
                  href={`?view=ds&moc=${c.key}`}
                  title={
                    shift ? `Ca làm: ${shift.labels.join(" · ")}` : undefined
                  }
                  className={cn(
                    "t-card-hover block min-h-[92px] rounded-lg border p-1 transition-colors",
                    holiday
                      ? "border-state-warning-soft bg-state-warning-soft dark:border-state-warning dark:bg-state-warning-soft" // nền nhạt: ngày nghỉ
                      : shift
                        ? "border-primary-soft bg-primary-soft dark:border-primary dark:bg-primary-soft" // viền: ngày có ca làm
                        : "border-border bg-card",
                    !c.inMonth && "opacity-40",
                  )}
                >
                  <div className="mb-0.5 flex items-center justify-between">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold",
                        isToday
                          ? "bg-primary text-white"
                          : "text-muted-foreground",
                      )}
                    >
                      {c.dayNum}
                    </span>
                    {holiday ? (
                      <CalendarOff
                        className="h-3 w-3 text-state-warning-ink"
                        aria-hidden
                      />
                    ) : (
                      shift && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      )
                    )}
                  </div>
                  {holiday && (
                    <p
                      className="mb-1 truncate rounded bg-state-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-state-warning-ink"
                      title={`${holiday.name} · ${holiday.typeLabel}`}
                    >
                      {holiday.name}
                    </p>
                  )}
                  <div className="space-y-1">
                    {shown.map((it) =>
                      it.kind === "class" ? (
                        <p
                          key={it.s.id}
                          title={`${classTime(it.s)} · ${it.s.class.name}`}
                          className="truncate rounded border-l-2 border-state-info bg-state-info-soft px-1.5 py-0.5 text-[10px] font-semibold text-state-info-ink"
                        >
                          {sessionStart(it.s)} {it.s.class.name}
                        </p>
                      ) : it.kind === "trial" ? (
                        <p
                          key={it.t.id}
                          title={`${it.t.startTime} · ${it.t.trialClassName}`}
                          className="truncate rounded border-l-2 border-primary bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary-ink"
                        >
                          {it.t.startTime} {it.t.trialClassName}
                        </p>
                      ) : (
                        <p
                          key={it.b.id}
                          title={`${it.b.startTime} · Học bù · ${it.b.khoa}`}
                          className="truncate rounded border-l-2 border-state-warning bg-state-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-state-warning-ink"
                        >
                          {it.b.startTime} Học bù · {it.b.khoa}
                        </p>
                      ),
                    )}
                    {overflow > 0 && (
                      <p className="px-1.5 text-[10px] font-medium text-muted-foreground">
                        +{overflow} buổi nữa
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────── View: Tuần ──────────────────────────────── */

function WeekView({
  weekStart,
  todayKey,
  filterQS,
  byDay,
  shiftsByDay,
  holidayByDay,
  assigned,
}: {
  weekStart: Date;
  todayKey: string;
  filterQS: string;
  byDay: Map<string, DayAgg>;
  shiftsByDay: Map<string, DayShift>;
  holidayByDay: Map<string, DayHoliday>;
  assigned: Set<string>;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const dayUtc = addDaysUtc(weekStart, i);
    return { key: isoKey(dayUtc), dayNum: dayUtc.getUTCDate() };
  });
  const weekEnd = addDaysUtc(weekStart, 6);
  const rangeLabel = `${two(weekStart.getUTCDate())}/${two(weekStart.getUTCMonth() + 1)} – ${two(
    weekEnd.getUTCDate(),
  )}/${two(weekEnd.getUTCMonth() + 1)}/${weekEnd.getUTCFullYear()}`;
  let weekCount = 0;
  for (const agg of byDay.values())
    weekCount += agg.classes.length + agg.trials.length + agg.bus.length;

  return (
    <div>
      <CalNav
        label={rangeLabel}
        count={`${weekCount} buổi trong tuần`}
        prevHref={`?view=tuan&moc=${isoKey(addDaysUtc(weekStart, -7))}${filterQS}`}
        nextHref={`?view=tuan&moc=${isoKey(addDaysUtc(weekStart, 7))}${filterQS}`}
        todayHref={`?view=tuan${filterQS}`}
        todayLabel="Tuần này"
      />
      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[700px] grid-cols-7 gap-2">
          {days.map((d, i) => {
            const items = mergeDayItems(byDay.get(d.key));
            const holiday = holidayByDay.get(d.key);
            const shift = shiftsByDay.get(d.key);
            const isToday = d.key === todayKey;
            return (
              <div
                key={d.key}
                className={cn(
                  "flex flex-col rounded-lg p-1",
                  shift && !holiday && "bg-primary-soft dark:bg-primary-soft", // nền nhẹ: ngày có ca làm
                )}
              >
                {/* Click đầu cột → danh sách đúng ngày đó. CỐ Ý KHÔNG `scroll={false}`:
                    bấm XEM CHI TIẾT một ngày, cả thân trang đổi sang danh sách — cuộn lên đầu mới đúng. */}
                <Link
                  href={`?view=ds&moc=${d.key}`}
                  className={cn(
                    "mb-1.5 rounded-lg px-2 py-1.5 text-center transition-opacity hover:opacity-80",
                    isToday
                      ? "bg-primary text-white"
                      : holiday
                        ? "bg-state-warning-soft text-state-warning-ink dark:bg-state-warning-soft dark:text-state-warning-ink"
                        : "bg-muted/50 text-muted-foreground",
                  )}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide opacity-90">
                    {WEEKDAYS[i]}
                  </p>
                  <p className="text-base font-extrabold leading-tight">
                    {d.dayNum}
                  </p>
                </Link>
                <div className="flex flex-1 flex-col gap-1.5">
                  {shift && (
                    <div className="flex flex-wrap gap-1">
                      {shift.labels.map((l) => (
                        <span
                          key={l}
                          className="rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold text-primary-ink"
                        >
                          {l}
                        </span>
                      ))}
                      {shift.leave && (
                        <span className="rounded bg-state-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-state-danger-ink">
                          Xin nghỉ
                        </span>
                      )}
                    </div>
                  )}
                  {holiday && (
                    <div className="flex items-start gap-1.5 rounded-lg border border-state-warning-soft bg-state-warning-soft px-2 py-1.5 text-state-warning-ink dark:border-state-warning">
                      <CalendarOff
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-state-warning-ink"
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold leading-tight">
                          {holiday.name}
                        </p>
                        <p className="text-[10px] opacity-80">
                          {holiday.typeLabel}
                        </p>
                      </div>
                    </div>
                  )}
                  {items.length === 0 && !holiday ? (
                    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border py-6 text-[11px] text-muted-foreground">
                      –
                    </div>
                  ) : (
                    items.map((it) =>
                      it.kind === "class" ? (
                        <div
                          key={it.s.id}
                          className={cn(
                            "rounded-lg border border-border border-l-4 border-l-state-info bg-state-info-soft p-2",
                            it.s.status === "CANCELLED" && "opacity-60",
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <p className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                              <Clock className="h-3 w-3" aria-hidden />
                              {classTime(it.s)}
                            </p>
                            {!assigned.has(it.s.classId) && (
                              <span className="rounded bg-state-info-soft px-1 text-[10px] font-bold text-state-info-ink">
                                Thay
                              </span>
                            )}
                          </div>
                          <p
                            className={cn(
                              "mt-0.5 text-[13px] font-bold leading-tight text-foreground",
                              it.s.status === "CANCELLED" && "line-through",
                            )}
                          >
                            {it.s.class.name}
                          </p>
                          {it.s.topic && (
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                              {it.s.topic}
                            </p>
                          )}
                          {it.s.status === "CANCELLED" && (
                            <p className="mt-0.5 text-[10px] font-semibold text-state-danger-ink">
                              Đã hủy
                            </p>
                          )}
                        </div>
                      ) : it.kind === "trial" ? (
                        <div
                          key={it.t.id}
                          className="rounded-lg border border-border border-l-4 border-l-primary bg-primary-soft p-2"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <p className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                              <Clock className="h-3 w-3" aria-hidden />
                              {it.t.startTime}–{it.t.endTime}
                            </p>
                            <span className="rounded bg-primary-soft px-1 text-[10px] font-bold text-primary-ink">
                              Thử
                            </span>
                          </div>
                          <p className="mt-0.5 text-[13px] font-bold leading-tight text-foreground">
                            {it.t.trialClassName}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            Lớp trải nghiệm
                          </p>
                        </div>
                      ) : (
                        <Link
                          key={it.b.id}
                          href={`/teacher/hoc-bu/${it.b.id}`}
                          className="block rounded-lg border border-border border-l-4 border-l-state-warning bg-state-warning-soft p-2 transition-colors hover:brightness-95"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <p className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                              <Clock className="h-3 w-3" aria-hidden />
                              {it.b.startTime}–{it.b.endTime}
                            </p>
                            <span className="rounded px-1 text-[10px] font-bold text-state-warning-ink">Bù</span>
                          </div>
                          <p className="mt-0.5 text-[13px] font-bold leading-tight text-foreground">{it.b.khoa}</p>
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                            {it.b.buoi} · {it.b.soBe} bé
                          </p>
                        </Link>
                      ),
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── UI phụ trợ (server) ─────────────────────────────── */

/** Nút chuyển view — Link chỉ-query (giữ path, chạy đúng trên host giaovien lẫn localhost).
 *  `scroll={false}`: đổi view là ĐỔI THAM SỐ của CHÍNH trang này, không phải sang trang
 *  khác — để mặc định thì App Router cuộn vọt lên đầu, mất chỗ đang xem. */
function ToggleLink({
  active,
  href,
  label,
  icon: Icon,
}: {
  active: boolean;
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
        active
          ? "bg-card text-primary-ink shadow-sm dark:text-primary-ink"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}

/** Thanh điều hướng prev/next tháng-tuần — toàn Link chỉ-query.
 *  `scroll={false}` ở cả 3 nút: lùi/tiến tháng-tuần chỉ đổi ?moc= của CHÍNH trang này. */
function CalNav({
  label,
  count,
  prevHref,
  nextHref,
  todayHref,
  todayLabel,
}: {
  label: string;
  count: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  todayLabel: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Link
          href={prevHref}
          scroll={false}
          aria-label="Trước"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted/50"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href={nextHref}
          scroll={false}
          aria-label="Sau"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted/50"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          href={todayHref}
          scroll={false}
          className="ml-1 inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted/50"
        >
          {todayLabel}
        </Link>
        <p className="ml-2 text-sm font-semibold text-foreground">{label}</p>
      </div>
      <p className="hidden text-sm text-muted-foreground sm:block">{count}</p>
    </div>
  );
}

/** Chú thích màu cho view Tháng/Tuần. */
function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-state-info" /> Buổi lớp
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Trial
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-3 rounded border border-primary-soft bg-primary-soft dark:border-primary" />{" "}
        Ngày có ca làm
      </span>
      {/* Ô mẫu phải khớp thứ người dùng THẤY trên lịch: ngày nghỉ vừa được tô nền
          vừa có biểu tượng. Chú giải cũ chỉ có biểu tượng nên nền vàng không được
          giải nghĩa ở đâu cả. */}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded border border-state-warning-soft bg-state-warning-soft">
          <CalendarOff
            className="h-2.5 w-2.5 text-state-warning-ink"
            aria-hidden
          />
        </span>{" "}
        Ngày nghỉ
      </span>
    </div>
  );
}
