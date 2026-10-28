// app/(teacher)/teacher/tai-lieu/page.tsx — #06 (L6): "Thư viện tài liệu" site GV.
//
// Bố cục theo reference TeachUI: BẢNG theo KHÓA HỌC (buổi/giáo án/bài tập) + tìm
// kiếm; bấm "Xem tài liệu" → bài giảng theo khung chương trình.
//
// SCOPE: chỉ KHOÁ mà GV đang dạy (suy từ assignedClassIds → courseId). KHÔNG hiện
// khoá GV không dạy — vì viewer SCORM /teacher/scorm/play gate canOpenScorm theo
// lớp GV; hiện khoá lạ sẽ ra nút mở bị chặn. Tài liệu là teaching-materials (không
// PII HV/PH — câu 46 an toàn: màn này không chạm dữ liệu HV/PH).
//
// 2 mức qua searchParams (không route động):
//   (a) không tham số → bảng khoá GV dạy.
//   (b) ?courseId=…   → bài giảng khung CT (Curriculum ACTIVE) của khoá: tài liệu
//                       (Document, mở tab mới) + SCORM (viewer site GV, watermark #14).
import { redirect } from "next/navigation";
import { BookOpen, FileText } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { isScormEnabled } from "@/lib/flags";
import { PageHeader } from "../_components/ui/page-header";
import { EmptyState } from "../_components/ui/empty-state";
import {
  CourseMaterialsList,
  type CourseMaterialRow,
} from "./_components/course-materials-list";
import {
  LessonTable,
  type LessonDoc,
  type LessonRow,
} from "./_components/lesson-table";
import { BackLink } from "../_components/ui/back-link";

export const metadata = { title: "Thư viện tài liệu | Giáo viên Sata Robo" };

const DOC_TYPE_LABEL: Record<string, string> = {
  PDF: "PDF",
  IMAGE: "Ảnh",
  VIDEO: "Video",
  SLIDE: "Slide",
  WORKSHEET: "Phiếu bài tập",
  AUDIO: "Âm thanh",
  OTHER: "Khác",
};

const CURRICULUM_SELECT = {
  id: true,
  name: true,
  lessons: {
    where: { archivedAt: null },
    orderBy: { order: "asc" },
    select: {
      id: true,
      order: true,
      title: true,
      objectives: true,
      homeworkDefault: true,
    },
  },
} as const;

