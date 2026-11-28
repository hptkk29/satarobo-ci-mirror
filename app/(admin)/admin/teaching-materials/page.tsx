// app/(admin)/admin/teaching-materials/page.tsx — FL1-04 / US-LMS-3.
// Trang READ-ONLY cho GV: chọn lớp mình dạy → khung chương trình (Curriculum) →
// danh sách buổi (Lesson). Mỗi buổi: present tài liệu SCORM (tôn trọng SCORM_ENABLED)
// + bài tập của buổi + thống kê HS nộp bài (đánh giá cuối khoá). KHÔNG sửa LMS.
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Presentation,
  Play,
  NotebookPen,
  BookOpen,
  AlertCircle,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { getEffectiveRoles } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { isScormEnabled } from "@/lib/flags";
import { canManageTraining, isAssignedTeacher } from "@/lib/scorm/access";
import {
  shouldRestrictToOwnClasses,
  summarizeSubmissions,
  type SubmissionStatusLite,
} from "@/lib/teachers/materials";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Tài liệu lớp tôi | Admin" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ classId?: string }>;
}

export default async function TeachingMaterialsPage({
  searchParams,
}: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate quyền (layout admin đã chặn PARENT; check action ở page như quy ước).
  if (!(await checkPermission("teaching-materials:view-own-class")))
    redirect("/dashboard");

  const sp = await searchParams;
  const selectedClassId = sp.classId?.trim() || null;

  const actor = await resolveActor(session.user.id);
  // scopedDb ép cách ly cơ sở (CS1 không thấy CS2). Class là SCOPED_MODEL → auto-scope.
  const sdb = scopedDb(actor);

  // Plain TEACHER → chỉ lớp được giao (assignedClassIds); vai trò rộng hơn xem theo cơ sở.
  const roles = getEffectiveRoles(session.user);
  const restrict = shouldRestrictToOwnClasses(roles);
  const ownerWhere = restrict
    ? { id: { in: [...actor.assignedClassIds] } }
    : {};

  const classes = await sdb.class.findMany({
    where: { deletedAt: null, ...ownerWhere },
    orderBy: { name: "asc" },
    take: 300,
    select: { id: true, name: true, classCode: true },
  });

  // Lớp đang chọn — re-fetch qua cùng scope/owner-where để chống IDOR (GV truyền classId lạ).
  const selectedClass = selectedClassId
    ? await sdb.class.findFirst({
        where: { id: selectedClassId, deletedAt: null, ...ownerWhere },
        select: {
          id: true,
          name: true,
          classCode: true,
          courseId: true,
          curriculumId: true,
          teacherId: true,
          assistantId: true,
        },
      })
    : null;

  // ── Tải khung chương trình + buổi của lớp đã chọn ────────────────────────
  type LessonView = {
    id: string;
    order: number;
    title: string;
    objectives: string[];
    scorm: { id: string; name: string; kind: "SCORM" | "PDF" } | null;
    sessionId: string | null;
    canPresent: boolean;
    assignments: Array<{
      id: string;
      title: string;
      totalPoints: number;
      dueAt: Date | null;
      stats: ReturnType<typeof summarizeSubmissions>;
    }>;
  };

  let curriculumName: string | null = null;
  let lessonViews: LessonView[] = [];

  if (selectedClass) {
    // Khung CT của lớp: ưu tiên bản đã ghim (R7-06); lớp cũ chưa ghim → bản ACTIVE của khoá.
    const curriculum =
      (selectedClass.curriculumId
        ? await sdb.curriculum.findUnique({
            where: { id: selectedClass.curriculumId },
            select: {
              name: true,
              lessons: {
                where: { archivedAt: null },
                orderBy: { order: "asc" },
                select: {
                  id: true,
                  order: true,
                  title: true,
                  objectives: true,
                },
              },
            },
          })
        : null) ??
      (await sdb.curriculum.findFirst({
        where: { courseId: selectedClass.courseId, status: "ACTIVE" },
        orderBy: { version: "desc" },
        select: {
          name: true,
          lessons: {
            where: { archivedAt: null },
            orderBy: { order: "asc" },
            select: { id: true, order: true, title: true, objectives: true },
          },
        },
      }));

    curriculumName = curriculum?.name ?? null;
    const lessons = curriculum?.lessons ?? [];
    const lessonIds = lessons.map((l) => l.id);

    if (lessonIds.length > 0) {
      const scormOn = isScormEnabled();
      const [scormPkgs, sessions, assignments, enrolledCount] =
        await Promise.all([
          // Gói SCORM đang dùng (PUBLISHED + active) của các buổi — chỉ khi bật cờ.
          scormOn
            ? sdb.scormPackage.findMany({
                where: {
                  lessonId: { in: lessonIds },
                  isActiveForLesson: true,
                  status: "PUBLISHED",
                },
                select: { id: true, name: true, lessonId: true, kind: true },
              })
            : Promise.resolve(
                [] as {
                  id: string;
                  name: string;
                  lessonId: string;
                  kind: "SCORM" | "PDF";
                }[],
              ),
          // Buổi lớp gắn lesson → cấp sessionId cho player (gate canOpenScorm theo GV lớp).
          sdb.classSession.findMany({
            where: { classId: selectedClass.id, lessonId: { in: lessonIds } },
            orderBy: { date: "desc" },
            select: { id: true, lessonId: true },
          }),
          // Bài tập của lớp gắn theo buổi (đã giao: PUBLISHED/CLOSED) + trạng thái nộp.
          sdb.assignment.findMany({
            where: {
              classId: selectedClass.id,
              lessonId: { in: lessonIds },
              status: { in: ["PUBLISHED", "CLOSED"] },
            },
            orderBy: { assignedAt: "asc" },
            select: {
              id: true,
              title: true,
              totalPoints: true,
              dueAt: true,
              lessonId: true,
              submissions: { select: { status: true } },
            },
          }),
          // Sĩ số đang học (mẫu số thống kê nộp bài).
          sdb.enrollment.count({
            where: {
              classId: selectedClass.id,
              status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
            },
          }),
        ]);

      const scormByLesson = new Map(scormPkgs.map((p) => [p.lessonId, p]));
      const sessionByLesson = new Map<string, string>();
      for (const s of sessions) {
        if (s.lessonId && !sessionByLesson.has(s.lessonId)) {
          sessionByLesson.set(s.lessonId, s.id);
        }
      }
      const assignByLesson = new Map<string, typeof assignments>();
      for (const a of assignments) {
        if (!a.lessonId) continue;
        const arr = assignByLesson.get(a.lessonId) ?? [];
        arr.push(a);
        assignByLesson.set(a.lessonId, arr);
      }

      // GV được giao lớp này? (player chỉ mở cho GV phân công ∪ training:manage)
      const sessionShape = {
        actualTeacherId: null,
        class: {
          teacherId: selectedClass.teacherId,
          assistantId: selectedClass.assistantId,
        },
      };
      const teacherAssigned = isAssignedTeacher(actor, sessionShape);
      const canManage = canManageTraining(actor);

      lessonViews = lessons.map((l) => {
        const pkg = scormByLesson.get(l.id) ?? null;
        const sessionId = sessionByLesson.get(l.id) ?? null;
        // Present mở được khi: có giáo án + (Đào tạo/Admin) HOẶC (GV được phân công lớp này).
        // Không bắt buộc có ClassSession riêng cho buổi — GV xem được slide mọi buổi lớp mình.
        const canPresent = !!pkg && (canManage || teacherAssigned);
        return {
          id: l.id,
          order: l.order,
          title: l.title,
          objectives: l.objectives,
          scorm: pkg ? { id: pkg.id, name: pkg.name, kind: pkg.kind } : null,
          sessionId,
          canPresent,
          assignments: (assignByLesson.get(l.id) ?? []).map((a) => ({
            id: a.id,
            title: a.title,
            totalPoints: a.totalPoints,
            dueAt: a.dueAt,
            stats: summarizeSubmissions(
              a.submissions.map((s) => s.status as SubmissionStatusLite),
              enrolledCount,
            ),
          })),
        };
      });
    }
  }

  const scormOn = isScormEnabled();

  return (
    <div className="max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Presentation className="h-6 w-6 text-primary" /> Tài liệu lớp tôi
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Slide, bài tập và tình hình nộp bài theo từng buổi
        </p>
      </div>

      <PageHelp>
        <p>
          Chọn lớp bạn dạy → xem từng buổi: slide bài học (PDF hoặc SCORM) trình
          chiếu dạng slider, bài tập và thống kê học viên đã nộp. Chỉ xem &amp;
          trình chiếu — không chỉnh sửa.
        </p>
      </PageHelp>

      {/* Chọn lớp */}
      <form
        method="GET"
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <select
          name="classId"
          defaultValue={selectedClassId ?? ""}
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary sm:max-w-md"
        >
          <option value="">— Chọn lớp bạn dạy —</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.classCode ? ` (${c.classCode})` : ""}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          Mở
        </button>
      </form>

      {classes.length === 0 && (
        <p className="rounded-xl border border-state-warning-soft bg-state-warning-soft p-4 text-sm text-state-warning-ink">
          <AlertCircle className="mr-1 inline h-4 w-4" />
          Bạn chưa được phân công lớp nào.
        </p>
      )}

      {selectedClassId && !selectedClass && (
        <p className="rounded-xl border border-state-danger-soft bg-state-danger-soft p-4 text-sm text-state-danger-ink">
          Không tìm thấy lớp hoặc bạn không có quyền xem lớp này.
        </p>
      )}

      {selectedClass && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-primary-soft p-4">
            <div className="text-xs font-bold uppercase tracking-wider text-primary">
              Khung chương trình
            </div>
            <div className="mt-1 flex items-center gap-2 text-lg font-bold text-foreground">
              <BookOpen className="h-5 w-5 text-primary" />
              {curriculumName ?? "Chưa gán khung chương trình"}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {selectedClass.name}
              {selectedClass.classCode
                ? ` · ${selectedClass.classCode}`
                : ""} · {lessonViews.length} buổi
            </div>
          </div>

          {!scormOn && (
            <p className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
              Tài liệu giảng dạy tương tác (SCORM) đang tắt trên hệ thống — phần
              trình chiếu tạm ẩn. Bài tập &amp; thống kê vẫn xem được.
            </p>
          )}

          {lessonViews.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              Khung chương trình chưa có buổi học nào.
            </p>
          ) : (
            <ul className="space-y-3">
              {lessonViews.map((l) => (
                <li
                  key={l.id}
                  className="space-y-3 rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground">
                        Buổi {l.order}: {l.title}
                      </div>
                      {l.objectives.length > 0 && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {l.objectives.join(" · ")}
                        </p>
                      )}
                    </div>

                    {/* Present SCORM (read-only) */}
                    {scormOn && l.scorm ? (
                      l.canPresent ? (
                        <Link
                          href={
                            l.sessionId
                              ? `/admin/scorm/play/${l.scorm.id}?sessionId=${l.sessionId}`
                              : `/admin/scorm/play/${l.scorm.id}`
                          }
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary-soft px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary-soft"
                        >
                          <Play className="h-3.5 w-3.5" /> Xem slide
                        </Link>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground">
                          <Play className="h-3.5 w-3.5" /> {l.scorm.name}
                        </span>
                      )
                    ) : scormOn ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Chưa có slide bài học
                      </span>
                    ) : null}
                  </div>

                  {/* Bài tập của buổi + thống kê nộp */}
                  {l.assignments.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-border">
                      <PhanTrangBang cuonNgang>
                        <table className="w-full text-sm">
                          <thead className="bg-muted text-xs text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">
                                <NotebookPen className="mr-1 inline h-3.5 w-3.5" />
                                Bài tập
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                Đã nộp
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                Đã chấm
                              </th>
                              <th className="px-3 py-2 text-right font-medium">
                                Chưa nộp
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {l.assignments.map((a) => (
                              <tr key={a.id}>
                                <td className="px-3 py-2">
                                  <div className="font-medium text-foreground">
                                    {a.title}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {a.totalPoints} điểm
                                    {a.dueAt
                                      ? ` · hạn ${new Intl.DateTimeFormat(
                                          "vi-VN",
                                          {
                                            dateStyle: "short",
                                          },
                                        ).format(a.dueAt)}`
                                      : ""}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-foreground">
                                  {a.stats.submitted}/{a.stats.total}
                                  {a.stats.late > 0 && (
                                    <span className="ml-1 text-xs text-state-warning-ink">
                                      ({a.stats.late} muộn)
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-state-success-ink">
                                  {a.stats.graded}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                  {a.stats.notSubmitted}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </PhanTrangBang>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Buổi này chưa có bài tập.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
