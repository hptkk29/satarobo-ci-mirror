// app/(teacher)/teacher/hoc-vien/page.tsx — Hồ sơ học viên site GV.
//
// Port cấu trúc reference :3001 (satarobo-ui-giaovien students/[id]/student-profile):
// hồ sơ = 4 TAB (Điểm danh / Nhận xét / Bài tập & Kiểm tra / Học bạ), điều hướng qua
// searchParams (?s=<id>&ptab=…) — server-first, mỗi tab fetch riêng.
//   (a) không tham số → BẢNG HV các lớp mình (nhóm theo lớp + tìm tên/mã + lọc lớp).
//   (b) ?s=<id>       → hồ sơ 4 tab.
//
// Guard IDOR: HV phải có ghi danh (mọi status, chưa xoá) trong lớp ∈ assignedClassIds.
// Enrollment/ReportCard SCOPED (scopedDb tự cách ly cơ sở); StudentSessionFeedback/
// AssignmentSubmission ∉ SCOPED → guard qua classSession.classId/assignment.classId.
// Raw db CHỈ qua lib helper (attendanceSummary / getCourseCriteria).
//
// ⚠️ Câu 46: KHÔNG SĐT/email/tên phụ huynh — reference header có parentName/phone,
// KHÔNG port. Student CHỈ {id, name, studentCode, avatarUrl, dateOfBirth, currentGrade, school}.
import Link from "next/link";
import {
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  ClipboardPen,
  CircleCheck,
  FileDown,
  GraduationCap,
  Lock,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";
import type { AttendanceStatus } from "@prisma/client";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import { REPORT_CARD_STATUS_LABEL } from "@/lib/lms/report-card-core";
import { attendanceSummaryForEnrollments } from "@/lib/attendance/summary";
import { getCourseCriteria } from "@/lib/lms/report-card";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { ENROLLMENT_STATUS, SUBMISSION_STATUS } from "@/lib/labels/registry";
import {
  profileTabHref,
  resolveProfileScope,
} from "@/lib/teacher/profile-scope";
import {
  EVAL_OVERALL_LABEL,
  evalNotesProse,
  normalizeEvalNotes,
} from "@/lib/lms/session-eval-rubric";
import { feedbackHasContent } from "@/lib/lms/feedback-content";
import {
  buildSessionNumberMap,
} from "@/lib/lms/session-order";
import {
  deriveSessionLabel,
  resolveDisplayProjectName,
} from "@/lib/lms/session-project-name";
import {
  STUDENT_ATTENDANCE_CELL_LABEL,
  studentAttendanceCell,
} from "@/lib/lms/student-attendance-cell";
import { vnEndOfDay } from "@/lib/time/vn";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "../_components/ui/empty-state";
import { PageHeader } from "../_components/ui/page-header";
import { StudentList, type StudentRow } from "./_components/student-list";
import { BackLink } from "../_components/ui/back-link";
import { initialsOf } from "@/lib/ui/initials";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Hồ sơ học viên | Giáo viên Sata Robo" };

// 21/08 — CÓ `year` (đồng bộ với các bảng buổi khác của site GV).
const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});
const dueFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});
const LEVEL_LABEL: Record<number, string> = {
  1: "1 · Cần cố gắng",
  2: "2 · Đạt",
  3: "3 · Khá",
  4: "4 · Tốt",
};

// CHỮ lấy từ bảng dùng chung, chỉ MÀU giữ riêng ở đây.
//
// Bản chép tay cũ gọi `PUBLISHED` là "Đã duyệt" trong khi /teacher/hoc-ba gọi cùng
// trạng thái đó là "Đã phát hành" — hai màn, hai chữ, một trạng thái. QA vòng 1 đọc ra
// thành nghi vấn NV-003: tưởng badge "Đã duyệt" trên thẻ Học bạ nói về việc duyệt
// HOÀN THÀNH KHOÁ (một quy trình khác hẳn), rồi báo hai module không đồng bộ trạng
// thái. Thực ra chỉ là chép tay lệch chữ. `DRAFT` và `RECALLED` cũng lệch y vậy.
const REPORT_STATUS_CLS: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PENDING_REVIEW: "bg-state-warning-soft text-state-warning-ink",
  PUBLISHED: "bg-state-success-soft text-state-success-ink",
  RECALLED: "bg-state-danger-soft text-state-danger-ink",
};