export default async function TeacherMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ courseId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate login + role TEACHER

  if (!(await checkPermission("teaching-materials:view-own-class")))
    redirect("/");

  const sp = await searchParams;
  const courseId = sp.courseId?.trim() || null;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  // Lớp GV dạy → khoá GV dạy (nguồn scope cho cả 2 mức).
  const myClasses = classIds.length
    ? await sdb.class.findMany({
        where: { id: { in: classIds }, deletedAt: null },
        select: { id: true, courseId: true },
      })
    : [];
  const myCourseIds = [...new Set(myClasses.map((c) => c.courseId))];

  // ── (b) Bài giảng của 1 khoá ────────────────────────────────────────────────
  if (courseId) {
    // Guard sở hữu: chỉ khoá GV đang dạy (chống IDOR courseId lạ).
    if (!myCourseIds.includes(courseId)) return <NotYours />;

    const course = await sdb.course.findUnique({
      where: { id: courseId },
      select: { id: true, name: true },
    });
    if (!course) return <NotYours />;

    const curriculum = await sdb.curriculum.findFirst({
      where: { courseId, status: "ACTIVE" },
      orderBy: { version: "desc" },
      select: CURRICULUM_SELECT,
    });

    const curriculumName = curriculum?.name ?? null;
    const lessons = curriculum?.lessons ?? [];
    const lessonIds = lessons.map((l) => l.id);
    const scormOn = isScormEnabled();

    let lessonRows: LessonRow[] = [];
    if (lessonIds.length > 0) {
      // Lớp GV dạy khoá này → lấy buổi gắn lesson để cấp sessionId cho viewer SCORM.
      const myCourseClassIds = myClasses
        .filter((c) => c.courseId === courseId)
        .map((c) => c.id);
      const [docs, scormPkgs, sessions] = await Promise.all([
        sdb.document.findMany({
          where: { lessonId: { in: lessonIds } },
          orderBy: { title: "asc" },
          // ⚠️ KHÔNG select fileUrl — client chỉ nhận id, viewer tự tra URL ở server.
          select: { id: true, title: true, type: true, lessonId: true },
        }),
        scormOn
          ? sdb.scormPackage.findMany({
              where: {
                lessonId: { in: lessonIds },
                isActiveForLesson: true,
                status: "PUBLISHED",
              },
              select: { id: true, name: true, lessonId: true },
            })
          : Promise.resolve(
              [] as { id: string; name: string; lessonId: string }[],
            ),
        scormOn && myCourseClassIds.length
          ? sdb.classSession.findMany({
              where: {
                classId: { in: myCourseClassIds },
                lessonId: { in: lessonIds },
              },
              orderBy: { date: "desc" },
              select: { id: true, lessonId: true },
            })
          : Promise.resolve([] as { id: string; lessonId: string | null }[]),
      ]);

      // Tách "Giáo án" vs "Bài tập về nhà" theo loại Document: WORKSHEET = phiếu
      // bài tập; còn lại là giáo án/tư liệu buổi (parity cột bảng bản mock).
      const planByLesson = new Map<string, LessonDoc[]>();
      const worksheetByLesson = new Map<string, LessonDoc[]>();
      for (const d of docs) {
        if (!d.lessonId) continue;
        const target = d.type === "WORKSHEET" ? worksheetByLesson : planByLesson;
        const arr = target.get(d.lessonId) ?? [];
        arr.push({
          id: d.id,
          title: d.title,
          typeLabel: DOC_TYPE_LABEL[d.type] ?? d.type,
        });
        target.set(d.lessonId, arr);
      }
      const scormByLesson = new Map(scormPkgs.map((p) => [p.lessonId, p]));
      const sessionByLesson = new Map<string, string>();
      for (const s of sessions) {
        if (s.lessonId && !sessionByLesson.has(s.lessonId)) {
          sessionByLesson.set(s.lessonId, s.id);
        }
      }

      lessonRows = lessons.map((l) => {
        const pkg = scormByLesson.get(l.id) ?? null;
        return {
          id: l.id,
          order: l.order,
          title: l.title,
          planDocs: planByLesson.get(l.id) ?? [],
          worksheetDocs: worksheetByLesson.get(l.id) ?? [],
          homeworkText: (l.homeworkDefault ?? "").trim() || null,
          scorm: pkg
            ? {
                id: pkg.id,
                name: pkg.name,
                sessionId: sessionByLesson.get(l.id) ?? null,
              }
            : null,
        };
      });
    }

    return (
      <div className="space-y-4">
        <BackLink href="?" label="Tất cả khóa học" />
        <PageHeader
          title={`Tài liệu — ${course.name}`}
          subtitle={`${lessonRows.length} buổi học · mỗi buổi gồm giáo án PDF, giáo án SCORM và bài tập về nhà.`}
        />

        <div className="rounded-xl border border-border bg-primary-soft p-4">
          <div className="text-xs font-bold tracking-wider text-primary-ink uppercase">
            Khung chương trình
          </div>
          <div className="mt-1 flex items-center gap-2 text-lg font-bold text-foreground">
            <BookOpen className="h-5 w-5 text-primary-ink" aria-hidden />
            {curriculumName ?? "Chưa gán khung chương trình"}
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {course.name} · {lessonRows.length} buổi
          </div>
        </div>

        {!scormOn && (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Bài giảng tương tác (SCORM) đang tắt trên hệ thống — phần trình
            chiếu tạm ẩn. Tài liệu đính kèm vẫn xem được.
          </p>
        )}

        {lessonRows.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={
              curriculumName
                ? "Khung chương trình chưa có buổi học nào."
                : "Khoá chưa gán khung chương trình — liên hệ Đào tạo."
            }
          />
        ) : (
          <LessonTable rows={lessonRows} scormOn={scormOn} />
        )}
      </div>
    );
  }

  // ── (a) Bảng khoá GV dạy ─────────────────────────────────────────────────────
  const courses = myCourseIds.length
    ? await sdb.course.findMany({
        where: { id: { in: myCourseIds } },
        select: {
          id: true,
          name: true,
          shortDescription: true,
          description: true,
          totalSessions: true,
          curriculums: {
            where: { status: "ACTIVE" },
            orderBy: { version: "desc" },
            take: 1,
            select: {
              lessons: {
                where: { archivedAt: null },
                select: { id: true, homeworkDefault: true },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      })
    : [];

  // GIÁO ÁN = số tài liệu (Document) đính kèm các buổi — đếm gộp 1 lượt.
  const allLessonIds = courses.flatMap(
    (c) => c.curriculums[0]?.lessons.map((l) => l.id) ?? [],
  );
  const docCounts = allLessonIds.length
    ? await sdb.document.groupBy({
        by: ["lessonId"],
        where: { lessonId: { in: allLessonIds } },
        _count: { _all: true },
      })
    : [];
  const docByLesson = new Map(
    docCounts.map((d) => [d.lessonId, d._count._all]),
  );

  const rows: CourseMaterialRow[] = courses.map((c) => {
    const lessons = c.curriculums[0]?.lessons ?? [];
    const plans = lessons.reduce((n, l) => n + (docByLesson.get(l.id) ?? 0), 0);
    const homeworks = lessons.filter(
      (l) => (l.homeworkDefault ?? "").trim().length > 0,
    ).length;
    return {
      id: c.id,
      name: c.name,
      description: c.shortDescription ?? c.description ?? null,
      // "Buổi học" = số buổi trong khung CT (khớp trang chi tiết); fallback
      // totalSessions khi khoá chưa có khung CT active.
      sessions: lessons.length || c.totalSessions || 0,
      plans,
      homeworks,
    };
  });

  return (
    <div>
      <PageHeader
        title="Thư viện tài liệu"
        subtitle="Chọn một khóa học để xem toàn bộ giáo án theo buổi: giáo án PDF, giáo án SCORM và bài tập về nhà."
      />
      {classIds.length === 0 ? (
        <EmptyState icon={FileText} title="Bạn chưa được phân công lớp nào." />
      ) : (
        <CourseMaterialsList rows={rows} />
      )}
    </div>
  );
}

function NotYours() {
  return (
    <div className="space-y-4">
      <BackLink href="?" label="Thư viện tài liệu" />
      <EmptyState
        icon={FileText}
        title="Khoá không thuộc danh sách khoá bạn dạy."
      />
    </div>
  );
}
