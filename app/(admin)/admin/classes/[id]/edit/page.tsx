import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb, getModelVisibleCenterIds } from "@/lib/db-scope";
import { getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import { getSelectableOrgUnits } from "@/lib/org/org-service";
import { getAssignableTeachers } from "@/lib/teachers/assignable";
import { ClassForm, type ClassFormValue } from "../../_components/class-form";
import { ClassApprovalActions } from "../_components/class-approval-actions";
import { ClassCancel } from "../_components/class-cancel";
import { ClassComplete } from "../_components/class-complete";
import {
  CLASS_CLOSE_ENROLLMENT_STATUSES,
  splitEnrollmentsForCompletion,
} from "@/lib/classes/complete-class";
import { ClassReschedule } from "../_components/class-reschedule";
import { ClassCurriculum } from "../_components/class-curriculum";
import type { PhaseFormValue } from "@/lib/classes/phase-form";
import { loadClassPhases } from "@/lib/classes/phases-service";
import { vnAddDays, vnStartOfDay, vnYmd } from "@/lib/time/vn";
import { ClassSessionsManage } from "../_components/class-sessions-manage";
import { buildSessionNumberMap, soBuoiTheoLoTrinh } from "@/lib/lms/session-order";
import { isSessionLifecycleV2Enabled, isClassGroupEnabled } from "@/lib/flags";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function EditClassPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const actor = await resolveActor(session.user.id);
  const hoCenterIds = await getNonEnrollableCenterIds();

  const hasEdit = await checkPermission("classes:edit");
  const hasViewAll = await checkPermission("classes:view-all");
  const hasViewOwn = await checkPermission("classes:view-own");

  if (!hasEdit && !hasViewAll && !hasViewOwn) {
    redirect("/dashboard?error=unauthorized");
  }

  const sdb = scopedDb(actor);
  // Cờ GỠ "Nhóm lớp" (mặc định OFF từ 20/08) — ô biến mất thì danh sách nhóm cũng thừa,
  // bỏ luôn 1 query. Bật cờ lại là truy vấn chạy như cũ, không cần revert code.
  const classGroupEnabled = isClassGroupEnabled();
  const [cls, courses, orgUnits, classGroups, rooms] =
    await Promise.all([
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
      },
    }),
    sdb.course.findMany({
      where: { isActive: true, isTeachable: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true, code: true, slug: true }, // T3.4 — code/slug để gợi ý tên lớp
    }),
    // Lớp CHỈ mở ở cơ sở dạy học — Hội sở không nằm trong danh sách (chốt 04/08).
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

  // IDOR check for view-own scope: must be assigned teacher or assistant
  if (!hasEdit && !hasViewAll && hasViewOwn) {
    if (cls.teacherId !== session.user.id && cls.assistantId !== session.user.id) {
      redirect("/dashboard?error=unauthorized");
    }
  }

  // R7-06 — dữ liệu cho tab "Chương trình" + "Quản lý buổi học".
  // Fix #9 — `teachers` = GV có thể phân lớp + LUÔN kèm GV/trợ giảng đang gán cho lớp
  // này (kể cả khi họ được gán từ trang Giáo viên và không còn match điều kiện lọc)
  // để <Select> không tự rớt giá trị đang chọn → gốc của bug "Lớp học hiện trống".
  // Scope GHI per-model của Class (vá 24/07) — dùng cho CẢ picker GV lẫn picker
  // "Đơn vị" bên dưới: actor kiểu Toại (TRAINING@HO + CM@CS1) hết bày GV CS2.
  const classCenters = getModelVisibleCenterIds("Class", actor);
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
        // Cùng lý do với trang chi tiết lớp: `status` không phản ánh việc GV đã điểm
        // danh/nhận xét hay chưa, phải đếm thật thì danh sách buổi mới nói được sự thật.
        _count: { select: { attendances: true, studentFeedbacks: true } },
        // Đợt 1c — nguồn số LỘ TRÌNH, cùng lý do với trang chi tiết lớp.
        plan: { select: { order: true } },
        lesson: { select: { order: true } },
      },
    }),
    sdb.curriculum.findMany({
      where: { courseId: cls.courseId, isActive: true, status: "ACTIVE" },
      orderBy: { version: "desc" },
      select: { version: true, name: true },
    }),
    // R2-RBAC-3 + vá 24/07 — GV theo scope per-model của Class ("ALL" → như cũ theo
    // visibleCenterIds) + LUÔN kèm GV/TA đang gán (includeIds) để <Select> không rớt
    // value; form lọc tiếp theo đơn vị đang chọn ở client.
    // 06/08 - GV la nguon luc chung (Hoi so dieu di moi co so): KHONG loc danh
    // sach theo co so nua, neu khong CS2 khong bao gio toi duoc form va bo loc
    // phia client co mo cung vo nghia.
    getAssignableTeachers({ includeIds: [cls.teacherId, cls.assistantId] }),
  ]);

  const lessonIds = plans
    .map((p) => p.lessonId)
    .filter((id): id is string => Boolean(id));
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

  // R1 21/08 — số buổi. Query trên KHÔNG có `take` nên `sessions` đã là toàn bộ buổi của
  // lớp, đúng điều kiện của buildSessionNumberMap (xem lib/lms/session-order).
  const sessionNumberOf = buildSessionNumberMap(sessions);
  const sessionRows = sessions.map((s) => ({
    id: s.id,
    date: s.date.toISOString(),
    topic: s.topic,
    status: s.status,
    // HAI con số, đừng trộn — xem ghi chú ở `app/(admin)/admin/classes/[id]/page.tsx`.
    seq: sessionNumberOf.get(s.id) ?? null,
    soLoTrinh: soBuoiTheoLoTrinh({
      planOrder: s.plan?.order ?? null,
      lessonOrder: s.lesson?.order ?? null,
    }),
    attendanceCount: s._count.attendances,
    feedbackCount: s._count.studentFeedbacks,
  }));

  const teacherOptions = teachers.map((t) => ({
    id: t.id,
    label: t.name ?? "(chưa đặt tên)",
  }));
  const roomOptions = rooms
    .filter((r) => !cls.centerId || r.centerId === cls.centerId)
    .map((r) => ({ id: r.id, label: `${r.code} — ${r.name}` }));

  const canEdit = await checkPermission("classes:edit", { centerId: cls.centerId });
  // QA 21/07 (B4) — ghi danh còn thuộc lớp, dùng cho CẢ HAI hộp xác nhận:
  //   · Hủy lớp  → tổng số em sẽ bị rút về WITHDREW;
  //   · Hoàn thành lớp → chia em nào chuyển được / em nào bỏ qua và vì sao.
  // Lấy status thay vì đếm trần để phép chia ở màn dùng ĐÚNG hàm mà Server Action
  // dùng (`splitEnrollmentsForCompletion`) — hai nơi tự đếm lấy là đường ngắn nhất
  // tới cảnh "hộp thoại hứa 12 em, DB đổi 9 em".
  const liveEnrollments = await sdb.enrollment.findMany({
    where: {
      classId: cls.id,
      deletedAt: null,
      status: { in: CLASS_CLOSE_ENROLLMENT_STATUSES },
    },
    select: { status: true },
  });
  const liveEnrollmentCount = liveEnrollments.length;
  const completionSplit = splitEnrollmentsForCompletion(liveEnrollments);
  const canApproveClass =
    actor.isSuperAdmin ||
    (actor.orgRoles.some((r) => r.roleCode === "CENTER_MANAGER") &&
      (await checkPermission("classes:edit", { centerId: cls.centerId })));

  // Kế hoạch lịch học — lớp chưa lập thì hiện giai đoạn SUY từ lịch hiện tại (isDerived).
  const loadedPhases = await loadClassPhases(cls.id);
  const phaseForm: PhaseFormValue[] = (loadedPhases?.phases ?? []).map((p) => ({
    from: vnYmd(p.effectiveFrom),
    to: p.effectiveTo ? vnYmd(p.effectiveTo) : "",
    note: p.note ?? "",
    days: Object.fromEntries(
      p.slots.map((s) => [s.weekday, { start: s.startTime, end: s.endTime ?? "" }]),
    ),
  }));
  const defaultApplyFrom = vnYmd(vnAddDays(vnStartOfDay(new Date()), 1));
  const phaseSignature = `${loadedPhases?.isDerived ? "d" : "s"}:${JSON.stringify(phaseForm)}`;

  // Picker "Đơn vị" theo scope GHI của Class (đối xứng guard updateClass — vá 24/07):
  // role HO không có quyền classes:* không được mời chuyển lớp sang cơ sở ngoài scope.
  const orgUnitsInScope =
    classCenters === "ALL"
      ? orgUnits
      : orgUnits.filter((o) => o.centerId != null && classCenters.includes(o.centerId));

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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-3xl font-black text-foreground">
          Sửa lớp: <span className="font-bold text-primary">{cls.name}</span>
        </h1>
        <div className="flex flex-wrap gap-2">
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
            📊 Tiến độ lớp
          </Link>
        </div>
      </div>

      <div className="mb-6">
        <ClassApprovalActions
          classId={cls.id}
          status={cls.status}
          canSubmit={actor.orgRoles.some(r => ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"].includes(r.roleCode))}
          canApprove={canApproveClass}
          approvedByName={cls.approvedByName}
        />
      </div>

      <div className="mb-6">
        <ClassReschedule classId={cls.id} canEdit={canEdit} />
      </div>

      {/* 08/08 — Kế hoạch lịch học nay nằm TRONG <ClassForm> ở cuối trang (chỗ cũ của
          "Lịch học trong tuần"), giống màn tab /classes/[id]. Một nơi sửa lịch, không hai. */}

      <div className="mb-6">
        <ClassCurriculum
          classId={cls.id}
          pinnedVersion={cls.curriculumVersion}
          plans={planRows}
          versions={curricula}
          canEdit={canEdit}
        />
      </div>

      <div className="mb-6">
        <ClassSessionsManage
          sessions={sessionRows}
          teachers={teacherOptions}
          rooms={roomOptions}
          canEdit={canEdit}
          lifecycleV2={isSessionLifecycleV2Enabled()}
        />
      </div>

      <div className="mb-6">
        <ClassComplete
          classId={cls.id}
          className={cls.name}
          status={cls.status}
          completableCount={completionSplit.eligible.length}
          skipped={completionSplit.skipped}
          canEdit={canEdit}
        />
      </div>

      <div className="mb-6">
        <ClassCancel
          classId={cls.id}
          className={cls.name}
          status={cls.status}
          liveEnrollmentCount={liveEnrollmentCount}
          canEdit={canEdit}
        />
      </div>

      <ClassForm
        hoCenterIds={hoCenterIds}
        cls={formValue}
        courses={courses}
        canEdit={canEdit}
        schedulePhases={phaseForm}
        phasesDerived={loadedPhases?.isDerived ?? true}
        phaseSignature={phaseSignature}
        defaultApplyFrom={defaultApplyFrom}
        orgUnits={orgUnitsInScope.map((o) => ({
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
    </div>
  );
}
