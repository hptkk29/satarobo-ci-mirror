// app/(teacher)/teacher/hoan-thanh/page.tsx — MÀN 2: "Hoàn thành khoá" site GV (READ-ONLY).
//
// Port VISUAL từ mock satarobo-ui-giaovien/(admin)/hoan-thanh-khoa — data layer viết lại.
// QUYỀN: RBAC v2 đã SIẾT `completions:manage` khỏi TEACHER có chủ đích (seed-roles.ts —
// "QL xác nhận hoàn thành khoá") dù matrix v1 còn cho → màn GV CHỈ XEM TIẾN ĐỘ, KHÔNG có
// action ghi. Nút "Đề xuất hoàn thành" của mock = backlog (cần Kiệt chốt model/quyền).
//
// 2 mức điều hướng qua searchParams (không route động — giống /teacher/lop):
//   (a) không tham số → danh sách lớp được phân + tiến độ buổi COMPLETED/tổng (loại
//                       CANCELLED) + thanh % (div width — không Recharts).
//   (b) ?classId=…    → bảng học viên (enrollment active): chuyên cần + trạng thái
//                       CourseCompletion (badge "Đã hoàn thành + mã chứng chỉ" / "Chưa").
//
// Chuyên cần: KHÔNG dùng wrapper attendanceSummary(enrollmentId) — 2+ query/enrollment
// thành N+1 cho cả roster. Thay bằng 1 query attendance.findMany batch cho cả lớp rồi
// gom theo studentId qua hàm thuần computeAttendanceSummary (cùng ngữ nghĩa 5 chỉ số).
//
// Cách ly cơ sở + chống IDOR đọc: scopedDb(actorGiangDay(actor)) + guard classId ∈ actor.assignedClassIds
// TRƯỚC mọi query chi tiết. CourseCompletion KHÔNG có centerId / KHÔNG ∈ SCOPED_MODELS →
// đọc qua sdb pass-through; own-class đã gác bằng assignedClassIds + courseId suy từ lớp
// (không tin client) — giống admin hoan-thanh-khoa/_actions.ts.
// ⚠️ Câu 46: payload chỉ TÊN học viên — KHÔNG SĐT/email/tên phụ huynh.
import { GraduationCap, Lock, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import {
  computeAttendanceSummary,
  type AttendanceSummaryItem,
} from "@/lib/attendance/summary";
import type {
  AttendanceStatusValue,
  MakeupStatusValue,
  SessionStatusValue,
} from "@/lib/labels";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "../_components/ui/empty-state";
import { PageHeader } from "../_components/ui/page-header";
import {
  CompletionTable,
  type CompletionTableRow,
} from "./_components/completion-table";
import { BackLink } from "../_components/ui/back-link";
import { CompletionClassGrid } from "./_components/completion-class-grid";

export const metadata = { title: "Hoàn thành khoá | Giáo viên Sata Robo" };

const dayFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

/** Gom kết quả groupBy buổi học → { tổng (loại CANCELLED), đã dạy, % }. */
function tallySessions(rows: { status: string; _count: { _all: number } }[]) {
  let total = 0;
  let completed = 0;
  for (const r of rows) {
    if (r.status === "CANCELLED") continue; // buổi hủy không tính tiến độ
    total += r._count._all;
    if (r.status === "COMPLETED") completed += r._count._all;
  }
  return {
    total,
    completed,
    pct: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export default async function TeacherCompletionsPage({
  searchParams,
}: {
  // `q` / `trangThai`: bộ lọc lưới lớp, đọc Ở SERVER (xem use-loc-tren-url.ts).
  searchParams: Promise<{ classId?: string; q?: string; trangThai?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate — guard cho type-narrow

  const { classId, q: spQ, trangThai: spTrangThai } = await searchParams;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  // ── (b) Chi tiết 1 lớp — bảng học viên ───────────────────────────────────────
  if (classId) {
    // Gác ĐỌC chống IDOR TRƯỚC khi query: GV chỉ xem lớp mình phụ trách.
    if (!actor.assignedClassIds.has(classId)) return <NotYours />;

    const cls = await sdb.class.findUnique({
      where: { id: classId },
      select: {
        id: true,
        name: true,
        courseId: true,
        course: {
          select: { name: true, nextCourse: { select: { name: true } } },
        },
      },
    });
    if (!cls) return <NotYours />; // ngoài scope cơ sở / đã xoá

    const [sessionRows, enrollments] = await Promise.all([
      sdb.classSession.groupBy({
        by: ["status"],
        where: { classId },
        _count: { _all: true },
      }),
      // Đọc QUA quan hệ class (enrollment dev centerId=null bị scopedDb lọc nếu query
      // thẳng → bảng rỗng). Pattern hub-students-tab / hoc-vien.
      sdb.class
        .findUnique({
          where: { id: classId },
          select: {
            // "ket-khoa" — module này SINH RA để quản lý em đã kết khoá, mà lọc
            // "đang học" lại loại đúng nhóm đó: 11 lớp đã kết thúc trên UAT đều hiện
            // "0 học viên" kèm "Lớp chưa có học viên đang học", trong khi trang Học
            // viên liệt kê 10 em (QA vòng 1, BUG-021).
            enrollments: {
              where: rosterWhere("ket-khoa"),
              select: {
                id: true,
                studentId: true,
                student: { select: { name: true } }, // câu 46: CHỈ tên HV, KHÔNG contact PH
              },
              orderBy: { student: { name: "asc" } },
            },
          },
        })
        .then((c) => c?.enrollments ?? []),
    ]);
    const progress = tallySessions(sessionRows);
    const studentIds = enrollments.map((e) => e.studentId);

    // Chuyên cần batch: 1 query cho cả lớp (thay vì attendanceSummary/enrollment = N+1).
    const attRows = studentIds.length
      ? await sdb.attendance.findMany({
          where: { studentId: { in: studentIds }, session: { classId } },
          select: {
            studentId: true,
            status: true,
            makeupStatus: true,
            session: { select: { status: true } },
          },
        })
      : [];
    // CourseCompletion theo unique (studentId, courseId) — courseId suy từ lớp.
    const [completions, pendingReqs] = await Promise.all([
      studentIds.length
        ? sdb.courseCompletion.findMany({
            where: { courseId: cls.courseId, studentId: { in: studentIds } },
            select: {
              studentId: true,
              certificateCode: true,
              completedAt: true,
              finalGrade: true,
            },
          })
        : Promise.resolve(
            [] as {
              studentId: string;
              certificateCode: string;
              completedAt: Date;
              finalGrade: string | null;
            }[],
          ),
      // Đề xuất hoàn thành đang CHỜ DUYỆT của các ghi danh này (trạng thái "Chờ duyệt").
      enrollments.length
        ? sdb.courseCompletionRequest.findMany({
            where: {
              enrollmentId: { in: enrollments.map((e) => e.id) },
              status: "PENDING",
            },
            select: { enrollmentId: true },
          })
        : Promise.resolve([] as { enrollmentId: string }[]),
    ]);
    const pendingSet = new Set(pendingReqs.map((r) => r.enrollmentId));

    const attByStudent = new Map<string, AttendanceSummaryItem[]>();
    for (const a of attRows) {
      const list = attByStudent.get(a.studentId) ?? [];
      list.push({
        status: a.status as AttendanceStatusValue,
        makeupStatus: a.makeupStatus as MakeupStatusValue | null,
        sessionStatus: a.session.status as SessionStatusValue,
      });
      attByStudent.set(a.studentId, list);
    }
    const completionByStudent = new Map(
      completions.map((c) => [c.studentId, c]),
    );

    // Rows PLAIN cho client table (search + cột Kết quả). Câu 46: chỉ tên HV.
    const rows: CompletionTableRow[] = enrollments.map((e) => {
      const s = computeAttendanceSummary({
        totalLessons: progress.total,
        attendances: attByStudent.get(e.studentId) ?? [],
      });
      const done = completionByStudent.get(e.studentId);
      return {
        id: e.id,
        name: e.student.name,
        attended: s.attended,
        absent: s.absent,
        needMakeup: s.needMakeup,
        passed: Boolean(done),
        certificateCode: done?.certificateCode ?? null,
        completedAtLabel: done ? dayFmt.format(done.completedAt) : null,
        finalGrade: done?.finalGrade ?? null,
        nextCourseName: cls.course.nextCourse?.name ?? null,
        requestPending: pendingSet.has(e.id),
      };
    });

    return (
      <div className="space-y-4">
        <BackLink href="?" label="Hoàn thành khoá" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">{cls.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {cls.course.name} · tiến độ và trạng thái hoàn thành khoá — chỉ xem.
          </p>
        </div>

        {/* Tiến độ lớp: buổi đã dạy / tổng buổi (loại buổi hủy) */}
        <Card>
          <CardContent className="space-y-2 py-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">Tiến độ lớp</span>
              <span className="text-muted-foreground">
                {progress.completed}/{progress.total} buổi · {progress.pct}%
              </span>
            </div>
            <ProgressBar pct={progress.pct} />
          </CardContent>
        </Card>

        {/* Chủ dự án chốt 03/09 (quyết định #1): mẫu số chuyên cần là TỔNG BUỔI CỦA
            KHOÁ, giữ nguyên như học bạ và cổng phụ huynh. Màn này trước đó dùng "số
            buổi đã COMPLETED" nên cùng một em ra "7/7" ở đây và "7/11" ở học bạ
            (QA vòng 1, BUG-023). `heldSessions` chỉ dùng để CẢNH BÁO lúc đề xuất. */}
        {enrollments.length === 0 ? (
          <EmptyState icon={Users} title="Lớp chưa có học viên nào." />
        ) : (
          <CompletionTable
            rows={rows}
            completedSessions={progress.total}
            heldSessions={progress.completed}
          />
        )}
      </div>
    );
  }

  // ── (a) Danh sách lớp được phân + tiến độ ────────────────────────────────────
  const classes = classIds.length
    ? await sdb.class.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          name: true,
          status: true, // để lọc bỏ lớp đã huỷ / chưa khai giảng khỏi lưới
          course: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      })
    : [];
  const sessionRows = classIds.length
    ? await sdb.classSession.groupBy({
        by: ["classId", "status"],
        where: { classId: { in: classIds } },
        _count: { _all: true },
      })
    : [];
  // Sĩ số đang học — đọc qua _count LỒNG quan hệ class (KHÔNG bị scopedDb lọc như
  // groupBy/findMany enrollment trực tiếp khi enrollment dev centerId=null).
  const enrollCounts = classIds.length
    ? await sdb.class.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          // Cùng phạm vi với bảng chi tiết — nếu không thì thẻ lớp ghi "0 học viên"
          // còn bấm vào lại ra 10 dòng.
          _count: { select: { enrollments: { where: rosterWhere("ket-khoa") } } },
        },
      })
    : [];

  const sessionsByClass = new Map<
    string,
    { status: string; _count: { _all: number } }[]
  >();
  for (const r of sessionRows) {
    const list = sessionsByClass.get(r.classId) ?? [];
    list.push(r);
    sessionsByClass.set(r.classId, list);
  }
  const studentCountByClass = new Map(
    enrollCounts.map((c) => [c.id, c._count.enrollments]),
  );

  return (
    <div>
      <PageHeader
        title="Hoàn thành khoá"
        subtitle="Tiến độ khoá học của các lớp bạn phụ trách. Bạn ĐỀ XUẤT hoàn thành cho từng học viên; trung tâm duyệt và cấp chứng chỉ trên trang quản trị."
      />

      {classes.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="Bạn chưa được phân công lớp nào."
        />
      ) : (
        <CompletionClassGrid
          banDauLoc={{ q: spQ, trangThai: spTrangThai }}
          rows={classes.map((c) => {
            const p = tallySessions(sessionsByClass.get(c.id) ?? []);
            return {
              id: c.id,
              name: c.name,
              courseName: c.course.name,
              status: c.status,
              completedSessions: p.completed,
              totalSessions: p.total,
              studentCount: studentCountByClass.get(c.id) ?? 0,
            };
          })}
        />
      )}
    </div>
  );
}

/** Thanh tiến độ thuần div (không Recharts — site GV cấm chart lib admin). */
function ProgressBar({ pct }: { pct: number }) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function NotYours() {
  return (
    <div className="space-y-4">
      <BackLink href="?" label="Hoàn thành khoá" />
      <EmptyState
        icon={Lock}
        title="Lớp không thuộc danh sách bạn phụ trách."
      />
    </div>
  );
}