const REPORT_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: REPORT_CARD_STATUS_LABEL.DRAFT, cls: REPORT_STATUS_CLS.DRAFT! },
  PENDING_REVIEW: {
    label: REPORT_CARD_STATUS_LABEL.PENDING_REVIEW,
    cls: REPORT_STATUS_CLS.PENDING_REVIEW!,
  },
  PUBLISHED: {
    label: REPORT_CARD_STATUS_LABEL.PUBLISHED,
    cls: REPORT_STATUS_CLS.PUBLISHED!,
  },
  RECALLED: {
    label: REPORT_CARD_STATUS_LABEL.RECALLED,
    cls: REPORT_STATUS_CLS.RECALLED!,
  },
};

const ATT_BADGE: Record<AttendanceStatus, { label: string; cls: string }> = {
  PRESENT: {
    label: "Có mặt",
    cls: "bg-state-success-soft text-state-success-ink",
  },
  LATE: {
    label: "Đi muộn",
    cls: "bg-state-warning-soft text-state-warning-ink",
  },
  ABSENT: {
    label: "Vắng",
    cls: "bg-state-danger-soft text-state-danger-ink",
  },
  EXCUSED: {
    label: "Có phép",
    cls: "bg-state-info-soft text-state-info-ink",
  },
  ABSENT_EXCUSED: {
    label: "Vắng có phép",
    cls: "bg-state-info-soft text-state-info-ink",
  },
  ABSENT_UNEXCUSED: {
    label: "Vắng",
    cls: "bg-state-danger-soft text-state-danger-ink",
  },
};

type ProfileTab = "diem-danh" | "nhan-xet" | "bai-tap" | "hoc-ba";
const PROFILE_TABS: { key: ProfileTab; label: string; icon: LucideIcon }[] = [
  { key: "diem-danh", label: "Điểm danh", icon: CalendarCheck },
  { key: "nhan-xet", label: "Nhận xét", icon: ClipboardPen },
  { key: "bai-tap", label: "Bài tập & Kiểm tra", icon: NotebookPen },
  { key: "hoc-ba", label: "Học bạ", icon: ClipboardList },
];
function parseProfileTab(raw: string | undefined): ProfileTab {
  return PROFILE_TABS.find((t) => t.key === raw)?.key ?? "diem-danh";
}

