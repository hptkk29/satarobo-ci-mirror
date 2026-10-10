import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { TeacherProfileForm } from "./_components/profile-form";
import { ClassAssignmentSection } from "./_components/class-assignment";
import { WeeklySchedule } from "./_components/weekly-schedule";
import type { TeacherClassSlot } from "@/lib/teachers/schedule";
import { computeTeachingLoad } from "@/lib/teachers/load";
import { getSetting } from "@/lib/settings/service";
import { TeacherEvaluations } from "./_components/evaluations";

export const metadata = { title: "Hồ sơ giáo viên | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}

export default async function TeacherProfilePage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;
  const { month: monthParam } = await searchParams;

  // Cách ly cơ sở: lớp của GV (Class ∈ SCOPED_MODELS) đọc qua scopedDb → CM@CS1 không
  // thấy lớp CS khác. ClassSession/Enrollment phía dưới lọc theo mainClassIds (đã isolate)
  // nên an toàn theo. SUPER_ADMIN/HO tự bypass (ALL). User exempt (pass-through).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const teacher = await sdb.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      roles: true,
      centerId: true,
      center: { select: { name: true } },
      employee: { select: { employeeCode: true, jobTitle: true, phone: true } },
      teacherProfile: {
        select: {
          rank: true,
          employmentType: true,
          status: true,
          bio: true,
          teachableCourses: { select: { courseId: true } },
        },
      },
    },
  });
  // Đa vai trò (3B): gồm cả người có TEACHER ở vị trí phụ (vd CENTER_MANAGER+TEACHER).
  if (!teacher || !hasRole(teacher, "TEACHER")) notFound();

  const overloadHours = await getSetting("teacher.overloadHoursPerWeek");
  const me = session.user;
  const isOwn = me.id === id;
  const cmInScope = hasRole(me, "CENTER_MANAGER") && teacher.centerId === me.centerId;
  // Xem: SUPER_ADMIN/HR (employees:view-all & không phải CM), CM cùng cơ sở, hoặc GV xem chính mình.
  const canViewByRole =
    (await checkPermission("employees:view-all", { centerId: teacher.centerId })) &&
    (!hasRole(me, "CENTER_MANAGER") || cmInScope);
  const canView = isOwn || canViewByRole;
  if (!canView) redirect("/dashboard");
  // Sửa: SUPER_ADMIN, hoặc CM cùng cơ sở.
  const canEdit = hasRole(me, "SUPER_ADMIN") || cmInScope;

  const p = teacher.teacherProfile;
  const teacherCourseIds = p?.teachableCourses.map((t) => t.courseId) ?? [];

  const classSelect = {
    id: true,
    name: true,
    classCode: true,
    courseId: true,
    course: { select: { name: true } },
    scheduleDays: true,
    startTime: true,
    endTime: true,
  } as const;

  const [courses, mainClasses, assistantClasses, assignableRaw] = await Promise.all([
    sdb.course.findMany({
      where: { isActive: true, isTeachable: true },
      orderBy: { displayOrder: "asc" },
      select: { id: true, name: true, code: true },
    }),
    sdb.class.findMany({
      where: { teacherId: id, deletedAt: null },
      orderBy: { name: "asc" },
      select: classSelect,
    }),
    sdb.class.findMany({
      where: { assistantId: id, deletedAt: null },
      orderBy: { name: "asc" },
      select: classSelect,
    }),
    sdb.class.findMany({
      where: {
        deletedAt: null,
        status: { in: ["PLANNED", "RECRUITING", "ACTIVE"] },
        teacherId: { not: id },
        ...(teacher.centerId ? { centerId: teacher.centerId } : {}),
      },
      orderBy: { name: "asc" },
      take: 200,
      select: classSelect,
    }),
  ]);

  const fmtClass = (c: { id: string; name: string; classCode: string | null; course: { name: string } }) => ({
    id: c.id,
    label: c.classCode ? `${c.classCode} · ${c.name}` : c.name,
    courseName: c.course.name,
  });

  // Lịch tuần = GV chính + trợ giảng (đều chiếm chỗ → tính trùng giờ).
  const scheduleSlots: TeacherClassSlot[] = [
    ...mainClasses.map((c) => ({
      id: c.id,
      label: c.classCode ? `${c.classCode} · ${c.name}` : c.name,
      scheduleDays: c.scheduleDays,
      startTime: c.startTime,
      endTime: c.endTime,
      role: "teacher" as const,
    })),
    ...assistantClasses.map((c) => ({
      id: c.id,
      label: c.classCode ? `${c.classCode} · ${c.name}` : c.name,
      scheduleDays: c.scheduleDays,
      startTime: c.startTime,
      endTime: c.endTime,
      role: "assistant" as const,
    })),
  ];

  // PHẦN 5 — số buổi đã dạy trong tháng (ClassSession của lớp GV chính, đã diễn ra).
  const now = new Date();
  const monthMatch = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : null;
  const year = monthMatch ? Number(monthMatch.slice(0, 4)) : now.getFullYear();
  const monthIdx = monthMatch ? Number(monthMatch.slice(5, 7)) - 1 : now.getMonth();
  const monthStart = new Date(year, monthIdx, 1);
  const monthEnd = new Date(year, monthIdx + 1, 1);
  const monthValue = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
  const mainClassIds = mainClasses.map((c) => c.id);
  const taughtSessions =
    mainClassIds.length > 0
      ? await sdb.classSession.findMany({
          where: {
            classId: { in: mainClassIds },
            date: { gte: monthStart, lt: monthEnd, lte: now },
          },
          orderBy: { date: "desc" },
          select: {
            id: true,
            date: true,
            topic: true,
            class: { select: { name: true, classCode: true } },
          },
          take: 200,
        })
      : [];

  // PHẦN 6 — đánh giá: ParentFeedback (qua HS enroll lớp GV) + TeacherReview nội bộ.
  const enrolledStudentIds =
    mainClassIds.length > 0
      ? (
          await sdb.enrollment.findMany({
            where: { classId: { in: mainClassIds } },
            select: { studentId: true },
            distinct: ["studentId"],
          })
        ).map((e) => e.studentId)
      : [];
  const [parentFeedback, internalReviews] = await Promise.all([
    enrolledStudentIds.length > 0
      ? sdb.parentFeedback.findMany({
          where: { studentId: { in: enrolledStudentIds } },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { rating: true, content: true, studentName: true, createdAt: true },
        })
      : Promise.resolve([] as { rating: number; content: string; studentName: string | null; createdAt: Date }[]),
    sdb.teacherReview.findMany({
      where: { teacherProfile: { userId: id } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { score: true, note: true, reviewerName: true, createdAt: true },
    }),
  ]);
  const parentAvg =
    parentFeedback.length > 0
      ? parentFeedback.reduce((s, f) => s + f.rating, 0) / parentFeedback.length
      : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/teachers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Danh sách giáo viên
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-foreground">{teacher.name ?? teacher.email}</h1>
          {!canEdit && (
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              Chỉ xem
            </span>
          )}
        </div>
      </div>

      {/* Thông tin cơ bản */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Thông tin cơ bản
        </h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Info label="Email" value={teacher.email ?? "—"} />
          <Info label="Mã NV" value={teacher.employee?.employeeCode ?? "—"} />
          <Info label="Chức danh" value={teacher.employee?.jobTitle ?? "—"} />
          <Info label="SĐT" value={teacher.employee?.phone ?? "—"} />
          <Info label="Cơ sở" value={teacher.center?.name ?? "—"} />
        </dl>
      </section>

      <TeacherProfileForm
        userId={teacher.id}
        canEdit={canEdit}
        courses={courses.map((c) => ({
          id: c.id,
          label: c.code ? `${c.code} · ${c.name}` : c.name,
        }))}
        initial={{
          rank: p?.rank ?? "TRAINEE",
          employmentType: p?.employmentType ?? "PARTTIME",
          status: p?.status ?? "ACTIVE",
          bio: p?.bio ?? "",
          courseIds: teacherCourseIds,
        }}
      />

      <ClassAssignmentSection
        teacherUserId={teacher.id}
        teacherCourseIds={teacherCourseIds}
        canEdit={canEdit}
        mainClasses={mainClasses.map(fmtClass)}
        assistantClasses={assistantClasses.map(fmtClass)}
        assignable={assignableRaw.map((c) => ({
          id: c.id,
          label: c.classCode ? `${c.classCode} · ${c.name}` : c.name,
          courseId: c.courseId,
          courseName: c.course.name,
        }))}
      />

      <WeeklySchedule slots={scheduleSlots} />

      {/* PHẦN 4 — Tải giảng dạy (tính từ lớp GV chính phụ trách) */}
      {(() => {
        const load = computeTeachingLoad(
          mainClasses.map((c) => ({
            scheduleDays: c.scheduleDays,
            startTime: c.startTime,
            endTime: c.endTime,
          })),
          overloadHours,
        );
        return (
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Tải giảng dạy / tuần
              </h2>
              {load.overloaded && (
                <span className="rounded-full bg-state-danger-soft px-2.5 py-0.5 text-xs font-semibold text-state-danger-ink">
                  Quá tải (&gt; {overloadHours}h/tuần)
                </span>
              )}
            </div>
            <dl className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Lớp đang dạy" value={String(load.classCount)} />
              <Stat label="Buổi / tuần" value={String(load.sessionsPerWeek)} />
              <Stat label="Giờ / tuần" value={`${load.hoursPerWeek}h`} />
            </dl>
          </section>
        );
      })()}

      {/* PHẦN 5 — Số buổi đã dạy trong tháng */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Số buổi đã dạy trong tháng
          </h2>
          <form method="GET" className="flex items-center gap-2">
            <input
              type="month"
              name="month"
              defaultValue={monthValue}
              className="rounded-lg border border-border px-2 py-1 text-sm focus:border-primary focus:outline-none"
            />
            <button type="submit" className="rounded-lg bg-gray-800 px-3 py-1 text-sm font-medium text-white">
              Xem
            </button>
          </form>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Đã dạy <strong className="text-foreground">{taughtSessions.length}</strong> buổi trong{" "}
          {monthValue} (chỉ tính buổi đã diễn ra).
        </p>
        {taughtSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có buổi nào.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {taughtSessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="tabular-nums text-foreground">
                  {new Date(s.date).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" })}
                </span>
                <span className="font-medium text-foreground">
                  {s.class.classCode ? `${s.class.classCode} · ` : ""}{s.class.name}
                </span>
                <span className="flex-1 truncate text-right text-xs text-muted-foreground">{s.topic ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TeacherEvaluations
        userId={teacher.id}
        canEdit={canEdit}
        parentAvg={parentAvg}
        parentCount={parentFeedback.length}
        parentRecent={parentFeedback.slice(0, 5).map((f) => ({
          rating: f.rating,
          content: f.content,
          studentName: f.studentName,
          createdAt: f.createdAt.toISOString(),
        }))}
        reviews={internalReviews.map((r) => ({
          score: r.score,
          note: r.note,
          reviewerName: r.reviewerName,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-foreground">{value}</dd>
    </div>
  );
}
