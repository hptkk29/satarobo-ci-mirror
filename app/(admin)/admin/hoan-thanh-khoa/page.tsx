import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import {
  getNonEnrollableCenterIds,
  notHeadOfficeWhere,
} from "@/lib/enrollment-flow";
import { CompletionForm } from "./_components/completion-form";
import { BulkCompleteByClass } from "./_components/bulk-complete-by-class";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { ReviewTable, type RequestRow } from "./_components/review-table";

const reqDateFmt = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

export const metadata = { title: "Hoàn thành khoá | Admin" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ classId?: string }>;
}

export default async function CompletionPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("completions:manage"))) redirect("/dashboard");

  const sp = await searchParams;
  const selectedClassId = sp.classId?.trim() || "";

  // Cách ly cơ sở: Student/Class ∈ SCOPED_MODELS → sdb auto-inject centerId.
  // CourseCompletion KHÔNG scoped (không có centerId trực tiếp) → scope thủ công qua
  // student.centerId, dùng tầm nhìn cơ sở của model Student. Course không có dữ liệu
  // cơ sở → sdb pass-through (no-op).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const visibleStudentCenters = getModelVisibleCenterIds("Student", actor);
  const completionCenterWhere: Prisma.CourseCompletionWhereInput =
    visibleStudentCenters === "ALL"
      ? {}
      : { student: { centerId: { in: visibleStudentCenters } } };

  // FL2-05 — Hội sở không nhận học viên → loại HV/lớp thuộc cơ sở HO khỏi danh sách.
  const hoCenterIds = await getNonEnrollableCenterIds();

  const [students, courses, completions] = await Promise.all([
    sdb.student.findMany({
      where: { deletedAt: null, ...notHeadOfficeWhere(hoCenterIds) },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, studentCode: true },
    }),
    sdb.course.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    sdb.courseCompletion.findMany({
      where: completionCenterWhere,
      orderBy: { completedAt: "desc" },
      take: 50,
      select: {
        id: true,
        certificateCode: true,
        completedAt: true,
        finalGrade: true,
        nextCourseId: true,
        student: { select: { name: true } },
        course: { select: { name: true } },
      },
    }),
  ]);

  // nextCourseId không có relation riêng → map tên từ danh sách khoá đã nạp.
  const courseName = new Map(courses.map((c) => [c.id, c.name]));

  // ĐỀ XUẤT CHỜ DUYỆT do giáo viên gửi (QA site GV vòng 1, BUG-028 — trước 03/09 không
  // màn nào đọc bảng này nên đề xuất nằm PENDING vĩnh viễn).
  // `CourseCompletionRequest` có `centerId` ⇒ thuộc SCOPED_MODELS, sdb tự lọc cơ sở.
  // Bảng không có quan hệ tới Student/Course (chỉ giữ id trần) nên tên đọc rời rồi ghép.
  const pendingRequests = await sdb.courseCompletionRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" }, // chờ lâu nhất lên trước
    take: 200,
    select: {
      id: true,
      note: true,
      createdAt: true,
      enrollmentId: true,
      studentId: true,
      courseId: true,
    },
  });
  const [reqStudents, reqEnrollments] = await Promise.all([
    pendingRequests.length
      ? sdb.student.findMany({
          where: {
            id: { in: [...new Set(pendingRequests.map((r) => r.studentId))] },
          },
          select: { id: true, name: true, studentCode: true },
        })
      : Promise.resolve([]),
    pendingRequests.length
      ? sdb.enrollment.findMany({
          where: { id: { in: pendingRequests.map((r) => r.enrollmentId) } },
          select: { id: true, class: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const reqStudentById = new Map(reqStudents.map((s) => [s.id, s]));
  const reqClassByEnrollment = new Map(
    reqEnrollments.map((e) => [e.id, e.class?.name ?? null]),
  );
  const reqRows: RequestRow[] = pendingRequests.map((r) => ({
    id: r.id,
    studentName: reqStudentById.get(r.studentId)?.name ?? "(không rõ học viên)",
    studentCode: reqStudentById.get(r.studentId)?.studentCode ?? null,
    courseName: courseName.get(r.courseId) ?? "(không rõ khoá)",
    className: reqClassByEnrollment.get(r.enrollmentId) ?? null,
    note: r.note,
    createdAtLabel: reqDateFmt.format(r.createdAt),
  }));

  // Danh sách lớp cho bộ chọn bulk (Class ∈ SCOPED_MODELS → sdb auto-scope cơ sở).
  const classes = await sdb.class.findMany({
    where: { deletedAt: null, ...notHeadOfficeWhere(hoCenterIds) },
    orderBy: [{ startDate: "desc" }, { name: "asc" }],
    take: 300,
    select: {
      id: true,
      name: true,
      classCode: true,
      course: { select: { name: true } },
      center: { select: { name: true } },
    },
  });

  // Khi đã chọn lớp: nạp học viên đang theo học (enrollment active) + đánh dấu
  // ai đã hoàn thành khoá của lớp này (đã có chứng chỉ → bỏ chọn sẵn).
  let selectedClass: {
    id: string;
    name: string;
    courseName: string;
    students: {
      id: string;
      name: string;
      studentCode: string | null;
      alreadyCompleted: boolean;
    }[];
  } | null = null;

  if (selectedClassId) {
    const klass = await sdb.class.findFirst({
      where: {
        id: selectedClassId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        courseId: true,
        course: { select: { name: true } },
        enrollments: {
          where: { status: { in: ENROLLMENT_ACTIVE_STATUS_LIST } },
          select: {
            student: { select: { id: true, name: true, studentCode: true } },
          },
        },
      },
    });

    if (klass) {
      // Loại trùng học viên (1 HV có thể có nhiều enrollment active hiếm gặp).
      const byId = new Map<
        string,
        { id: string; name: string; studentCode: string | null }
      >();
      for (const e of klass.enrollments) byId.set(e.student.id, e.student);
      const studentList = Array.from(byId.values());

      const done = await sdb.courseCompletion.findMany({
        where: {
          courseId: klass.courseId,
          studentId: { in: studentList.map((s) => s.id) },
        },
        select: { studentId: true },
      });
      const doneSet = new Set(done.map((c) => c.studentId));

      selectedClass = {
        id: klass.id,
        name: klass.name,
        courseName: klass.course.name,
        students: studentList
          .map((s) => ({
            id: s.id,
            name: s.name,
            studentCode: s.studentCode,
            alreadyCompleted: doneSet.has(s.id),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "vi")),
      };
    }
  }

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">
          Hoàn thành khoá &amp; chứng chỉ
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Chốt kết quả cuối khoá và cấp chứng chỉ
        </p>
      </div>

      <PageHelp>
        <p>
          Đánh dấu học viên hoàn thành khoá, nhập đánh giá cuối khoá của GV →
          sinh chứng chỉ, gợi ý khoá tiếp theo, tạo việc chăm sóc tái tục và đẩy
          email chúc mừng.
        </p>
      </PageHelp>

      {/* Đặt TRÊN hai form bên dưới: đây là việc người khác đang chờ mình xử lý, còn
          hai form kia là việc tự khởi xướng. */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <span className="text-sm font-semibold text-foreground">
            Đề xuất chờ duyệt
          </span>
          {reqRows.length > 0 && (
            <span className="rounded-full bg-state-warning-soft px-2 py-0.5 text-xs font-semibold text-state-warning-ink">
              {reqRows.length}
            </span>
          )}
        </div>
        {reqRows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Không có đề xuất nào đang chờ. Đề xuất do giáo viên gửi từ màn “Hoàn
            thành khoá” của site giáo viên sẽ hiện ở đây.
          </p>
        ) : (
          <ReviewTable rows={reqRows} />
        )}
      </div>

      <CompletionForm students={students} />

      <BulkCompleteByClass
        classes={classes.map((c) => ({
          id: c.id,
          name: c.name,
          classCode: c.classCode,
          courseName: c.course.name,
          centerName: c.center?.name ?? null,
        }))}
        selectedClassId={selectedClassId}
        selectedClass={selectedClass}
      />

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b px-4 py-2 text-sm font-semibold text-foreground">
          Đã hoàn thành gần đây
        </div>
        <PhanTrangBang cuonNgang>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Học viên</th>
                <th className="px-4 py-2">Khoá</th>
                <th className="px-4 py-2">Xếp loại</th>
                <th className="px-4 py-2">Khoá tiếp theo</th>
                <th className="px-4 py-2">Ngày</th>
                <th className="px-4 py-2">Chứng chỉ</th>
              </tr>
            </thead>
            <tbody>
              {completions.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-center text-muted-foreground"
                  >
                    Chưa có dữ liệu.
                  </td>
                </tr>
              ) : (
                completions.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-4 py-2 font-medium">{c.student.name}</td>
                    <td className="px-4 py-2">{c.course.name}</td>
                    <td className="px-4 py-2">{c.finalGrade ?? "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {c.nextCourseId
                        ? (courseName.get(c.nextCourseId) ?? "—")
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {c.completedAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-2">
                      <a
                        href={`/api/admin/reports/certificate?code=${encodeURIComponent(c.certificateCode)}`}
                        target="_blank"
                        rel="noopener"
                        className="text-primary underline"
                      >
                        {c.certificateCode}
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