export default async function TeacherStudentProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; ptab?: string; classId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate — guard cho type-narrow

  const { s: studentId, ptab, classId: rawClassId } = await searchParams;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  // ── (b) Hồ sơ 1 học viên (4 tab) ──────────────────────────────────────────────
  if (studentId) {
    // Đọc QUA quan hệ class (đã guard classId ∈ assignedClassIds) — enrollment dev
    // centerId=null bị scopedDb lọc mất nếu query sdb.enrollment trực tiếp (pattern
    // hub-students-tab / cham-bai). Giữ nguyên shape `enrollments` cho phần dưới.
    const profClasses = classIds.length
      ? await sdb.class.findMany({
          where: { id: { in: classIds } },
          select: {
            id: true,
            name: true,
            course: { select: { name: true } },
            // HỒ SƠ dùng "lich-su": người dùng cần thấy cả lớp em đã hoàn thành và
            // đã nghỉ. Nhưng vẫn loại PENDING/CANCELLED/TRANSFERRED và HV đã xoá mềm —
            // trước đây chỉ lọc deletedAt của ghi danh nên ghi danh "Chờ xác nhận" vẫn
            // hiện thẻ lớp kèm "0/11 buổi" ở tab Học bạ trong khi tab Điểm danh không
            // có dòng nào (QA vòng 1, BUG-014).
            enrollments: {
              where: { studentId, ...rosterWhere("lich-su") },
              select: {
                id: true,
                courseId: true,
                status: true,
                // Câu 46: KHÔNG parent*/phone/email.
                student: {
                  select: {
                    id: true,
                    name: true,
                    studentCode: true,
                    avatarUrl: true,
                    dateOfBirth: true,
                    currentGrade: true,
                    school: true,
                  },
                },
              },
              orderBy: { createdAt: "desc" },
            },
          },
        })
      : [];
    const enrollments = profClasses.flatMap((c) =>
      c.enrollments.map((e) => ({
        id: e.id,
        classId: c.id,
        courseId: e.courseId,
        status: e.status,
        student: e.student,
        class: { name: c.name },
        course: { name: c.course.name },
      })),
    );
    if (enrollments.length === 0) return <NotYours />;

    const student = enrollments[0].student;
    const enrolledClassIds = [...new Set(enrollments.map((e) => e.classId))];
    // Trạng thái ghi danh theo TỪNG lớp — ô điểm danh cần nó để phân biệt "giáo viên
    // còn nợ chấm" với "em không còn học lớp này lúc đó" (BUG-001).
    const enrollmentStatusByClass = new Map(
      enrollments.map((e) => [e.classId, e.status]),
    );
    const multiClass = enrolledClassIds.length > 1;
    const activeTab = parseProfileTab(ptab);
    // BUG-003 — hồ sơ phải biết đang xem lớp nào. `rawClassId` đến từ URL nên đi qua
    // resolveProfileScope: lớp lạ bị HẠ CẤP về "xem tất cả", không bao giờ dùng thẳng.
    const scope = resolveProfileScope(
      enrollments.map((e) => ({
        classId: e.classId,
        className: e.class.name,
        courseName: e.course.name,
      })),
      rawClassId,
    );
    const tabClassIds = scope.classIds;
    const birthYear = student.dateOfBirth
      ? student.dateOfBirth.getUTCFullYear()
      : null;

    return (
      <div className="space-y-5">
        <BackLink href="?" label="Học viên lớp tôi" />

        {/* Định danh — avatar + tên + mã + năm sinh + lớp/khoá (KHÔNG contact PH) */}
        <div className="flex items-center gap-4">
          {student.avatarUrl ? (
            <img
              src={student.avatarUrl}
              alt={student.name}
              className="h-14 w-14 shrink-0 rounded-full border border-border object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-soft text-lg font-semibold text-primary-ink">
              {initialsOf(student.name)}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">
                {student.name}
              </h1>
              {/* MỌI trạng thái ghi danh, không phải mỗi cái đầu tiên.
                  Bản cũ in `enrollments[0].status` từ một truy vấn KHÔNG `orderBy`,
                  nên em có 5 ghi danh ở 5 trạng thái khác nhau chỉ hiện đúng một badge,
                  và badge nào thì tuỳ thứ tự Postgres trả về (QA vòng 1, BUG-018).
                  Khi đang lọc theo một lớp thì chỉ còn trạng thái của lớp đó — đúng
                  ngữ cảnh người dùng vừa bấm vào. */}
              {[...new Set(enrollments.map((e) => e.status))].map((st) => (
                <Badge key={st} variant="outline">
                  {ENROLLMENT_STATUS.label(st)}
                </Badge>
              ))}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>
                {student.studentCode ?? "—"}
                {birthYear ? ` · ${birthYear}` : ""}
              </span>
              {enrollments.map((e) => (
                <Link
                  key={e.id}
                  href={`/teacher/lop?classId=${e.classId}`}
                  className="font-medium text-primary-ink hover:text-primary-ink-hover"
                >
                  {e.class.name}
                </Link>
              ))}
              <span>
                {[...new Set(enrollments.map((e) => e.course.name))].join(
                  " · ",
                )}
              </span>
            </p>
          </div>
        </div>

        <ProfileTabBar
          studentId={studentId}
          active={activeTab}
          activeClassId={scope.activeClassId}
        />

        {/* Chip chọn lớp — chỉ hiện khi em học nhiều hơn một lớp của giáo viên này.
            Một lớp thì không có gì để chọn, thêm chip chỉ tốn một hàng ở 375px. */}
        {scope.chips.length > 1 && (
          <div className="flex flex-wrap gap-2 py-3">
            <Link
              href={profileTabHref({
                studentId,
                tab: activeTab,
                activeClassId: null,
              })}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                scope.activeClassId === null
                  ? "border-primary bg-primary-soft text-primary-ink"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              Tất cả lớp
            </Link>
            {scope.chips.map((c) => (
              <Link
                key={c.classId}
                href={profileTabHref({
                  studentId,
                  tab: activeTab,
                  activeClassId: c.classId,
                })}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  scope.activeClassId === c.classId
                    ? "border-primary bg-primary-soft text-primary-ink"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {c.courseName} · {c.className}
              </Link>
            ))}
          </div>
        )}

        {activeTab === "diem-danh" && (
          <AttendanceTab
            sdb={sdb}
            studentId={studentId}
            classIds={tabClassIds}
            multiClass={multiClass && scope.activeClassId === null}
            enrollmentStatusByClass={enrollmentStatusByClass}
          />
        )}
        {activeTab === "nhan-xet" && (
          <ReviewsTab
            sdb={sdb}
            studentId={studentId}
            classIds={tabClassIds}
            multiClass={multiClass && scope.activeClassId === null}
          />
        )}
        {activeTab === "bai-tap" && (
          <AssignmentsTab
            sdb={sdb}
            studentId={studentId}
            classIds={tabClassIds}
          />
        )}
        {activeTab === "hoc-ba" && (
          <HocBaTab
            sdb={sdb}
            enrollments={enrollments.map((e) => ({
              id: e.id,
              courseId: e.courseId,
              status: e.status,
              className: e.class.name,
              courseName: e.course.name,
            }))}
          />
        )}
      </div>
    );
  }

  // ── (a) Bảng học viên các lớp mình (nhóm theo lớp + client search + lọc lớp) ───
  // Đọc QUA quan hệ class (enrollment dev centerId=null bị scopedDb lọc nếu query thẳng).
  const listClasses = classIds.length
    ? await sdb.class.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          name: true,
          // DANH SÁCH đọc "lich-su" rồi để client lọc theo ô "Trạng thái" (mặc định
          // Đang học). Trước đây chỉ có `deletedAt: null` nên trang đếm 103 em còn
          // Tổng quan đếm 81 — cùng tập lớp, hai con số (QA vòng 1, BUG-024). Thêm
          // student.deletedAt: HV đã xoá khỏi hệ thống không được hiện tên.
          enrollments: {
            where: rosterWhere("lich-su"),
            // Câu 46: CHỈ tên + mã HV — KHÔNG contact PH.
            select: {
              status: true,
              student: { select: { id: true, name: true, studentCode: true } },
            },
            orderBy: { student: { name: "asc" } },
          },
        },
      })
    : [];
  const enrRows = listClasses.flatMap((c) =>
    c.enrollments.map((e) => ({
      status: e.status,
      student: e.student,
      classId: c.id,
      className: c.name,
    })),
  );

  // HV học 2 lớp mình → gộp 1 dòng, liệt kê các lớp (giữ trạng thái "cao nhất").
  // Giữ THÊM trạng thái của TỪNG lớp: bảng ở chế độ "Nhóm theo lớp" phải hiện trạng
  // thái trong chính lớp đó, không thì em đã nghỉ lớp A vẫn đọc là "Đang học" ở khối
  // lớp A chỉ vì còn ghi danh ở lớp B. `status` gộp chỉ dùng cho danh sách phẳng.
  const byStudent = new Map<string, StudentRow>();
  for (const r of enrRows) {
    const cur = byStudent.get(r.student.id) ?? {
      id: r.student.id,
      name: r.student.name,
      studentCode: r.student.studentCode,
      classes: [],
      status: r.status,
    };
    // Cùng một lớp có thể có nhiều ghi danh (ghi danh lại) → 1 mục/lớp, ưu tiên active.
    // Đối chiếu theo ID chứ KHÔNG theo tên: `Class.name` không có ràng buộc unique
    // (chỉ `classCode` mới unique), nên hai lớp trùng tên sẽ bị nhập làm một —
    // khối "Nhóm theo lớp" ở màn danh sách khi đó cộng nhầm sĩ số của cả hai.
    const sameClass = cur.classes.find((c) => c.id === r.classId);
    if (!sameClass)
      cur.classes.push({ id: r.classId, name: r.className, status: r.status });
    else if (ENROLLMENT_ACTIVE_STATUS_LIST.includes(r.status))
      sameClass.status = r.status;
    if (ENROLLMENT_ACTIVE_STATUS_LIST.includes(r.status)) cur.status = r.status; // ưu tiên active
    byStudent.set(r.student.id, cur);
  }
  const rows = [...byStudent.values()];

  return (
    <div>
      <PageHeader
        title="Hồ sơ học viên"
        subtitle="Học viên các lớp bạn phụ trách — chọn học viên để xem chuyên cần, nhận xét, bài tập và học bạ."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="Bạn chưa được phân công lớp nào hoặc lớp chưa có học viên."
        />
      ) : (
        <StudentList rows={rows} />
      )}
    </div>
  );
}

