import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { isSessionLifecycleV2Enabled, isClassGroupEnabled } from "@/lib/flags";
import { resolveClassSlots } from "@/lib/classes/slots";
import { pickDefaultSession } from "@/lib/classes/default-session";
import { buildSessionNumberMap, soBuoiTheoLoTrinh } from "@/lib/lms/session-order";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ClassForm, type ClassFormValue } from "../_components/class-form";
import { ClassApprovalActions } from "./_components/class-approval-actions";
import { ClassReschedule } from "./_components/class-reschedule";
import { ClassComplete } from "./_components/class-complete";
import {
  CLASS_CLOSE_ENROLLMENT_STATUSES,
  splitEnrollmentsForCompletion,
} from "@/lib/classes/complete-class";
import { ClassCurriculum } from "./_components/class-curriculum";
import type { PhaseFormValue } from "@/lib/classes/phase-form";
import { loadClassPhases, loadHolidayKeys } from "@/lib/classes/phases-service";
import { auditSessionSeries } from "@/lib/classes/session-audit";
import { vnAddDays, vnEndOfDay, vnStartOfDay, vnYmd } from "@/lib/time/vn";
import { ClassSessionsManage } from "./_components/class-sessions-manage";
import { ClassAttendancePanel } from "./_components/class-attendance-panel";
import { buildSessionAttendanceRows } from "@/lib/attendance/roster";
import { MediaClient } from "../../media/_components/media-client";
import { ClassEvalPanel } from "./_components/class-eval-panel";
import { ClassFeedbackPanel } from "./_components/class-feedback-panel";
import { loadClassSessionFeedback } from "@/lib/classes/session-feedback-data";
import {
  loadClassMediaItems,
  loadClassScormSessions,
} from "@/lib/classes/detail-tabs-data";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { isScormEnabled } from "@/lib/flags";
import { canManageTraining } from "@/lib/scorm/access";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

const WEEKDAY_LABEL: Record<number, string> = {
  0: "CN",
  1: "T2",
  2: "T3",
  3: "T4",
  4: "T5",
  5: "T6",
  6: "T7",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: "Đang lên KH", cls: "bg-muted text-foreground" },
  RECRUITING: { label: "Tuyển sinh", cls: "bg-state-info-soft text-state-info-ink" },
  PENDING_APPROVAL: { label: "Chờ duyệt", cls: "bg-state-warning-soft text-state-warning-ink" },
  ACTIVE: { label: "Đang dạy", cls: "bg-state-success-soft text-state-success-ink" },
  COMPLETED: { label: "Hoàn thành", cls: "bg-primary-soft text-primary" },
  CANCELLED: { label: "Huỷ", cls: "bg-state-danger-soft text-state-danger-ink" },
};

/**
 * R2-CLASS-1/4 — Trang chi tiết lớp ĐA-TAB: gộp Thông tin · Chương trình ·
 * Buổi học (+ Điểm danh) · Ảnh · Học bù · Tài liệu SCORM · Đánh giá vào 1 nơi,
 * thay vì 4 trang rời (sidebar đã ẩn ở W0). Header gọn 1 card (R2-CLASS-4).
 * Route cũ /sessions /attendance /media /hoc-bu GIỮ tới khi trang này ổn định.
 */
