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
import { RankLuong } from "./_components/rank-luong";
import { EMPLOYMENT_LABEL, TEACHER_STATUS_LABEL } from "@/lib/teachers/labels";
import { BTN_OUTLINE, FIELD } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";
import type { TeacherStatus } from "@prisma/client";
import { moDuocHoSoGv } from "@/lib/teachers/quyen-ho-so";
import { docDanhSachCoSo, docRankCuaGv } from "@/lib/parttime/rank-don-gia-db";

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
  // Xem: SUPER_ADMIN/HR (employees:view-all & không phải CM), CM cùng cơ sở, hoặc GV xem chính mình — MỘT hàm, màn Rank giáo viên
  // hỏi đúng hàm này để chỉ vẽ link hồ sơ cho người mở được.
  if (!(await moDuocHoSoGv(me, { id: teacher.id, centerId: teacher.centerId }))) redirect("/dashboard");
  // Sửa: SUPER_ADMIN, hoặc CM cùng cơ sở.
  const canEdit = hasRole(me, "SUPER_ADMIN") || cmInScope;

  // Rank lương (SR.QD.238) — quyền hỏi theo CÁC CƠ SỞ CỦA GV (scope CENTER), cùng cách với màn Rank giáo viên và với action.
  const rankGv = await docRankCuaGv({ userId: teacher.id, now: new Date() });
  const coSoGv = [...new Set([...rankGv.coSoIds, ...(teacher.centerId ? [teacher.centerId] : [])])];
  // Đổi Rank (chốt 25/10/2026): CHỈ Giám đốc · QTTC · Đào tạo — `parttime_rank:approve` GLOBAL, áp ngay; không còn đề xuất của QLCS.
  const [xemRank, doiRank, capChungNhan, chinhSachTrial, coSoTatCa] = await Promise.all([
    Promise.all(coSoGv.map((c) => checkPermission("parttime_rank:view", { centerId: c }))),
    checkPermission("parttime_rank:approve"),
    checkPermission("trial_cert:manage"),
    checkPermission("parttime_policy:manage"),
    docDanhSachCoSo(),
  ]);
  const xemChiTietRank = xemRank.some(Boolean);
  // Chính GV (không có quyền xem Rank) vẫn thấy Rank + chứng nhận của mình — không thấy căn cứ / lịch sử.
  const hienRank = xemChiTietRank || isOwn;

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

  const load = computeTeachingLoad(
    mainClasses.map((c) => ({ scheduleDays: c.scheduleDays, startTime: c.startTime, endTime: c.endTime })),
    overloadHours,
  );
  const tenHienThi = teacher.name ?? teacher.email ?? "Giáo viên";
  const tt = p?.status ?? "ACTIVE";

  return (
    // Khung CĂN GIỮA có trần (25/10/2026): bản cũ `max-w-4xl` không căn giữa ⇒ ở màn rộng cả hồ sơ dồn sát trái, nửa phải bỏ trống.
    // 320px → xl: một cột · xl: cột chính + cột phụ (Rank, hồ sơ chuyên môn) · ≥2200px: cột chính tự tách đôi · trần 2400px (≥3200px: 3000px)
    // để 4K/8K không kéo dòng chữ dài vô tận.
    <div className="mx-auto w-full max-w-[2400px] space-y-5 min-[3200px]:max-w-[3000px]">
      <Link href="/teachers" className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Danh sách giáo viên
      </Link>

      {/* Dải nhận diện: ai · ở đâu · đang dạy bao nhiêu — thay hai thẻ "Thông tin cơ bản" và "Tải giảng dạy" cũ. */}
      <header className="@container rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-5 p-5 @3xl:flex-row @3xl:items-start @3xl:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-soft text-lg font-bold text-primary-ink"
            >
              {chuCai(tenHienThi)}
            </div>
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-bold leading-tight text-foreground">{tenHienThi}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={cn(CHIP, TRANG_THAI_CHIP[tt])}>{TEACHER_STATUS_LABEL[tt]}</span>
                <span className={cn(CHIP, "bg-muted text-foreground")}>{EMPLOYMENT_LABEL[p?.employmentType ?? "PARTTIME"]}</span>
                {teacher.center?.name && <span className={cn(CHIP, "bg-muted text-foreground")}>{teacher.center.name}</span>}
                {hienRank && <span className={cn(CHIP, "bg-primary-soft text-primary-ink")}>Rank {rankGv.rank}</span>}
                {!canEdit && <span className={cn(CHIP, "border border-border text-muted-foreground")}>Chỉ xem</span>}
              </div>
            </div>
          </div>
          <div className="shrink-0 space-y-2 @3xl:min-w-[22rem]">
          <dl className="grid grid-cols-3 gap-2 text-center">
            <SoLieu nhan="Lớp chính" giaTri={String(load.classCount)} />
            <SoLieu nhan="Buổi / tuần" giaTri={String(load.sessionsPerWeek)} />
            <SoLieu nhan="Giờ / tuần" giaTri={`${load.hoursPerWeek}h`} canhBao={load.overloaded ? `quá tải, trên ${overloadHours}h/tuần` : null} />
          </dl>
          {load.overloaded && <p className="text-xs font-semibold text-state-danger-ink">Quá tải — trên {overloadHours} giờ dạy mỗi tuần</p>}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border px-5 py-4 text-sm @3xl:grid-cols-4">
          <Info label="Email" value={teacher.email ?? "—"} />
          <Info label="Số điện thoại" value={teacher.employee?.phone ?? "—"} />
          <Info label="Mã nhân viên" value={teacher.employee?.employeeCode ?? "—"} />
          <Info label="Chức danh" value={teacher.employee?.jobTitle ?? "—"} />
        </dl>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_27rem]">
        {/* Cột phụ đứng TRƯỚC trong DOM: trên điện thoại Rank + hồ sơ chuyên môn là thứ người mở hồ sơ tìm đầu tiên. Từ xl nó sang phải. */}
        <aside aria-label="Rank và hồ sơ chuyên môn" className="min-w-0 space-y-5 xl:col-start-2 xl:row-start-1">
          {hienRank && (
            <RankLuong
              ten={tenHienThi}
              du={rankGv}
              quyen={{
                xemChiTiet: xemChiTietRank,
                doi: doiRank,
                chungNhan: capChungNhan,
                chinhSach: chinhSachTrial,
                coSo: coSoTatCa.filter((c) => coSoGv.includes(c.id)),
              }}
            />
          )}
          <TeacherProfileForm
            userId={teacher.id}
            canEdit={canEdit}
            courses={courses.map((c) => ({
              id: c.id,
              label: c.code ? `${c.code} · ${c.name}` : c.name,
            }))}
            initial={{
              employmentType: p?.employmentType ?? "PARTTIME",
              status: p?.status ?? "ACTIVE",
              bio: p?.bio ?? "",
              courseIds: teacherCourseIds,
            }}
          />
        </aside>

        <div className="grid min-w-0 items-start gap-5 xl:col-start-1 xl:row-start-1 min-[2200px]:grid-cols-2">
          <div className="min-w-0 space-y-5">
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
          </div>

          <div className="min-w-0 space-y-5">
            <section aria-labelledby="buoi-da-day" className="@container rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="buoi-da-day" className="text-base font-semibold text-foreground">
                    Buổi đã dạy trong tháng
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    <b className="tabular-nums text-foreground">{taughtSessions.length}</b> buổi trong {monthValue.slice(5)}/{monthValue.slice(0, 4)} · chỉ tính
                    buổi đã diễn ra, lớp đứng chính.
                  </p>
                </div>
                <form method="GET" className="flex items-center gap-2">
                  <label className="sr-only" htmlFor="thang-da-day">
                    Tháng
                  </label>
                  <input id="thang-da-day" type="month" name="month" defaultValue={monthValue} className={cn(FIELD, "w-40")} />
                  <button type="submit" className={BTN_OUTLINE}>
                    Xem
                  </button>
                </form>
              </div>
              {taughtSessions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                  Tháng này chưa có buổi nào đã diễn ra ở lớp giáo viên đứng chính.
                </p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {taughtSessions.map((s) => (
                    <li key={s.id} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-2.5 @lg:grid-cols-[4rem_minmax(0,14rem)_minmax(0,1fr)]">
                      <span className="whitespace-nowrap tabular-nums text-muted-foreground">{ngayGon(s.date)}</span>
                      <span className="truncate font-medium text-foreground">
                        {s.class.classCode ? `${s.class.classCode} · ` : ""}
                        {s.class.name}
                      </span>
                      <span className="col-start-2 truncate text-xs text-muted-foreground @lg:col-start-3 @lg:text-sm">{s.topic ?? "—"}</span>
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
        </div>
      </div>
    </div>
  );
}

const CHIP = "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold";
/** Trạng thái giáo viên → token ngữ nghĩa (DESIGN.md §1 — không mượn màu thương hiệu, không hex rời). */
const TRANG_THAI_CHIP: Record<TeacherStatus, string> = {
  ACTIVE: "bg-state-success-soft text-state-success-ink",
  ON_LEAVE: "bg-state-warning-soft text-state-warning-ink",
  INACTIVE: "bg-muted text-muted-foreground",
};

/** Chữ cái đầu của TÊN GỌI (từ cuối của họ tên Việt) — đủ nhận diện, không đoán thứ tự họ/tên. */
function chuCai(ten: string): string {
  const tu = ten.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return (tu[tu.length - 1]?.[0] ?? "?").toUpperCase();
}

const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;
/** "T7 24/10" theo giờ VN — `toLocaleDateString` ra "Thứ 7, 24/10" và xuống dòng ở cột ngày hẹp. */
function ngayGon(d: Date): string {
  const vn = new Date(d.getTime() + 7 * 3600_000);
  return `${THU[vn.getUTCDay()]} ${String(vn.getUTCDate()).padStart(2, "0")}/${String(vn.getUTCMonth() + 1).padStart(2, "0")}`;
}

function SoLieu({ nhan, giaTri, canhBao = null }: { nhan: string; giaTri: string; canhBao?: string | null }) {
  // `dt` trước `dd` trong DOM (đúng ngữ nghĩa `<dl>`), số hiện TRÊN nhãn bằng `flex-col-reverse`.
  return (
    <div className={cn("flex flex-col-reverse rounded-lg px-2 py-2.5", canhBao ? "bg-state-danger-soft text-state-danger-ink" : "bg-muted")}>
      <dt className={cn("mt-0.5 text-xs", canhBao ? "font-semibold" : "text-muted-foreground")}>
        {nhan}
        {canhBao && <span className="sr-only"> — {canhBao}</span>}
      </dt>
      <dd className={cn("text-xl font-bold tabular-nums", canhBao ? "" : "text-foreground")} title={canhBao ?? undefined}>
        {giaTri}
      </dd>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-foreground">{value}</dd>
    </div>
  );
}