type Sdb = ReturnType<typeof scopedDb>;

/* ── Tab bar (server, searchParams) ─────────────────────────────────────────── */
function ProfileTabBar({
  studentId,
  active,
  activeClassId,
}: {
  studentId: string;
  active: ProfileTab;
  activeClassId: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <nav
        className="flex min-w-max gap-1 border-b border-border"
        aria-label="Hồ sơ học viên"
      >
        {PROFILE_TABS.map((t) => {
          const Icon = t.icon;
          const on = t.key === active;
          return (
            <Link
              key={t.key}
              // href chỉ-query: mọi tham số ngữ cảnh phải ghép LẠI ở đây, nếu không
              // đổi tab là mất lớp đang lọc.
              href={profileTabHref({
                studentId,
                tab: t.key,
                activeClassId,
              })}
              // Đổi tab = đổi tham số truy vấn trên CÙNG trang hồ sơ (không rời màn)
              // → giữ nguyên vị trí cuộn thay vì bị kéo về đầu trang.
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                on
                  ? "border-primary text-primary-ink dark:border-primary dark:text-primary-ink"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/* ── Tab Điểm danh: từng buổi + badge ───────────────────────────────────────── */
async function AttendanceTab({
  sdb,
  studentId,
  classIds,
  multiClass,
  enrollmentStatusByClass,
}: {
  sdb: Sdb;
  studentId: string;
  classIds: string[];
  multiClass: boolean;
  enrollmentStatusByClass: Map<string, string>;
}) {
  const sessions = await sdb.classSession.findMany({
    where: { classId: { in: classIds } },
    select: {
      id: true,
      classId: true,
      date: true,
      topic: true,
      status: true,
      // Nguồn NHÃN BUỔI — thiếu hai quan hệ này thì deriveSessionLabel chỉ còn `topic`
      // thô và in ra "Buổi 10" trần.
      plan: { select: { customTitle: true, order: true } },
      lesson: { select: { order: true, title: true, moduleCode: true } },
      class: { select: { name: true } },
      attendances: { where: { studentId }, select: { status: true } },
    },
    orderBy: { date: "asc" },
  });
  // `vnEndOfDay` (23:59:59.999 hôm nay, giờ VN) — KHÔNG tự dựng Date: Vercel chạy UTC
  // còn máy dev +07. Repo còn 4 bản `vnTodayEnd` viết tay ở nơi khác trả 00:00 NGÀY
  // MAI; gộp chúng lại là ticket riêng vì lệch đúng một mili giây ở mốc biên và một
  // trong bốn chỗ là cổng GHI ở server.
  const todayEndMs = vnEndOfDay(new Date()).getTime();
  const sessionNo = buildSessionNumberMap(
    sessions.map((s) => ({ id: s.id, classId: s.classId, date: s.date })),
  );
  if (sessions.length === 0) {
    return (
      <EmptyState icon={CalendarCheck} title="Lớp chưa có buổi học nào." />
    );
  }
  return (
    <div className="t-card overflow-hidden">
      <ul className="divide-y divide-border">
        {sessions.map((s) => {
          const att = s.attendances[0]?.status as AttendanceStatus | undefined;
          const cell = studentAttendanceCell({
            attendanceStatus: att ?? null,
            sessionStatus: s.status,
            sessionDateMs: s.date.getTime(),
            todayEndMs,
            enrollmentStatus: enrollmentStatusByClass.get(s.classId) ?? null,
          });
          return (
            <li key={s.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="w-24 shrink-0 text-sm font-semibold text-muted-foreground">
                {dayFmt.format(s.date)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {/* deriveSessionLabel ghép "Buổi N - HP1 - Tên bài" và tự BỎ QUA
                      `topic` khi nó chỉ là ô trống "Buổi N" — đừng ghép chuỗi tay,
                      đó là nguồn của "Buổi 10 · Buổi 10". */}
                  {deriveSessionLabel({
                    sessionNumber: sessionNo.get(s.id) ?? null,
                    planTitle: s.plan?.customTitle,
                    planOrder: s.plan?.order,
                    lessonTitle: s.lesson?.title,
                    lessonOrder: s.lesson?.order,
                    moduleCode: s.lesson?.moduleCode,
                    topic: s.topic,
                  }) || "Buổi học"}
                </p>
                {multiClass && (
                  <p className="truncate text-xs text-muted-foreground">
                    {s.class.name}
                  </p>
                )}
              </div>
              {cell.kind === "MARKED" ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                    ATT_BADGE[cell.status].cls,
                  )}
                >
                  {ATT_BADGE[cell.status].label}
                </span>
              ) : (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                    // "Chưa điểm danh" là VIỆC CÒN NỢ nên tô hổ phách để nhìn ra ngay;
                    // ba ca còn lại là thông tin trung tính.
                    cell.kind === "NOT_MARKED"
                      ? "bg-state-warning-soft text-state-warning-ink"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {STUDENT_ATTENDANCE_CELL_LABEL[cell.kind]}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Tab Nhận xét: phiếu từng buổi (Dự án + 4 mục + Xem phiếu) ───────────────── */
async function ReviewsTab({
  sdb,
  studentId,
  classIds,
  multiClass,
}: {
  sdb: Sdb;
  studentId: string;
  classIds: string[];
  multiClass: boolean;
}) {
  const feedbacks = await sdb.studentSessionFeedback.findMany({
    where: { studentId, classSession: { classId: { in: classIds } } },
    select: {
      id: true,
      projectName: true,
      notes: true,
      // `rubric` chỉ dùng để biết phiếu có nội dung hay không (gate nút "Xem phiếu").
      rubric: true,
      comment: true,
      rating: true,
      classSession: {
        select: {
          id: true,
          classId: true,
          date: true,
          topic: true,
          plan: { select: { customTitle: true, order: true } },
          lesson: { select: { order: true, title: true, moduleCode: true } },
          class: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // R1 21/08 — số buổi, tính trên TOÀN BỘ buổi của các lớp học viên đang theo
  // (lib/lms/session-order); tab này trước đây là màn nhận xét DUY NHẤT không có số buổi.
  const allSessions = classIds.length
    ? await sdb.classSession.findMany({
        where: { classId: { in: classIds } },
        select: { id: true, classId: true, date: true },
      })
    : [];
  const sessionNumberOf = buildSessionNumberMap(allSessions);

  if (feedbacks.length === 0) {
    return (
      <EmptyState
        icon={ClipboardPen}
        title="Chưa có nhận xét"
        description="Các buổi đã dạy sẽ hiển thị nhận xét của giáo viên tại đây."
      />
    );
  }
  return (
    <div className="space-y-4">
      {feedbacks.map((f) => {
        // 21/08 — MỘT cửa đọc văn xuôi cho cả phiếu mới ("Đánh giá chung") lẫn phiếu cũ
        // (4 mục). Đừng quay lại đọc thẳng notes.knowledge/… — phiếu mới sẽ mất chữ.
        const prose = evalNotesProse(normalizeEvalNotes(f.notes));
        // Nút "Xem phiếu" trước đây render VÔ ĐIỀU KIỆN, kể cả với phiếu GV mở rồi bỏ
        // trống — bấm vào ra trang JSON 404 thô. Gate theo đúng điều kiện của route PDF.
        const hasPdfContent = feedbackHasContent(f);
        return (
          <div key={f.id} className="t-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {/* Trước đây ghép TAY `sessionNumberLabel(...)` + `topic` thô. Với
                      giáo trình Sata, `topic` chính là chuỗi "Buổi 10" ⇒ 16/16 thẻ in
                      "Buổi 10 · Buổi 10" (QA vòng 1, BUG-008). deriveSessionLabel đã
                      xử đúng: nó in số buổi MỘT lần và bỏ qua `topic` khi topic chỉ là
                      ô trống "Buổi N" (meaningfulSessionTitle). */}
                  {deriveSessionLabel({
                    sessionNumber: sessionNumberOf.get(f.classSession.id) ?? null,
                    planTitle: f.classSession.plan?.customTitle,
                    planOrder: f.classSession.plan?.order,
                    lessonTitle: f.classSession.lesson?.title,
                    lessonOrder: f.classSession.lesson?.order,
                    moduleCode: f.classSession.lesson?.moduleCode,
                    topic: f.classSession.topic,
                  }) || "Buổi học"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {dayFmt.format(f.classSession.date)}
                  {multiClass ? ` · ${f.classSession.class.name}` : ""}
                  {/* 26/08 — tên dự án suy từ BUỔI, không in bản sao đông cứng trên phiếu. */}
                  {(() => {
                    const duAn = resolveDisplayProjectName(
                      {
                        sessionNumber: sessionNumberOf.get(f.classSession.id) ?? null,
                        planTitle: f.classSession.plan?.customTitle,
                        planOrder: f.classSession.plan?.order,
                        lessonTitle: f.classSession.lesson?.title,
                        lessonOrder: f.classSession.lesson?.order,
                        moduleCode: f.classSession.lesson?.moduleCode,
                        topic: f.classSession.topic,
                      },
                      f.projectName,
                    );
                    return duAn ? ` · ${duAn}` : "";
                  })()}
                </p>
              </div>
              {hasPdfContent && (
                <a
                  href={`/teacher/nhan-xet/pdf/${f.classSession.id}/${studentId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:text-primary-ink-hover"
                >
                  Xem phiếu <FileDown className="h-4 w-4" aria-hidden />
                </a>
              )}
            </div>
            {prose?.kind === "overall" ? (
              <div className="rounded-lg bg-muted/50 px-3.5 py-2.5">
                <p className="text-xs font-bold uppercase tracking-wide text-primary-ink">
                  {EVAL_OVERALL_LABEL}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
                  {prose.text}
                </p>
              </div>
            ) : prose?.kind === "legacy" ? (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {prose.rows.map((r) => (
                  <NoteItem key={r.key} label={r.label} value={r.text} />
                ))}
              </dl>
            ) : f.comment ? (
              <p className="whitespace-pre-wrap rounded-lg bg-muted/50 px-3.5 py-2.5 text-sm text-foreground">
                {f.comment}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function NoteItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3.5 py-2.5">
      <p className="text-xs font-bold uppercase tracking-wide text-primary-ink">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-foreground">{value || "—"}</p>
    </div>
  );
}

/* ── Tab Bài tập & Kiểm tra: bảng từng bài ──────────────────────────────────── */
async function AssignmentsTab({
  sdb,
  studentId,
  classIds,
}: {
  sdb: Sdb;
  studentId: string;
  classIds: string[];
}) {
  const subs = await sdb.assignmentSubmission.findMany({
    where: { studentId, assignment: { classId: { in: classIds } } },
    select: {
      id: true,
      status: true,
      score: true,
      assignment: {
        select: {
          id: true,
          title: true,
          dueAt: true,
          totalPoints: true,
          // Hai dòng cùng tên bài ở hai lớp khác nhau trước đây không phân biệt được
          // (QA vòng 1, BUG-010).
          class: { select: { name: true } },
          _count: { select: { questions: true } },
        },
      },
    },
    orderBy: { assignment: { assignedAt: "desc" } },
  });
  if (subs.length === 0) {
    return (
      <EmptyState
        icon={NotebookPen}
        title="Chưa có bài tập"
        description="Bài tập và bài kiểm tra được giao cho lớp sẽ hiển thị tại đây."
      />
    );
  }
  return (
    <div className="t-card overflow-hidden">
      <PhanTrangBang cuonNgang
          khoaGhiNho="gv-ho-so-bai-tap">
        <table className="min-w-[660px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <th scope="col" className="px-5 py-3">
                Nội dung
              </th>
              <th scope="col" className="px-5 py-3">
                Lớp
              </th>
              <th scope="col" className="px-5 py-3">
                Hình thức
              </th>
              <th scope="col" className="px-5 py-3">
                Hạn nộp
              </th>
              <th scope="col" className="px-5 py-3">
                Tình trạng
              </th>
              <th scope="col" className="px-5 py-3">
                Điểm
              </th>
              <th scope="col" className="px-5 py-3 text-right">
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody>
            {subs.map((s, i) => {
              const isTest = s.assignment._count.questions > 0;
              const submitted = s.status !== "NOT_SUBMITTED";
              const due =
                s.assignment.dueAt && s.assignment.dueAt.getFullYear() >= 2000
                  ? dueFmt.format(s.assignment.dueAt)
                  : "—";
              return (
                <tr
                  key={i}
                  className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50"
                >
                  <td className="min-w-[14rem] px-5 py-3.5 font-semibold text-foreground">
                    {s.assignment.title}
                  </td>
                  <td className="min-w-[9rem] px-5 py-3.5 text-muted-foreground">
                    {s.assignment.class.name}
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge
                      variant="outline"
                      className={
                        isTest
                          ? "border-primary-soft bg-primary-soft text-primary-ink dark:border-primary dark:bg-primary-soft dark:text-primary-ink"
                          : "border-state-info-soft bg-state-info-soft text-state-info-ink dark:border-state-info"
                      }
                    >
                      {isTest ? "Kiểm tra" : "Bài tập"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap text-foreground">
                    {due}
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    {/* Nhãn đi qua registry dùng chung: bản chép tay cũ chỉ có hai
                        nhãn nên "Nộp muộn" đọc ra y hệt nộp đúng hạn, và "Đã chấm"
                        không phân biệt được với đang chờ chấm. */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 font-medium",
                        s.status === "GRADED"
                          ? "text-state-success-ink"
                          : s.status === "NOT_SUBMITTED"
                            ? "text-state-warning-ink"
                            : "text-foreground",
                      )}
                    >
                      {s.status === "GRADED" && (
                        <CircleCheck className="h-4 w-4" aria-hidden />
                      )}
                      {SUBMISSION_STATUS.label(s.status)}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 whitespace-nowrap font-semibold text-foreground">
                    {s.score != null
                      ? `${s.score}/${s.assignment.totalPoints}`
                      : "—"}
                  </td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    {/* Trước đây 0/6 dòng có link — từ hồ sơ học viên không có đường
                        nào mở bài em đã làm, dù luồng đó chạy đúng ở cấp lớp. */}
                    {submitted ? (
                      <Link
                        href={`/teacher/cham-bai?submissionId=${s.id}`}
                        className="rounded-sm text-sm font-semibold text-primary-ink outline-none hover:text-primary-ink-hover hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Xem bài đã làm
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}

/* ── Tab Học bạ: chuyên cần + năng lực + trạng thái duyệt + link mở học bạ ──── */
async function HocBaTab({
  sdb,
  enrollments,
}: {
  sdb: Sdb;
  enrollments: {
    id: string;
    courseId: string;
    status: string;
    className: string;
    courseName: string;
  }[];
}) {
  const enrollmentIds = enrollments.map((e) => e.id);
  const [summaries, criteriaLists, cards] = await Promise.all([
    // Gộp: mỗi lần gọi attendanceSummary tốn ~6 truy vấn (xem ghi chú ở summary.ts).
    attendanceSummaryForEnrollments(enrollmentIds),
    Promise.all(enrollments.map((e) => getCourseCriteria(e.courseId))),
    sdb.reportCard.findMany({
      where: { enrollmentId: { in: enrollmentIds } },
      select: {
        enrollmentId: true,
        status: true,
        scores: { select: { criterionId: true, level: true } },
      },
    }),
  ]);
  const cardByEnrollment = new Map(cards.map((c) => [c.enrollmentId, c]));

  return (
    <div className="space-y-5">
      {enrollments.map((e, i) => {
        const sum = summaries.get(e.id) ?? {
          total: 0,
          attended: 0,
          absent: 0,
          needMakeup: 0,
          madeUp: 0,
        };
        const criteria = criteriaLists[i];
        const card = cardByEnrollment.get(e.id);
        const levelByCriterion = new Map(
          (card?.scores ?? []).map((sc) => [sc.criterionId, sc.level]),
        );
        const rate =
          sum.total > 0 ? Math.round((sum.attended / sum.total) * 100) : null;
        const rs = card ? REPORT_STATUS[card.status] : null;
        return (
          <Card key={e.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {e.className} · {e.courseName}
                </CardTitle>
                <div className="flex items-center gap-2">
                  {rs && (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                        rs.cls,
                      )}
                    >
                      {rs.label}
                    </span>
                  )}
                  <Link
                    href={`/teacher/hoc-ba?enrollmentId=${e.id}`}
                    className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-primary-ink outline-none hover:text-primary-ink-hover focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Mở học bạ <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Chuyên cần
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <StatBox
                    value={rate != null ? `${rate}%` : "—"}
                    label="Tỉ lệ chuyên cần"
                    tone="emerald"
                  />
                  <StatBox
                    value={
                      sum.total > 0
                        ? `${sum.attended}/${sum.total}`
                        : String(sum.attended)
                    }
                    label="Đã học (buổi)"
                    tone="blue"
                  />
                  <StatBox
                    value={String(sum.absent + sum.needMakeup)}
                    label="Vắng (buổi)"
                    tone="red"
                  />
                </div>
              </section>
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Năng lực (học bạ, thang 1-4)
                </h3>
                {criteria.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Khoá học chưa cấu hình tiêu chí năng lực.
                  </p>
                ) : levelByCriterion.size === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Học bạ chưa chấm tiêu chí nào — vào mục Học bạ để nhập.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {criteria.map((c) => (
                      <CompetencyBar
                        key={c.id}
                        label={c.name}
                        level={levelByCriterion.get(c.id) ?? null}
                      />
                    ))}
                  </div>
                )}
              </section>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ── helpers dùng lại ───────────────────────────────────────────────────────── */
const STAT_TONE = {
  emerald: "bg-state-success-soft text-state-success-ink",
  blue: "bg-state-info-soft text-state-info-ink",
  red: "bg-state-danger-soft text-state-danger-ink",
  amber: "bg-state-warning-soft text-state-warning-ink",
} as const;

function StatBox({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: keyof typeof STAT_TONE;
}) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${STAT_TONE[tone]}`}>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}

function CompetencyBar({
  label,
  level,
}: {
  label: string;
  level: number | null;
}) {
  const pct =
    level != null ? Math.round((Math.min(4, Math.max(0, level)) / 4) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium text-foreground">
          {label}
        </span>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">
          {level != null ? (LEVEL_LABEL[level] ?? String(level)) : "Chưa chấm"}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function NotYours() {
  return (
    <div className="space-y-4">
      <BackLink href="?" label="Hồ sơ học viên" />
      <EmptyState icon={Lock} title="Học viên không thuộc lớp bạn phụ trách." />
    </div>
  );
}