export default async function ClassDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const actor = await resolveActor(session.user.id);
  const hoCenterIds = await getNonEnrollableCenterIds();

  const hasEdit = await checkPermission("classes:edit");
  const hasViewAll = await checkPermission("classes:view-all");
  const hasViewOwn = await checkPermission("classes:view-own");
  // 18/08 — Đào tạo vào được trang lớp CHỈ để đọc nhận xét buổi (không có classes:*).
  const hasFeedbackView = await checkPermission("session-feedback:view-all");
  if (!hasEdit && !hasViewAll && !hasViewOwn && !hasFeedbackView) {
    redirect("/dashboard?error=unauthorized");
  }
  // Ai chỉ có quyền đọc nhận xét thì KHÔNG thấy form sửa lớp / lịch / điểm danh —
  // trang mở đúng một tab. Tách biến ở đây để mọi tab bên dưới dùng chung một luật.
  const canSeeClassBasics = hasEdit || hasViewAll || hasViewOwn;

  const sdb = scopedDb(actor);
  // Cờ GỠ "Nhóm lớp" (mặc định OFF từ 20/08) — ô biến mất thì danh sách nhóm cũng thừa,
  // bỏ luôn 1 query. Bật cờ lại là truy vấn chạy như cũ, không cần revert code.
  const classGroupEnabled = isClassGroupEnabled();
  const [cls, courses, orgUnits, classGroups, rooms] = await Promise.all([
    sdb.class.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        classCode: true,
        name: true,
        description: true,
        courseId: true,
        centerId: true,
        orgUnitId: true,
        classGroupId: true,
        roomId: true,
        teacherId: true,
        assistantId: true,
        startDate: true,
        endDate: true,
        scheduleDays: true,
        startTime: true,
        endTime: true,
        // BGĐ 31/07 — giờ riêng theo thứ (lớp 2 ca khác giờ).
        scheduleSlots: {
          select: { weekday: true, startTime: true, endTime: true },
          orderBy: { weekday: "asc" },
        },
        maxStudents: true,
        minStudents: true,
        status: true,
        notes: true,
        approvedByName: true,
        curriculumVersion: true,
        course: { select: { name: true } },
        // Sĩ số = HV ĐANG thuộc lớp. Thiếu lọc status thì WITHDREW/CANCELLED/COMPLETED
        // vẫn được đếm — lệch với cột sĩ số ở /admin/classes (classes/page.tsx) và làm
        // HV đã nghỉ/đã xoá vẫn kê lên đầu trang lớp (sự cố 07/08).
        _count: {
          select: {
            enrollments: {
              where: {
                status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
                deletedAt: null,
                student: { deletedAt: null },
              },
            },
          },
        },
      },
    }),
    sdb.course.findMany({
      where: { isActive: true, isTeachable: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true, code: true, slug: true }, // T3.4 — code/slug để gợi ý tên lớp
    }),
    // Hội sở KHÔNG nhận lớp (chốt 04/08) — picker chỉ liệt kê cơ sở dạy học.
    getSelectableOrgUnits(actor, { types: ["CENTER"] }),
    classGroupEnabled
      ? sdb.classGroup.findMany({
          where: { deletedAt: null, status: "ACTIVE" },
          orderBy: { displayCode: "asc" },
          select: { id: true, displayCode: true, name: true, centerId: true },
        })
      : Promise.resolve([]),
    sdb.room.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ centerId: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, centerId: true },
    }),
  ]);

  if (!cls) notFound();

  // IDOR view-own: chỉ GV/TA của lớp mới xem được khi chỉ có quyền view-own.
  if (!hasEdit && !hasViewAll && hasViewOwn) {
    if (cls.teacherId !== session.user.id && cls.assistantId !== session.user.id) {
      redirect("/dashboard?error=unauthorized");
    }
  }

  const [plans, sessions, curricula, teachers] = await Promise.all([
    sdb.classSessionPlan.findMany({
      where: { classId: cls.id },
      orderBy: { order: "asc" },
      select: { id: true, seq: true, order: true, customTitle: true, note: true, lessonId: true },
    }),
    sdb.classSession.findMany({
      where: { classId: cls.id },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        topic: true,
        status: true,
        // 19/08 — ĐẾM sẵn điểm danh + phiếu nhận xét theo buổi. Không có 2 con số này thì
        // cả trang lớp không có MỘT chỗ nào cho biết buổi nào GV đã làm: danh sách buổi chỉ
        // in `status` (mà status KHÔNG đổi khi điểm danh — chỉ completeSession mới đổi, và
        // nó nằm sau cờ SESSION_LIFECYCLE_V2 đang OFF), dropdown chọn buổi chỉ in ngày.
        // Đó là thứ đã làm quản lý kết luận "GV chưa điểm danh" trong khi dữ liệu vẫn còn.
        _count: { select: { attendances: true, studentFeedbacks: true } },
        // Đợt 1c — nguồn số LỘ TRÌNH (bài thứ mấy của giáo trình). `seq` bên dưới là
        // hạng theo NGÀY; hai con số này KHÁC nhau ở lớp có buổi dời ngày, và chính
        // chỗ nhập nhằng đó đẻ ra sự cố "lệch tên bài".
        plan: { select: { order: true } },
        lesson: { select: { order: true } },
      },
    }),
    sdb.curriculum.findMany({
      where: { courseId: cls.courseId, isActive: true, status: "ACTIVE" },
      orderBy: { version: "desc" },
      select: { version: true, name: true },
    }),
    // R2-RBAC-3 — GV cùng cơ sở + LUÔN kèm GV/TA đang gán (giữ <Select> value).
    // 06/08 - GV la nguon luc chung (Hoi so dieu di moi co so): KHONG loc danh
    // sach theo co so nua, neu khong CS2 khong bao gio toi duoc form va bo loc
    // phia client co mo cung vo nghia.
    getAssignableTeachers({ includeIds: [cls.teacherId, cls.assistantId] }),
  ]);

  const lessonIds = plans
    .map((p) => p.lessonId)
    .filter((x): x is string => Boolean(x));
  const lessons = lessonIds.length
    ? await sdb.lesson.findMany({
        where: { id: { in: lessonIds } },
        select: { id: true, title: true },
      })
    : [];
  const lessonTitleById = new Map(lessons.map((l) => [l.id, l.title]));

  const planRows = plans.map((p) => ({
    id: p.id,
    seq: p.seq,
    order: p.order,
    customTitle: p.customTitle,
    note: p.note,
    lessonTitle: p.lessonId ? lessonTitleById.get(p.lessonId) ?? null : null,
  }));

  // R1 21/08 — số buổi. `sessions` ở trên KHÔNG bị `take` nên đã là toàn bộ buổi của lớp,
  // đúng điều kiện của buildSessionNumberMap. Nếu sau này thêm `take` vào query đó thì
  // PHẢI nạp riêng danh sách id+date đầy đủ, kẻo số buổi lệch.
  const sessionNumberOf = buildSessionNumberMap(sessions);
  const sessionRows = sessions.map((s) => ({
    id: s.id,
    date: s.date.toISOString(),
    topic: s.topic,
    status: s.status,
    // ⚠️ HAI con số, đừng trộn:
    //   `seq`        — buổi thứ mấy tính theo NGÀY (dùng để khớp thứ tự danh sách);
    //   `soLoTrinh`  — BÀI thứ mấy của giáo trình (dùng để nói về nội dung dạy).
    // Lớp `CS2.SATA6.26.001` có buổi 25/06 với seq = 2 mà soLoTrinh = 43.
    seq: sessionNumberOf.get(s.id) ?? null,
    soLoTrinh: soBuoiTheoLoTrinh({
      planOrder: s.plan?.order ?? null,
      lessonOrder: s.lesson?.order ?? null,
    }),
    attendanceCount: s._count.attendances,
    feedbackCount: s._count.studentFeedbacks,
  }));

  // Tab điểm danh: buổi mặc định = buổi GẦN NHẤT ĐÃ DIỄN RA (tính cả hôm nay), chưa huỷ.
  //
  // ⚠️ ĐỪNG đổi lại thành "buổi sắp tới" — đó là bug 19/08 (quản lý báo "GV điểm danh rồi mà
  // admin không thấy"). Điểm danh luôn NHÌN VỀ QUÁ KHỨ: buổi sắp tới theo định nghĩa chưa ai
  // điểm danh (site GV còn chặn cứng điểm danh buổi tương lai — teacher/lop/_actions.ts), nên
  // mở sẵn buổi đó là bày ra một lưới trắng và mọi người đọc thành "mất dữ liệu". Đo trên
  // DB dev/test lúc phát hiện: 16/18 lớp có điểm danh thì buổi mặc định cũ có 0 dòng.
  // Fallback cuối là buổi đầu tiên — lớp chưa khai giảng thì không có buổi quá khứ nào.
  // Luật nằm ở lib/classes/default-session.ts (có test hồi quy) — sửa ở đó, không sửa ở đây.
  // Roster render server-side (RSC) để panel khỏi useEffect-fetch lúc mount.
  const defaultSession = pickDefaultSession(sessions, vnEndOfDay(new Date()));
  // Roster kèm SĐT học viên — chỉ dựng khi thực sự render tab Buổi & Điểm danh.
  const initialRoster =
    defaultSession && canSeeClassBasics
      ? await buildSessionAttendanceRows(actor, defaultSession.id)
      : { rows: [] };

  const teacherOptions = teachers.map((t) => ({
    id: t.id,
    label: t.name ?? "(chưa đặt tên)",
  }));
  const roomOptions = rooms
    .filter((r) => !cls.centerId || r.centerId === cls.centerId)
    .map((r) => ({ id: r.id, label: `${r.code} — ${r.name}` }));

  const canEdit = await checkPermission("classes:edit", { centerId: cls.centerId });
  // Ghi danh còn thuộc lớp → hộp xác nhận "Hoàn thành lớp" nói trước con số sẽ đổi.
  // Dùng chung `splitEnrollmentsForCompletion` với `completeClassAction` để màn và
  // lượt ghi không bao giờ đếm khác nhau.
  const liveEnrollmentStatuses = canEdit
    ? await sdb.enrollment.findMany({
        where: {
          classId: cls.id,
          deletedAt: null,
          status: { in: CLASS_CLOSE_ENROLLMENT_STATUSES },
        },
        select: { status: true },
      })
    : [];
  const completionSplit = splitEnrollmentsForCompletion(liveEnrollmentStatuses);
  const canApproveClass =
    actor.isSuperAdmin ||
    (actor.orgRoles.some((r) => r.roleCode === "CENTER_MANAGER") &&
      (await checkPermission("classes:edit", { centerId: cls.centerId })));
  const lifecycleV2 = isSessionLifecycleV2Enabled();

  // Tab Ảnh — gate quyền. (Tab "Học bù" đã GỠ 29/09/2026: luồng "xếp vào buổi lớp khác" bị
  // thay bằng màn /hoc-bu đời mới — docs/hoc-bu/DAC-TA.md.)
  const canViewMedia =
    (await checkPermission("media:view")) || (await checkPermission("media:upload"));
  const canApproveMedia = await checkPermission("media:approve");

  // Tab SCORM (R2-CLASS-5) — chỉ GV phân công lớp này hoặc QL đào tạo, và flag ON
  // (route /scorm/play tự gate lại canOpenScorm). Tab Đánh giá (R2-CLASS-7) — GV của
  // lớp hoặc người có quyền sửa lớp; gateFill server-side vẫn chốt cuối.
  const isOwnerTeacher =
    cls.teacherId === session.user.id || cls.assistantId === session.user.id;
  const canViewScorm = isScormEnabled() && (canManageTraining(actor) || isOwnerTeacher);
  const canEval = canEdit || isOwnerTeacher;
  // Nhận xét buổi (StudentSessionFeedback) — CHỈ ĐỌC. GV của lớp cũng xem được cả lớp
  // ở đây (họ vốn là người viết); GV lớp khác đã bị chặn ở kiểm tra IDOR view-own trên.
  const canViewFeedback = hasFeedbackView || canEdit || isOwnerTeacher;

  const [mediaItems, scormSessions, feedbackData] = await Promise.all([
    canViewMedia ? loadClassMediaItems(cls.id, cls.name) : Promise.resolve([]),
    canViewScorm ? loadClassScormSessions(cls.id) : Promise.resolve([]),
    // Tải có điều kiện: <TabsContent> render server-side kể cả khi tab chưa mở, nên
    // không gác thì mọi lượt mở trang lớp đều gánh toàn bộ phiếu nhận xét.
    canViewFeedback ? loadClassSessionFeedback(cls.id) : Promise.resolve(null),
  ]);

  // Kế hoạch lịch học (nay nằm trong tab "Thông tin", chỗ cũ của "Lịch học trong tuần"):
  // lớp chưa lập kế hoạch thì hiện GIAI ĐOẠN SUY từ lịch hiện tại (isDerived) — sửa xong
  // bấm Lưu là chốt, không cần backfill dữ liệu cũ.
  const loadedPhases = await loadClassPhases(cls.id);
  const phaseForm: PhaseFormValue[] = (loadedPhases?.phases ?? []).map((p) => ({
    from: vnYmd(p.effectiveFrom),
    to: p.effectiveTo ? vnYmd(p.effectiveTo) : "",
    note: p.note ?? "",
    days: Object.fromEntries(
      p.slots.map((s) => [s.weekday, { start: s.startTime, end: s.endTime ?? "" }]),
    ),
  }));
  // Mặc định áp dụng từ NGÀY MAI — không đụng buổi hôm nay (có thể đang dạy).
  const defaultApplyFrom = vnYmd(vnAddDays(vnStartOfDay(new Date()), 1));
  // Chữ ký kế hoạch: state của form lịch chỉ khởi tạo 1 lần, không có key thì sau
  // `router.refresh()` form vẫn giữ bản cũ và banner "chưa lưu kế hoạch" vẫn hiện dù đã lưu.
  const phaseSignature = `${loadedPhases?.isDerived ? "d" : "s"}:${JSON.stringify(phaseForm)}`;

  // 08/08 — SOÁT dãy buổi có khớp "ngày khai giảng + lịch học" không. Trước đây lệch là
  // lệch âm thầm: `endDate` được tính lại theo lịch mới còn `ClassSession` giữ dãy cũ,
  // không màn nào đối chiếu hai thứ đó với nhau.
  const sessionAudit = auditSessionSeries({
    from: cls.startDate ? vnStartOfDay(cls.startDate) : null,
    phases: loadedPhases?.phases ?? [],
    holidays: await loadHolidayKeys(cls.centerId),
    sessions,
    classStatus: cls.status,
  });

  // Nhóm chat của lớp (nếu đã sinh) — chỉ lấy `id`, một truy vấn khoá duy nhất.
  // Đi qua `sdb` chứ không `db` trần — luật ESLint của repo cấm import `@/lib/db` trong
  // app/(admin). An toàn: `Conversation` nằm trong SCOPE_EXEMPT nên scopedDb không lọc nó
  // (DM có centerId = null, đưa vào diện scoped là hiểu sai thành "không thuộc cơ sở nào").
  const chatConversationId = (
    await sdb.conversation.findUnique({
      where: {
        type_subjectType_subjectId: {
          type: "CLASS_GROUP",
          subjectType: "CLASS",
          subjectId: cls.id,
        },
      },
      select: { id: true },
    })
  )?.id;

  // DS học viên buổi mặc định cho tab Đánh giá (present = đã điểm danh có mặt/muộn).
  const initialEvalStudents = initialRoster.rows.map((r) => ({
    studentId: r.studentId,
    name: r.studentName,
    present: r.existing?.status === "PRESENT" || r.existing?.status === "LATE",
  }));

  const formValue: ClassFormValue = {
    id: cls.id,
    classCode: cls.classCode,
    name: cls.name,
    description: cls.description,
    courseId: cls.courseId,
    orgUnitId: cls.orgUnitId,
    classGroupId: cls.classGroupId,
    roomId: cls.roomId,
    teacherId: cls.teacherId,
    assistantId: cls.assistantId,
    startDate: cls.startDate,
    endDate: cls.endDate,
    scheduleDays: cls.scheduleDays ?? [],
    startTime: cls.startTime,
    endTime: cls.endTime,
    scheduleSlots: cls.scheduleSlots ?? [],
    maxStudents: cls.maxStudents,
    minStudents: cls.minStudents,
    status: cls.status,
    notes: cls.notes,
  };

  const teacherName =
    teachers.find((t) => t.id === cls.teacherId)?.name ?? null;
  const badge = STATUS_BADGE[cls.status] ?? STATUS_BADGE.PLANNED;
  // BGĐ 31/07 — hiển thị lịch kèm giờ CỦA TỪNG THỨ (lớp 2 ca khác giờ).
  const effectiveSlots = resolveClassSlots({
    scheduleDays: cls.scheduleDays ?? [],
    startTime: cls.startTime,
    endTime: cls.endTime,
    slots: cls.scheduleSlots,
  });
  const scheduleLabel = effectiveSlots
    .map((s) => {
      const day = WEEKDAY_LABEL[s.weekday] ?? s.weekday;
      return s.startTime ? `${day} ${s.startTime}` : `${day}`;
    })
    .join(" · ");
  // Có ca lệch giờ → ô "Giờ" chung không còn ý nghĩa, ghi rõ "theo từng thứ".
  const hasPerDayTimes = new Set(effectiveSlots.map((s) => s.startTime)).size > 1;

  return (
    <div className="space-y-6">
      {/* 24/09 — lối quay lại danh sách. Trỏ `/classes` TRẦN là cố ý: màn danh sách tự
          khôi phục bộ lọc + trang đang xem đã nhớ (class-filters.tsx), nên không mất lọc. */}
      <Link
        href="/classes"
        className="-mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Danh sách lớp
      </Link>
      {/* R2-CLASS-4 — header gọn 1 card */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black text-foreground">{cls.name}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${badge.cls}`}>
                {badge.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {cls.classCode ? <span className="font-mono">{cls.classCode}</span> : "—"}
              {cls.course?.name ? <> · {cls.course.name}</> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Hai màn con này gác bằng quyền lớp/học viên riêng — người chỉ đọc nhận
                xét bấm vào sẽ bị đá về dashboard, nên đừng bày nút cho họ. */}
            {canSeeClassBasics && (
              <>
                <Link
                  href={`/classes/${cls.id}/students`}
                  className="inline-flex items-center gap-1 rounded-lg border border-primary-soft bg-card px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft"
                >
                  👥 Học sinh
                </Link>
                <Link
                  href={`/classes/${cls.id}/progress`}
                  className="inline-flex items-center gap-1 rounded-lg border border-primary-soft bg-card px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary-soft"
                >
                  📊 Tiến độ
                </Link>
              </>
            )}
            {/* Lối tắt sang nhóm chat của lớp (yêu cầu chủ dự án 10/08): từ trang lớp
                bấm thẳng sang chỗ nhắn tin / gửi thông báo cho phụ huynh, không phải đi
                vòng qua màn Tin nhắn rồi dò tên lớp trong danh sách.
                Nhóm chỉ tồn tại khi lớp đã ACTIVE (BR-01) nên nút chỉ hiện khi CÓ nhóm —
                nút dẫn tới hư vô còn tệ hơn không có nút. */}
            {chatConversationId && canSeeClassBasics && (
              <Link
                href={`/admin/tin-nhan?c=${chatConversationId}`}
                className="inline-flex items-center gap-1 rounded-lg border border-state-info-soft bg-card px-3 py-1.5 text-sm font-semibold text-state-info-ink hover:bg-state-info-soft"
              >
                💬 Nhắn nhóm lớp
              </Link>
            )}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <HeaderItem label="Lịch học" value={scheduleLabel || "—"} />
          <HeaderItem
            label="Giờ"
            value={
              hasPerDayTimes
                ? "Theo từng thứ"
                : cls.startTime
                  ? `${cls.startTime}${cls.endTime ? `–${cls.endTime}` : ""}`
                  : "—"
            }
          />
          <HeaderItem label="GV chính" value={teacherName ?? "Chưa phân"} />
          <HeaderItem label="Sĩ số" value={`${cls._count.enrollments}/${cls.maxStudents}`} />
        </dl>
      </div>

      <Tabs defaultValue={canSeeClassBasics ? "info" : "eval"} className="w-full">
        <TabsList variant="line" className="flex-wrap">
          {canSeeClassBasics && (
            <>
              <TabsTrigger value="info">Thông tin</TabsTrigger>
              <TabsTrigger value="curriculum">Chương trình</TabsTrigger>
              {/* 08/08 — tab "Kế hoạch lịch học" đã chuyển vào tab Thông tin, đúng chỗ cũ của
                  "Lịch học trong tuần" (một màn một việc: lịch lớp chỉ có MỘT nơi để sửa). */}
              <TabsTrigger value="sessions">Buổi & Điểm danh</TabsTrigger>
            </>
          )}
          {canViewMedia && <TabsTrigger value="media">Ảnh lớp</TabsTrigger>}
          {canViewScorm && <TabsTrigger value="scorm">Tài liệu SCORM</TabsTrigger>}
          {/* Đổi tên từ "Đánh giá": tab này trước chỉ có phiếu KHẢO SÁT theo đợt, nên
              người dùng mở ra tìm nhận xét buổi học thì gặp "chưa có phiếu nào đang mở"
              và tưởng là mất dữ liệu (báo lỗi 18/08). Nay hai thứ nằm chung, có nhãn. */}
          {(canViewFeedback || canEval) && (
            <TabsTrigger value="eval">Đánh giá &amp; Nhận xét</TabsTrigger>
          )}
        </TabsList>

        {canSeeClassBasics && (
          <>
        <TabsContent value="info" className="space-y-6 pt-4">
          <ClassApprovalActions
            classId={cls.id}
            status={cls.status}
            canSubmit={actor.orgRoles.some((r) =>
              ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"].includes(r.roleCode),
            )}
            canApprove={canApproveClass}
            approvedByName={cls.approvedByName}
          />
          <ClassComplete
            classId={cls.id}
            className={cls.name}
            status={cls.status}
            completableCount={completionSplit.eligible.length}
            skipped={completionSplit.skipped}
            canEdit={canEdit}
          />
          <ClassReschedule
            classId={cls.id}
            canEdit={canEdit}
            audit={{ severity: sessionAudit.severity, message: sessionAudit.message }}
          />
          <ClassForm
            hoCenterIds={hoCenterIds}
            cls={formValue}
            courses={courses}
            canEdit={canEdit}
            schedulePhases={phaseForm}
            phasesDerived={loadedPhases?.isDerived ?? true}
            phaseSignature={phaseSignature}
            defaultApplyFrom={defaultApplyFrom}
            orgUnits={orgUnits.map((o) => ({
              id: o.orgUnitId,
              name: o.name,
              centerId: o.centerId,
            }))}
            classGroups={classGroups}
            classGroupEnabled={classGroupEnabled}
            rooms={rooms}
            teachers={teachers.map((t) => ({
              id: t.id,
              name: t.name ?? "(chưa đặt tên)",
              role: t.role,
              centerId: t.centerId,
            }))}
          />
        </TabsContent>

        <TabsContent value="curriculum" className="pt-4">
          <ClassCurriculum
            classId={cls.id}
            pinnedVersion={cls.curriculumVersion}
            plans={planRows}
            versions={curricula}
            canEdit={canEdit}
          />
        </TabsContent>

        <TabsContent value="sessions" className="space-y-8 pt-4">
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
              Buổi học
            </h2>
            <ClassSessionsManage
              sessions={sessionRows}
              teachers={teacherOptions}
              rooms={roomOptions}
              canEdit={canEdit}
              lifecycleV2={lifecycleV2}
            />
          </section>
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-foreground">
              Điểm danh
            </h2>
            <ClassAttendancePanel
              sessions={sessionRows}
              initialSessionId={defaultSession?.id ?? null}
              initialRows={initialRoster.rows}
            />
          </section>
        </TabsContent>
          </>
        )}

        {canViewMedia && (
          <TabsContent value="media" className="pt-4">
            <MediaClient
              items={mediaItems}
              classes={[{ id: cls.id, label: cls.classCode ? `${cls.classCode} · ${cls.name}` : cls.name }]}
              canApprove={canApproveMedia}
              currentUserId={session.user.id}
            />
          </TabsContent>
        )}

        {canViewScorm && (
          <TabsContent value="scorm" className="pt-4">
            <p className="mb-3 text-sm text-muted-foreground">
              Mở/present tài liệu SCORM của bài giảng theo từng buổi. Mỗi lần mở cấp vé
              10 phút + watermark (truy vết).
            </p>
            {scormSessions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                Lớp chưa có buổi học gắn bài giảng.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {scormSessions.map((s) => (
                  <li key={s.sessionId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="text-sm">
                      <span className="font-medium text-foreground">
                        {new Date(s.date).toLocaleDateString("vi-VN", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </span>
                      {s.lessonTitle ? <span className="text-muted-foreground"> · {s.lessonTitle}</span> : null}
                      {s.topic ? <span className="text-muted-foreground"> · {s.topic}</span> : null}
                    </div>
                    {s.scorm ? (
                      <Link
                        href={`/scorm/play/${s.scorm.id}?sessionId=${s.sessionId}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                      >
                        ▶ Mở giảng
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">Chưa có SCORM</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        )}

        {(canViewFeedback || canEval) && (
          <TabsContent value="eval" className="space-y-8 pt-4">
            {canViewFeedback && feedbackData && (
              <section>
                <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-foreground">
                  Nhận xét buổi học (phiếu giáo viên)
                </h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  Toàn bộ phiếu nhận xét giáo viên đã viết cho từng học viên qua từng
                  buổi — cùng nội dung phụ huynh đang xem ở cổng phụ huynh.
                </p>
                <ClassFeedbackPanel data={feedbackData} />
              </section>
            )}
            {canEval && (
              <section>
                <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-foreground">
                  Phiếu khảo sát theo đợt
                </h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  Phiếu SESSION_EVAL do quản trị mở theo đợt ở mục Đánh giá &amp; Khảo
                  sát — khác với nhận xét buổi phía trên.
                </p>
                <ClassEvalPanel
                  sessions={sessionRows}
                  initialSessionId={defaultSession?.id ?? null}
                  initialStudents={initialEvalStudents}
                  canEdit={canEval}
                />
              </section>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function HeaderItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}
