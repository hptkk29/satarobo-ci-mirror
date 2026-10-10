import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, CalendarDays } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { SessionFeedbackEditor } from "./_components/session-feedback-editor";
import { SessionChecklist } from "./_components/session-checklist";
import { canManageSessionClass } from "./_actions";
import { checkPermission } from "@/lib/auth/check-permission";
import { SessionEvalCard } from "@/components/admin/session-eval-card";
import { parseFeedbackNotes, parseFeedbackRubric } from "@/lib/lms/session-eval-rubric";
import { buildSessionNumberMap, sessionNumberLabel } from "@/lib/lms/session-order";
import { resolveDisplayProjectName } from "@/lib/lms/session-project-name";
import { getPreSessionInfo } from "@/lib/lms/pre-session";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { BookOpen, Users, AlertTriangle, FileWarning } from "lucide-react";

export const metadata = { title: "Chi tiết buổi học | Admin" };
export const dynamic = "force-dynamic";

const PRESENT_STATUSES = new Set(["PRESENT", "LATE"]);

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SessionDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;

  // Nhóm 01 L1 — ClassSession ∈ SCOPED_MODELS: sdb.findUnique lọc hậu kỳ theo
  // record.centerId → select PHẢI kèm centerId. Buổi ngoài tầm nhìn cơ sở → 404
  // (học bù liên cơ sở đi qua lib/makeup + trang điểm danh, không qua trang này).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const sess = await sdb.classSession.findUnique({
    where: { id },
    select: {
      id: true,
      centerId: true,
      date: true,
      topic: true,
      notes: true,
      lessonId: true,
      status: true,
      ckClean: true,
      ckEquipment: true,
      ckKit: true,
      ckLessonConfirmed: true,
      ckMedia: true,
      ckHomework: true,
      ckIncident: true,
      incidentNote: true,
      lessonNotes: true,
      plan: { select: { customTitle: true, order: true } },
      lesson: { select: { title: true, order: true, moduleCode: true } },
      class: {
        select: {
          id: true,
          name: true,
          classCode: true,
          centerId: true,
          teacherId: true,
          assistantId: true,
          startTime: true,
          endTime: true,
          center: { select: { name: true } },
          room: { select: { code: true } },
          course: { select: { name: true } },
          teacher: { select: { name: true } },
        },
      },
      attendances: { select: { studentId: true, status: true } },
      // 18/08 — TRƯỚC ĐÂY chỉ lấy comment+rating nên phiếu rubric-only (comment = null)
      // hiện ra ô trống ở admin, dù phụ huynh vẫn đọc được đủ. Lấy luôn phần mở rộng.
      studentFeedbacks: {
        select: {
          studentId: true,
          comment: true,
          rating: true,
          projectName: true,
          notes: true,
          rubric: true,
          createdById: true,
        },
      },
    },
  });
  if (!sess) notFound();

  const canEdit = await canManageSessionClass(
    { id: session.user.id, role: session.user.role, centerId: session.user.centerId },
    sess.class,
  );
  // Đào tạo: CHỈ ĐỌC phiếu nhận xét (không quản buổi) — để link "Mở buổi" từ trang lớp
  // không dẫn tới ngõ cụt.
  const canViewFeedback = await checkPermission("session-feedback:view-all");
  // 19/08 — điều kiện cũ có thêm `&& !hasRole(session.user, "HR")`, tức ĐẢO ĐÚNG Ý ĐỊNH
  // đã ghi ở chính comment của nó ("HR ... chặn hẳn nếu không quản lý được"): với người
  // mang vai HR thì mệnh đề luôn false ⇒ KHÔNG redirect ⇒ HR đọc được toàn bộ phiếu nhận
  // xét của mọi buổi, trong khi seed cố ý KHÔNG cấp `session-feedback:view-all` cho HR.
  // Không ai được vào đây bằng "vai gì" cả — chỉ bằng quyền quản buổi hoặc quyền đọc phiếu.
  if (!canEdit && !canViewFeedback) {
    redirect("/sessions");
  }

  // 19/08 — lọc xoá mềm cho KHỚP roster mà server dùng để kiểm khi lưu
  // (getSessionRosterStudentIds). Thiếu 2 điều kiện này thì màn hình bày ra học viên đã
  // xoá, và mọi lượt lưu có họ bị từ chối TRỌN LÔ với "Có học viên không thuộc danh sách".
  const enrollments = await sdb.enrollment.findMany({
    where: {
      classId: sess.class.id,
      status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
      deletedAt: null,
      student: { deletedAt: null },
    },
    select: { student: { select: { id: true, name: true } } },
    orderBy: { student: { name: "asc" } },
  });

  const presentSet = new Set(
    sess.attendances.filter((a) => PRESENT_STATUSES.has(a.status)).map((a) => a.studentId),
  );
  const fbMap = new Map(sess.studentFeedbacks.map((f) => [f.studentId, f]));
  // FIX #6 — tick "đã nhận xét" phải KHỚP deriveSteps (_actions.ts): tính theo SỰ TỒN TẠI
  // phiếu (mọi HS present có row StudentSessionFeedback) — phiếu rubric-only (comment
  // null) vẫn là ĐÃ nhận xét. So "comment ≠ rỗng" như cũ làm tick lệch với server.
  const fbStudentIds = new Set(sess.studentFeedbacks.map((f) => f.studentId));
  const ckFeedbackDerived =
    presentSet.size > 0 && [...presentSet].every((id) => fbStudentIds.has(id));

  const studentRows = enrollments.map((e) => {
    const fb = fbMap.get(e.student.id);
    return {
      studentId: e.student.id,
      name: e.student.name,
      present: presentSet.has(e.student.id),
      comment: fb?.comment ?? "",
      rating: fb?.rating ?? null,
    };
  });

  // Phiếu ĐẦY ĐỦ để đọc (dự án + 4 mục văn xuôi + rubric 9 tiêu chí). Editor bên dưới
  // chỉ sửa được comment/sao nên bản thân nó không hiện hết nội dung phiếu.
  // `User` ∈ SCOPE_EXEMPT → sdb.user là pass-through; một truy vấn gộp, không N+1.
  const authorIds = [...new Set(sess.studentFeedbacks.map((f) => f.createdById))];
  const authors = authorIds.length
    ? await sdb.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
    : [];
  const authorName = new Map(authors.map((u) => [u.id, u.name]));
  const nameByStudent = new Map(enrollments.map((e) => [e.student.id, e.student.name]));

  // R1 21/08 — "buổi thứ mấy" của lớp. Tính trên TOÀN BỘ buổi của lớp (lib/lms/session-order),
  // để trang này, trang lớp và site GV cùng gọi một buổi bằng cùng một số.
  // 26/08 — DỜI LÊN TRƯỚC `feedbackCards`: thẻ nhận xét cần số buổi để suy tên dự án.
  const sessionNo =
    buildSessionNumberMap(
      await sdb.classSession.findMany({
        where: { classId: sess.class.id },
        select: { id: true, date: true },
      }),
    ).get(sess.id) ?? null;

  // 26/08 — tên dự án của BUỔI, dùng chung cho mọi phiếu; không đọc bản sao đông cứng
  // theo từng học viên (xem resolveDisplayProjectName).
  const projectSrc = {
    sessionNumber: sessionNo,
    planTitle: sess.plan?.customTitle,
    planOrder: sess.plan?.order,
    lessonTitle: sess.lesson?.title,
    lessonOrder: sess.lesson?.order,
    moduleCode: sess.lesson?.moduleCode,
    topic: sess.topic,
  };

  const feedbackCards = sess.studentFeedbacks
    .map((f) => ({
      studentId: f.studentId,
      // Phiếu của HV học bù / đã rời lớp không có trong roster active — vẫn phải hiện.
      studentName: nameByStudent.get(f.studentId) ?? "Học viên ngoài sĩ số",
      data: {
        projectName: resolveDisplayProjectName(projectSrc, f.projectName),
        notes: parseFeedbackNotes(f.notes),
        rubric: parseFeedbackRubric(f.rubric),
        comment: f.comment ?? "",
        rating: f.rating,
        teacherName: authorName.get(f.createdById) ?? null,
      },
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, "vi"));

  const dateStr = new Date(sess.date).toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  // LMS-4 — thông tin chuẩn bị (chỉ khi buổi chưa hoàn tất).
  const pre = sess.status !== "COMPLETED" ? await getPreSessionInfo(sess.id) : null;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/sessions" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Danh sách buổi học
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <CalendarDays className="h-6 w-6 text-primary" />
          {sess.class.classCode ? `${sess.class.classCode} · ` : ""}{sess.class.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {sessionNo ? `${sessionNumberLabel(sessionNo)} · ` : ""}
          {dateStr}
          {sess.class.startTime && sess.class.endTime ? ` · ${sess.class.startTime}–${sess.class.endTime}` : ""}
          {sess.class.center?.name ? ` · ${sess.class.center.name}` : ""}
          {sess.class.room?.code ? ` · P.${sess.class.room.code}` : ""}
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Info label="Khoá" value={sess.class.course.name} />
          <Info label="GV chính" value={sess.class.teacher?.name ?? "—"} />
          <Info label="Bài học" value={sess.lesson ? `Bài ${sess.lesson.order}: ${sess.lesson.title}` : (sess.topic ?? "—")} />
        </dl>
        {sess.notes && <p className="mt-3 text-sm text-muted-foreground">Ghi chú: {sess.notes}</p>}
      </section>

      {/* LMS-4 — chuẩn bị trước buổi học */}
      {pre && (
        <section className="rounded-xl border border-state-info-soft bg-state-info-soft/40 p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-state-info-ink">
            Chuẩn bị trước buổi học
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-state-info-soft bg-card p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <BookOpen className="h-4 w-4" /> BÀI DỰ KIẾN
              </div>
              {pre.expectedLesson ? (
                <>
                  <p className="text-sm font-semibold text-foreground">
                    Bài {pre.expectedLesson.order}: {pre.expectedLesson.title}
                    {pre.expectedIsSuggested && (
                      <span className="ml-1 text-xs font-normal text-state-info-ink">(gợi ý)</span>
                    )}
                  </p>
                  {pre.expectedLesson.materials.length > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Thiết bị: {pre.expectedLesson.materials.join(", ")}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Chưa có giáo trình cho khoá.</p>
              )}
            </div>

            <div className="rounded-lg border border-state-info-soft bg-card p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <Users className="h-4 w-4" /> HỌC SINH ({pre.students.length})
              </div>
              <p className="text-sm text-foreground">
                {pre.students.map((s) => s.name).join(", ") || "—"}
              </p>
            </div>

            <div className="rounded-lg border border-state-warning-soft bg-card p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-state-warning-ink">
                <AlertTriangle className="h-4 w-4" /> CẦN LƯU Ý
              </div>
              {pre.studentsToNote.length === 0 ? (
                <p className="text-sm text-muted-foreground">Không có.</p>
              ) : (
                <ul className="space-y-0.5 text-sm text-foreground">
                  {pre.studentsToNote.map((s) => (
                    <li key={s.id}>
                      <span className="font-medium">{s.name}</span> — {s.reasons.join("; ")}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-state-danger-soft bg-card p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-state-danger-ink">
                <FileWarning className="h-4 w-4" /> BÀI TẬP CHƯA CHẤM ({pre.ungraded.length})
              </div>
              {pre.ungraded.length === 0 ? (
                <p className="text-sm text-muted-foreground">Đã chấm hết.</p>
              ) : (
                <ul className="space-y-0.5 text-sm text-foreground">
                  {pre.ungraded.slice(0, 8).map((u, i) => (
                    <li key={i}>
                      {u.studentName} · <span className="text-muted-foreground">{u.assignmentTitle}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/* LMS-3 — checklist sau buổi */}
      <SessionChecklist
        sessionId={sess.id}
        status={sess.status}
        lessonLinked={!!sess.lessonId}
        derived={{
          ckAttendance: sess.attendances.length > 0,
          ckFeedback: ckFeedbackDerived,
        }}
        stored={{
          ckClean: sess.ckClean,
          ckEquipment: sess.ckEquipment,
          ckKit: sess.ckKit,
          ckLessonConfirmed: sess.ckLessonConfirmed,
          ckMedia: sess.ckMedia,
          ckHomework: sess.ckHomework,
          ckIncident: sess.ckIncident,
          incidentNote: sess.incidentNote ?? "",
          lessonNotes: sess.lessonNotes ?? "",
        }}
        canEdit={canEdit}
      />

      {/* Phiếu nhận xét ĐÃ LƯU của buổi — chỉ đọc, hiện đủ nội dung giáo viên đã viết. */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Phiếu nhận xét đã lưu ({feedbackCards.length})
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Cùng nội dung phụ huynh đang xem ở cổng phụ huynh.
        </p>
        {feedbackCards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Buổi này chưa có phiếu nhận xét nào.
          </p>
        ) : (
          <div className="space-y-3">
            {feedbackCards.map((c) => (
              <SessionEvalCard key={c.studentId} title={c.studentName} data={c.data} />
            ))}
          </div>
        )}
      </section>

      {/* LMS-2 — nhận xét từng học sinh (nhập/sửa) */}
      {canEdit && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Nhận xét từng học sinh
          </h2>
          <SessionFeedbackEditor sessionId={sess.id} students={studentRows} canEdit={canEdit} />
        </section>
      )}
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
