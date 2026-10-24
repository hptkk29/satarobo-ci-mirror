import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, parseISO } from "date-fns";
import { vi } from "date-fns/locale";
import { ChevronLeft, ChevronRight, ArrowLeft, CalendarDays } from "lucide-react";
import { auth } from "@/lib/auth";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import {
  WeekCalendar,
  type ScheduleSession,
} from "@/components/admin/week-calendar";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}

// Phòng ban thuộc nhóm có lịch dạy. Department-based check (no separate role
// field on Employee — see Phase C1 audit).
const TEACHING_DEPARTMENTS = new Set<string>(["GIANG_DAY", "DAO_TAO"]);

export const dynamic = "force-dynamic";

function safeParseWeek(week: string | undefined): Date {
  if (!week) return new Date();
  try {
    const d = parseISO(week);
    if (Number.isNaN(d.getTime())) return new Date();
    return d;
  } catch {
    return new Date();
  }
}

export default async function EmployeeSchedulePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { week } = await searchParams;

  // Cách ly cơ sở: Employee ∈ SCOPED_MODELS (findUnique → null nếu ngoài tầm nhìn,
  // chống IDOR). ClassSession KHÔNG scoped → scope thủ công qua class.centerId theo
  // tầm nhìn cơ sở của model Class. SUPER_ADMIN/HO tự bypass (ALL).
  const session = await auth();
  if (!session?.user) redirect("/login");
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const refDate = safeParseWeek(week);
  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(refDate, { weekStartsOn: 1 });    // Sunday 23:59:59

  const prevWeek = subWeeks(weekStart, 1);
  const nextWeek = addWeeks(weekStart, 1);

  const employee = await sdb.employee.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      jobTitle: true,
      department: true,
      avatarUrl: true,
      userAccount: { select: { id: true } },
    },
  });

  if (!employee) notFound();

  const canSeeSchedule = TEACHING_DEPARTMENTS.has(employee.department);

  if (!canSeeSchedule) {
    return (
      <div className="p-6 max-w-3xl">
        <Link
          href={`/nhan-su/${id}/edit`}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Quay lại
        </Link>
        <h1 className="text-2xl font-bold mb-2">Lịch dạy</h1>
        <div className="rounded-xl border-2 border-dashed border-border bg-muted p-8 text-center">
          <p className="font-semibold text-foreground">
            Nhân viên này không thuộc Phòng Giảng dạy / Đào tạo
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Trang lịch dạy chỉ hiển thị cho nhân viên thuộc phòng{" "}
            <code className="rounded bg-muted px-1.5">GIANG_DAY</code> hoặc{" "}
            <code className="rounded bg-muted px-1.5">DAO_TAO</code>.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Phòng hiện tại: {employee.department.replace(/_/g, " ")}.
          </p>
        </div>
      </div>
    );
  }

  // Class.teacher → User. Employee → User via userAccount relation.
  // Bail out gracefully if the employee has no User account yet.
  const userId = employee.userAccount?.id ?? null;

  // ClassSession không có centerId trực tiếp → scope thủ công qua class.centerId.
  const visibleClassCenters = getModelVisibleCenterIds("Class", actor);
  const classWhere =
    visibleClassCenters === "ALL"
      ? { teacherId: userId, deletedAt: null }
      : { teacherId: userId, deletedAt: null, centerId: { in: visibleClassCenters } };

  const rawSessions = userId
    ? await sdb.classSession.findMany({
        where: {
          date: { gte: weekStart, lte: weekEnd },
          class: classWhere,
        },
        include: {
          class: {
            select: {
              name: true,
              course: { select: { name: true } },
              center: { select: { name: true } },
            },
          },
          _count: { select: { attendances: true } },
        },
        orderBy: { date: "asc" },
      })
    : [];

  const sessions: ScheduleSession[] = rawSessions.map((s) => ({
    id: s.id,
    date: s.date,
    className: s.class?.name ?? "—",
    courseName: s.class?.course?.name ?? null,
    centerName: s.class?.center?.name ?? null,
    topic: s.topic,
    attendanceCount: s._count.attendances,
    href: `/sessions/${s.id}/edit`,
  }));

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/nhan-su/${id}/edit`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Quay lại
          </Link>
          <div className="flex items-center gap-3">
            {employee.avatarUrl ? (
              <img
                src={employee.avatarUrl}
                alt={employee.fullName}
                className="h-12 w-12 rounded-full object-cover ring-1 ring-border"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-primary text-white font-bold text-lg flex items-center justify-center">
                {employee.fullName.charAt(0)}
              </div>
            )}
            <div>
              <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                Lịch dạy — {employee.fullName}
              </h1>
              <p className="text-sm text-muted-foreground">{employee.jobTitle}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted rounded-xl px-4 py-3">
        <Link
          href={`/nhan-su/${id}/schedule?week=${format(prevWeek, "yyyy-MM-dd")}`}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" />
          Tuần trước
        </Link>

        <div className="text-center">
          <div className="font-semibold text-foreground">
            Tuần {format(weekStart, "dd/MM", { locale: vi })} →{" "}
            {format(weekEnd, "dd/MM/yyyy", { locale: vi })}
          </div>
          <Link
            href={`/nhan-su/${id}/schedule`}
            className="text-xs text-primary hover:underline"
          >
            Về tuần hiện tại
          </Link>
        </div>

        <Link
          href={`/nhan-su/${id}/schedule?week=${format(nextWeek, "yyyy-MM-dd")}`}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold hover:bg-muted"
        >
          Tuần sau
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      {!userId && (
        <div className="rounded-lg border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          ⚠️ Nhân viên chưa có User account liên kết → không thể truy vấn lịch.
          Trang Class hiện gắn giáo viên qua bảng User (relation TeacherClasses).
          Cần tạo User cho Employee này trước.
        </div>
      )}

      {/* Calendar */}
      {sessions.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground italic">
          Không có buổi học nào trong tuần này
        </div>
      ) : (
        <WeekCalendar sessions={sessions} weekStart={weekStart} weekEnd={weekEnd} />
      )}

      {/* Summary */}
      <div className="border-t pt-3 text-sm text-muted-foreground">
        Tổng cộng <strong>{sessions.length}</strong> buổi trong tuần
        {sessions.length > 0 && (
          <>
            {" · "}
            <strong>
              {sessions.reduce((sum, s) => sum + (s.attendanceCount ?? 0), 0)}
            </strong>{" "}
            lượt điểm danh
          </>
        )}
      </div>
    </div>
  );
}
