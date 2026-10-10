"use server";

import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma, EnrollmentStatus } from "@prisma/client";
import { hasAnyRole, type Action } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import { centerIdForOrgUnit, orgUnitIdForCenter } from "@/lib/org/org-service";
import { rejectHeadOffice, getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import { classCreateSchema } from "@/lib/validators/class";
import { teacherCenterAssignmentError } from "@/lib/teachers/center-filter";
import {
  logClassAudit,
  detectChangedFields,
  getAuditActor,
} from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { canTransition } from "@/lib/enrollments/status";
import { genClassCode } from "@/lib/codegen";
import { computeSessionDates, expandHolidaySet } from "@/lib/classes/schedule";
import { resolveClassSlots, applySlotTimeToDate } from "@/lib/classes/slots";
import {
  flatScheduleAtStart,
  phaseInputsToDomain,
  sortPhases,
  validatePhases,
  WEEKDAY_LABELS,
  type SchedulePhase,
} from "@/lib/classes/phases";
import { loadClassPhases, persistPhases } from "@/lib/classes/phases-service";
import type { SchedulePhaseInput } from "@/lib/classes/phase-form";
import { vnAddDays, vnEndOfDay, vnStartOfDay, vnWeekday, vnYmd } from "@/lib/time/vn";
import { suggestClassEndDate } from "@/lib/classes/end-date";
import { generateClassSessions } from "@/lib/classes/generate";
import { auditClassSessions, resyncClassSessions } from "@/lib/classes/session-sync";
import { detectBatchConflicts } from "@/lib/lms/schedule-conflict";
import { courseHasActiveCurriculum } from "@/lib/courses/activation-guard";
import { createSessionPlansForClass } from "@/lib/classes/snapshot";
import { generateAssignmentsFromTemplates } from "@/lib/lms/assignment";
import { publishEvent } from "@/lib/events/publish";
import { createRefundRequest } from "@/lib/finance/refund";
import { completeCourse } from "@/lib/completion/service";
import {
  CLASS_CLOSE_ENROLLMENT_STATUSES,
  splitEnrollmentsForCompletion,
  type SkippedGroup,
} from "@/lib/classes/complete-class";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { formatDateVN } from "@/lib/format/date";
import { syncConversationMembership } from "@/lib/chat/sync-membership";

type ActionResult = { error?: string; warning?: string };

// Cách ly cơ sở (chống IDOR ghi): Class ∈ SCOPED_MODELS. Mutation theo classId từ
// client phải xác minh lớp thuộc tầm nhìn cơ sở của actor trước khi ghi.
// GHI đối xứng với ĐỌC (vá 24/07): scope per-model qua passesScope — role HO chỉ
// cross-center khi CÓ quyền classes:* (Toại TRAINING@HO không còn → hết tạo/chuyển
// lớp CS2). Lớp HO (centerId null) đòi scope ALL. KHÔNG dùng cờ isHoLevel trần.
function actorCanUseCenter(actor: Actor, centerId: string | null): boolean {
  return passesScope("Class", { centerId }, actor);
}
/** Lớp `classId` có thuộc tầm nhìn cơ sở actor không (đọc centerId rồi passesScope). */
async function classInScope(actor: Actor, classId: string): Promise<boolean> {
  const sdb = scopedDb(actor);
  const cls = await sdb.class.findUnique({ where: { id: classId }, select: { centerId: true } });
  return !!cls && passesScope("Class", cls, actor);
}
/**
 * R2-RBAC-3 — GV chính/trợ giảng phải thuộc CÙNG cơ sở với lớp (cách ly CS1↔CS2).
 * Guard server-side (defense-in-depth) chống IDOR: lọc client ở form là chưa đủ vì
 * client có thể POST thẳng teacherId của cơ sở khác. Lớp HO/không cơ sở (centerId
 * null) → không ràng buộc. Backfill User.centerId GV = 100% (R2-RBAC-1) nên GV null
 * center = không hợp lệ cho lớp có cơ sở. Trả message lỗi hoặc null nếu OK.
 */
async function assertTeachersInCenter(
  sdb: ReturnType<typeof scopedDb>,
  centerId: string | null,
  teacherId?: string | null,
  assistantId?: string | null,
): Promise<string | null> {
  if (!centerId) return null;
  const ids = [teacherId, assistantId].filter(Boolean) as string[];
  if (!ids.length) return null;
  const users = await sdb.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, centerId: true },
  });
  const byId = new Map(users.map((u) => [u.id, u.centerId]));
  // teacherCenterAssignmentError so từng id với centerId lớp (undefined nếu GV không
  // tồn tại → cũng bị chặn). Logic thuần, test ở lib/teachers/center-filter.test.ts.
  // GV thuộc Hội sở là nguồn lực chung, điều đi dạy mọi cơ sở (chốt 06/08).
  // Nhận diện HO qua cây OrgUnit, KHÔNG hardcode mã.
  const hoCenterIds = await getNonEnrollableCenterIds();
  return teacherCenterAssignmentError(
    centerId,
    ids.map((id) => ({ id, centerId: byId.get(id) })),
    hoCenterIds,
  );
}

async function requireClassWrite(action: "create" | "update" | "delete") {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const actionMap: Record<typeof action, Action> = {
    create: "classes:create",
    update: "classes:edit",
    delete: "classes:delete",
  };

  if (!(await checkPermission(actionMap[action]))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

function toCreateData(
  parsed: ReturnType<typeof classCreateSchema.parse>,
  classCode: string | null,
  centerId: string | null,
  orgUnitId: string | null,
): Prisma.ClassCreateInput {
  const {
    courseId,
    centerId: _ignoredCenter,
    orgUnitId: _ignoredOrg,
    classGroupId,
    roomId,
    teacherId,
    assistantId,
    classCode: _ignoredCode,
    ...rest
  } = parsed;
  void _ignoredCode;
  void _ignoredCenter;
  void _ignoredOrg;

  return {
    ...rest,
    classCode,
    // PR-C dual-write: orgUnitId nguồn chính, centerId suy ra (HO→null).
    orgUnitId,
    course: { connect: { id: courseId } },
    ...(centerId ? { center: { connect: { id: centerId } } } : {}),
    ...(classGroupId ? { classGroup: { connect: { id: classGroupId } } } : {}),
    ...(roomId ? { room: { connect: { id: roomId } } } : {}),
    ...(teacherId ? { teacher: { connect: { id: teacherId } } } : {}),
    ...(assistantId ? { assistant: { connect: { id: assistantId } } } : {}),
  };
}

function toUpdateData(
  parsed: ReturnType<typeof classCreateSchema.parse>,
  centerId: string | null,
  orgUnitId: string | null,
  /**
   * `omitSchedule` — form không mang lịch theo (màn sửa lớp: lịch do khối "Kế hoạch lịch
   * học" quản). Phải BỎ HẲN 3 khoá lịch khỏi payload: để nguyên là ghi giá trị mặc định
   * của schema (`[]` / `null`) đè lên lịch thật.
   */
  opts: { omitSchedule?: boolean } = {},
): Prisma.ClassUpdateInput {
  const {
    courseId,
    centerId: _ignoredCenter,
    orgUnitId: _ignoredOrg,
    classGroupId,
    roomId,
    teacherId,
    assistantId,
    scheduleDays,
    startTime,
    endTime,
    ...rest
  } = parsed;
  void _ignoredCenter;
  void _ignoredOrg;

  return {
    ...rest,
    ...(opts.omitSchedule ? {} : { scheduleDays, startTime, endTime }),
    // PR-C dual-write: orgUnitId nguồn chính, centerId suy ra (HO→null).
    orgUnitId,
    course: { connect: { id: courseId } },
    center: centerId ? { connect: { id: centerId } } : { disconnect: true },
    classGroup: classGroupId
      ? { connect: { id: classGroupId } }
      : { disconnect: true },
    room: roomId ? { connect: { id: roomId } } : { disconnect: true },
    teacher: teacherId ? { connect: { id: teacherId } } : { disconnect: true },
    assistant: assistantId
      ? { connect: { id: assistantId } }
      : { disconnect: true },
  };
}

/**
 * PR-C: từ input form (orgUnitId là picker) suy ra { centerId, orgUnitId } để dual-write.
 * Nếu gán nhóm lớp → kế thừa đơn vị (center + org) của nhóm (Phase T0.2).
 */
async function resolveClassOrg(
  data: ReturnType<typeof classCreateSchema.parse>,
  sdb: ReturnType<typeof scopedDb>,
): Promise<{ centerId: string | null; orgUnitId: string | null }> {
  // orgUnitId nay BẮT BUỘC ở form, nhưng nhánh kế thừa nhóm lớp bên dưới có thể suy
  // ra null → khai rõ kiểu nullable, đừng để suy ra `string` rồi vỡ.
  let orgUnitId: string | null = data.orgUnitId ?? null;
  let centerId = await centerIdForOrgUnit(orgUnitId);

  if (data.classGroupId) {
    const group = await sdb.classGroup.findUnique({
      where: { id: data.classGroupId },
      select: { centerId: true, orgUnitId: true },
    });
    if (group) {
      centerId = group.centerId;
      orgUnitId = group.orgUnitId ?? (await orgUnitIdForCenter(group.centerId));
    }
  }
  return { centerId, orgUnitId };
}

/**
 * BGĐ 31/07 — đọc giờ riêng theo thứ từ form (JSON ở field `scheduleSlots`).
 * Dữ liệu hỏng → [] (lớp dùng giờ chung như trước, không chặn lưu).
 */
function readScheduleSlots(
  formData: FormData,
  scheduleDays: number[],
): { weekday: number; startTime: string; endTime: string | null }[] {
  const raw = formData.get("scheduleSlots");
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const allowed = new Set(scheduleDays);
  const seen = new Set<number>();
  const out: { weekday: number; startTime: string; endTime: string | null }[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as { weekday?: unknown; startTime?: unknown; endTime?: unknown };
    const weekday = typeof o.weekday === "number" ? o.weekday : NaN;
    const startTime = typeof o.startTime === "string" ? o.startTime.trim() : "";
    // Chỉ nhận thứ ĐANG học + giờ hợp lệ + không trùng thứ (unique classId+weekday).
    if (!Number.isInteger(weekday) || !allowed.has(weekday) || seen.has(weekday)) continue;
    if (!/^\d{2}:\d{2}$/.test(startTime)) continue;
    const endRaw = typeof o.endTime === "string" ? o.endTime.trim() : "";
    seen.add(weekday);
    out.push({
      weekday,
      startTime,
      endTime: /^\d{2}:\d{2}$/.test(endRaw) ? endRaw : null,
    });
  }
  return out;
}

/**
 * 08/08 — LỊCH LỚP GỬI TỪ FORM = KẾ HOẠCH NHIỀU GIAI ĐOẠN (field `schedulePhases`, JSON).
 *
 * Ba trạng thái, đừng gộp:
 *   • `provided: false` — form KHÔNG mang lịch theo (màn sửa lớp: khối "Kế hoạch lịch học"
 *     tự lưu riêng). Server phải GIỮ NGUYÊN lịch đang có, tuyệt đối không ghi đè bằng
 *     giá trị mặc định của schema (`scheduleDays: []`, `startTime: null`) — làm thế là
 *     xoá lịch của lớp mà không ai bấm gì.
 *   • `provided: true` + `error` — kế hoạch sai → CHẶN, nói rõ sai ở giai đoạn nào.
 *   • `provided: true` + `phases` — dùng làm nguồn ghi.
 *
 * Đường nhập Excel/API cũ vẫn gửi `scheduleDays`/`startTime` phẳng: không có
 * `schedulePhases` thì nhánh cũ chạy y như trước.
 */
function readSchedulePhases(
  formData: FormData,
): { provided: false } | { provided: true; error: string } | { provided: true; phases: SchedulePhase[] } {
  const raw = formData.get("schedulePhases");
  if (typeof raw !== "string") return { provided: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { provided: true, error: "Kế hoạch lịch học không đọc được — tải lại trang rồi nhập lại." };
  }
  if (!Array.isArray(parsed)) {
    return { provided: true, error: "Kế hoạch lịch học không hợp lệ." };
  }

  const mapped = phaseInputsToDomain(parsed as SchedulePhaseInput[]);
  if (!mapped.ok) return { provided: true, error: mapped.error };

  const errors = validatePhases(mapped.phases);
  if (errors.length > 0) return { provided: true, error: errors.join(" ") };

  return { provided: true, phases: mapped.phases };
}

/** Chữ ký so sánh 2 kế hoạch — đổi thật mới xếp lại buổi, không xếp lại vì bấm Lưu. */
function phaseSignature(phases: readonly SchedulePhase[]): string {
  return sortPhases(phases)
    .map(
      (p) =>
        `${vnYmd(p.effectiveFrom)}..${p.effectiveTo ? vnYmd(p.effectiveTo) : ""}#` +
        [...p.slots]
          .sort((a, b) => a.weekday - b.weekday)
          .map((s) => `${WEEKDAY_LABELS[s.weekday] ?? s.weekday}|${s.startTime}|${s.endTime ?? ""}`)
          .join(","),
    )
    .join(";");
}

function readForm(formData: FormData) {
  const scheduleDaysRaw = formData.getAll("scheduleDays");
  const scheduleDays = scheduleDaysRaw
    .map((v) => (typeof v === "string" ? parseInt(v, 10) : NaN))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);

  function s(name: string): string | undefined {
    const v = formData.get(name);
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }

  return {
    name: s("name") ?? "",
    classCode: s("classCode"),
    description: s("description"),

    courseId: s("courseId") ?? "",
    orgUnitId: s("orgUnitId"),
    classGroupId: s("classGroupId"),
    roomId: s("roomId"),
    teacherId: s("teacherId"),
    assistantId: s("assistantId"),

    startDate: s("startDate"),
    endDate: s("endDate"),
    scheduleDays,
    startTime: s("startTime"),
    endTime: s("endTime"),

    maxStudents: s("maxStudents") ?? 20,
    minStudents: s("minStudents") ?? 5,

    status: s("status") ?? "PLANNED",
    notes: s("notes"),
    schedule: s("schedule"),
  };
}

const CLASS_SNAPSHOT_SELECT = {
  name: true,
  classCode: true,
  courseId: true,
  centerId: true,
  roomId: true,
  teacherId: true,
  assistantId: true,
  status: true,
  startDate: true,
  endDate: true,
  maxStudents: true,
} as const;

/**
 * Chủ dự án chốt 04/08: KHÔNG CÓ LỚP HỌC TẠI HỘI SỞ. HO là cơ quan đầu não, không
 * phải địa điểm dạy học — lớp chỉ mở ở CS1/CS2 (và cơ sở mở sau).
 *
 * Chặn ở SERVER chứ không chỉ giấu khỏi dropdown: form có thể bị POST thẳng, và
 * lớp lỡ nằm ở HO thì kéo theo học viên + điểm danh + học phí sai cơ sở.
 * Nhận diện qua cây OrgUnit (type=CENTER), KHÔNG hardcode mã "HO".
 */
async function rejectHeadOfficeCenter(centerId: string | null): Promise<string | null> {
  return rejectHeadOffice("lớp học", { centerId });
}

export async function createClass(formData: FormData): Promise<ActionResult> {
  const session = await requireClassWrite("create");

  const raw = readForm(formData);
  const parsed = classCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const { actorId, actorName } = getAuditActor(session);

  // 08/08 — form tạo lớp gửi KẾ HOẠCH LỊCH; lịch phẳng (`scheduleDays`/giờ/slot) là bản
  // sao suy ra từ đó. Đường nhập cũ (Excel/API) không gửi kế hoạch → nhánh phẳng như trước.
  const plan = readSchedulePhases(formData);
  if (plan.provided && "error" in plan) return { error: plan.error };
  const planPhases = plan.provided && "phases" in plan ? plan.phases : null;

  const flat = planPhases
    ? flatScheduleAtStart(planPhases, parsed.data.startDate ?? null)
    : null;
  const data = flat
    ? {
        ...parsed.data,
        scheduleDays: flat.scheduleDays,
        startTime: flat.startTime,
        endTime: flat.endTime,
      }
    : parsed.data;
  // BGĐ 31/07 — giờ riêng theo thứ (chỉ nhận thứ đang học).
  const scheduleSlots = flat
    ? flat.slots.filter((s) => s.startTime)
    : readScheduleSlots(formData, data.scheduleDays);
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  // PR-C: suy ra centerId/orgUnitId (kế thừa nhóm lớp nếu có) để dual-write.
  const { centerId, orgUnitId } = await resolveClassOrg(data, sdb);

  // Cách ly cơ sở: chỉ tạo lớp cho cơ sở trong tầm nhìn actor.
  if (!actorCanUseCenter(actor, centerId)) {
    return { error: "Không có quyền tạo lớp cho cơ sở này" };
  }
  const hoErr = await rejectHeadOfficeCenter(centerId);
  if (hoErr) return { error: hoErr };

  // R2-RBAC-3 — GV/TA phải cùng cơ sở lớp (chống gán chéo CS).
  const teacherCenterErr = await assertTeachersInCenter(
    sdb,
    centerId,
    data.teacherId,
    data.assistantId,
  );
  if (teacherCenterErr) return { error: teacherCenterErr };

  // R7-06 — CHẶN tạo/kích hoạt lớp khi khoá chưa có giáo trình ACTIVE.
  if (!(await courseHasActiveCurriculum(data.courseId))) {
    return {
      error:
        "Khoá học chưa có giáo trình đang áp dụng (ACTIVE) — không thể tạo lớp. Hãy kích hoạt giáo trình trước.",
    };
  }

  // R7-06 — chốt (pin) curriculum version lúc tạo. Lấy version người dùng chọn
  // nếu hợp lệ, mặc định = version ACTIVE mới nhất của khoá.
  const pickedCurriculumIdRaw = formData.get("curriculumId");
  const pickedCurriculumId =
    typeof pickedCurriculumIdRaw === "string" && pickedCurriculumIdRaw.trim()
      ? pickedCurriculumIdRaw.trim()
      : null;

  let curriculum =
    pickedCurriculumId &&
    (await sdb.curriculum.findFirst({
      where: {
        id: pickedCurriculumId,
        courseId: data.courseId,
        isActive: true,
        status: "ACTIVE",
      },
      select: { id: true, version: true },
    }));
  if (!curriculum) {
    curriculum = await sdb.curriculum.findFirst({
      where: { courseId: data.courseId, isActive: true, status: "ACTIVE" },
      orderBy: { version: "desc" },
      select: { id: true, version: true },
    });
  }
  if (!curriculum) {
    return { error: "Khoá học chưa có giáo trình ACTIVE — không thể tạo lớp." };
  }

  // T3.3 — bỏ trống "Ngày bế giảng" → gợi ý = ngày buổi cuối theo lịch (trừ ngày
  // nghỉ). Nhập tay luôn thắng. Lỗi tính toán KHÔNG chặn tạo lớp.
  const dataWithEndDate = {
    ...data,
    endDate:
      data.endDate ??
      (await suggestClassEndDate({
        centerId,
        startDate: data.startDate,
        scheduleDays: data.scheduleDays,
        // Nhiều giai đoạn ⇒ ngày bế giảng phải tính theo CẢ dãy, không theo mỗi giai
        // đoạn đầu (lớp giảm từ 2 xuống 1 buổi/tuần sẽ kết thúc muộn hơn nhiều).
        phases: planPhases ?? undefined,
        courseId: data.courseId,
        curriculumId: curriculum.id,
      }).catch(() => null)),
  };

  let createdId = "";
  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      // Phase T0.2 — tự sinh classCode nếu admin để trống (giữ mã cũ nếu có).
      // HO (centerId=null) không tự sinh mã — admin nhập tay nếu cần.
      let classCode = data.classCode;
      if (!classCode && centerId) {
        const [center, course] = await Promise.all([
          tx.center.findUnique({
            where: { id: centerId },
            select: { code: true },
          }),
          tx.course.findUnique({
            where: { id: data.courseId },
            select: { code: true, slug: true },
          }),
        ]);
        if (center?.code) {
          const courseCode = course?.code || course?.slug || "KH";
          classCode = await genClassCode(center.code, courseCode, tx);
        }
      }

      const created = await tx.class.create({
        data: {
          ...toCreateData(dataWithEndDate, classCode, centerId, orgUnitId),
          curriculumId: curriculum.id,
          curriculumVersion: curriculum.version,
          // BGĐ 31/07 — giờ riêng theo thứ (rỗng → lớp dùng giờ chung như trước).
          ...(scheduleSlots.length > 0
            ? { scheduleSlots: { create: scheduleSlots } }
            : {}),
        },
        select: { id: true, ...CLASS_SNAPSHOT_SELECT },
      });
      createdId = created.id;

      // Kế hoạch lịch phải nằm CÙNG transaction với lớp: lớp có mà kế hoạch không có thì
      // mọi đường sinh/dời buổi lùi về lịch phẳng và lớp im lặng chạy sai nhịp.
      if (planPhases) {
        await persistPhases(tx, created.id, planPhases, new Date());
      }

      const { id: _id, ...newValues } = created;
      void _id;

      await logClassAudit({
        classId: created.id,
        action: "CREATE",
        actorId,
        actorName,
        newValues,
        tx,
      });

      // US-03 chat — lớp tạo THẲNG ở trạng thái ACTIVE (không qua approveClass) cũng
      // phải có nhóm lớp (BR-01); trạng thái khác → sync tự no-op.
      await syncConversationMembership(tx, created.id);
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "Mã lớp đã tồn tại" };
    }
    return { error: "Lỗi cơ sở dữ liệu — không tạo được lớp" };
  }

  // R7-06 — sinh kế hoạch buổi (ClassSessionPlan) từ giáo trình đã chốt.
  // Best-effort: lỗi không chặn happy path (lớp đã tạo).
  try {
    await createSessionPlansForClass({
      classId: createdId,
      curriculumId: curriculum.id,
      version: curriculum.version,
    });
  } catch (err) {
    console.error("[createClass] createSessionPlansForClass error:", err);
  }

  // R2-LMS-4 — sau khi có ClassSessionPlan (khung CT đã pin) → tự sinh bài tập DRAFT
  // từ AssignmentTemplate gắn các buổi (clone câu hỏi). Best-effort + idempotent;
  // lỗi KHÔNG chặn happy path tạo lớp (lớp đã tạo ở transaction trên).
  try {
    await generateAssignmentsFromTemplates({ classId: createdId });
  } catch (err) {
    console.error("[createClass] generateAssignmentsFromTemplates error:", err);
  }

  // 08/08 — lớp tạo THẲNG ở trạng thái "Đang dạy" thì KHÔNG đi qua `approveClass`, nên
  // trước đây không đường nào sinh buổi: lớp có học viên mà 0 buổi, im lặng. Ca thật trên
  // prod: `sata2.09h-CN.CS1-101` (tạo 07/08, ACTIVE, 6 HV, khai giảng 16/07 → 0 buổi).
  let createWarning: string | undefined;
  if (data.status === "ACTIVE") {
    try {
      const gen = await generateClassSessions(createdId, { onlyIfEmpty: true });
      if (!gen.ok) {
        createWarning = `Lớp đã tạo nhưng CHƯA sinh được buổi học: ${gen.error ?? "lỗi không rõ"}. Sửa lịch/khoá rồi bấm “Sinh buổi học”.`;
      } else if (gen.warning) {
        createWarning = gen.warning;
      }
    } catch (err) {
      console.error("[createClass] generateClassSessions error:", err);
      createWarning = "Lớp đã tạo nhưng chưa sinh được buổi học — vào lớp bấm “Sinh buổi học”.";
    }
  }

  revalidatePath("/classes");
  revalidatePath("/sessions");
  // Thành công → trả {} để client toast + điều hướng (QA 20/07 Vấn đề 4 — không
  // redirect server-side âm thầm nữa).
  return createWarning ? { warning: createWarning } : {};
}

export async function updateClass(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const session = await requireClassWrite("update");

  const raw = readForm(formData);
  const parsed = classCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const before = await sdb.class.findUnique({
    where: { id },
    select: CLASS_SNAPSHOT_SELECT,
  });
  if (!before) return { error: "Không tìm thấy lớp" };

  // 20/08 — HAI Ô ĐÃ GỠ KHỎI FORM: "Nhóm lớp cố định" (cờ `CLASS_GROUP_ENABLED` mặc định
  // OFF) và "Ghi chú nội bộ" (bỏ hẳn). Ô không render ⇒ FormData KHÔNG còn hai khoá đó,
  // mà `classCreateSchema` lại mặc định chúng về `null` ⇒ `toUpdateData` sẽ
  // `classGroup: { disconnect: true }` + `notes: null`. Nghĩa là: mỗi lần ai đó bấm
  // "Cập nhật" một lớp là lớp bị GỠ KHỎI NHÓM và XOÁ SẠCH ghi chú cũ, không cảnh báo gì.
  //
  // Quy ước phân biệt — `formData.get()` trả `null` khi khoá VẮNG MẶT, trả `""` khi ô có
  // mặt nhưng để trống. Vắng mặt = "form này không quản field đó" ⇒ GIỮ NGUYÊN giá trị
  // đang lưu. Chuỗi rỗng = người dùng cố ý xoá ⇒ vẫn ghi null như cũ.
  // (Đường nhập Excel/API cũ có gửi 2 khoá này thì chạy y hệt trước.)
  const keepClassGroup = formData.get("classGroupId") === null;
  const keepNotes = formData.get("notes") === null;
  // ⚠️ Class ∈ SCOPED_MODELS: findUnique lọc hậu kỳ theo record.centerId → select PHẢI
  // kèm centerId, thiếu là trả null cho lớp actor VẪN xem được.
  const kept =
    keepClassGroup || keepNotes
      ? await sdb.class.findUnique({
          where: { id },
          select: { centerId: true, classGroupId: true, notes: true },
        })
      : null;
  const input = {
    ...parsed.data,
    ...(keepClassGroup ? { classGroupId: kept?.classGroupId ?? null } : {}),
    ...(keepNotes ? { notes: kept?.notes ?? null } : {}),
  };

  // QA 21/07 (B4) — KHÔNG cho đổi cờ sang CANCELLED qua update trần: hủy lớp phải
  // đi qua cancelClassAction (rút ghi danh + hủy buổi tương lai + hoàn tiền).
  // Đổi cờ trần để lại HS "Đang học" + buổi "Sắp tới" trong lớp đã Huỷ.
  if (input.status === "CANCELLED" && before.status !== "CANCELLED") {
    return {
      error:
        'Không đổi trạng thái "Huỷ" trực tiếp — dùng nút "Hủy lớp" (có rút ghi danh, hủy buổi và hoàn tiền).',
    };
  }

  // 22/09/2026 — Y HỆT lý do trên, cho nhánh HOÀN THÀNH. Cổng này thiếu suốt từ
  // 21/07: dropdown vẫn chọn được "Hoàn thành", `updateClass` chỉ set cờ, và lớp
  // xong rồi mà học viên vẫn "Đang học" (lỗi prod 22/09). Hoàn thành lớp nay bắt
  // buộc đi qua `completeClassAction` — nó chuyển ghi danh sang Hoàn thành, cấp
  // chứng chỉ và gửi email phụ huynh.
  if (input.status === "COMPLETED" && before.status !== "COMPLETED") {
    return {
      error:
        'Không đổi trạng thái "Hoàn thành" trực tiếp — dùng nút "Hoàn thành lớp" (có chuyển ghi danh sang Hoàn thành, cấp chứng chỉ và báo phụ huynh).',
    };
  }

  const { actorId, actorName } = getAuditActor(session);

  // PR-C: suy ra centerId/orgUnitId (kế thừa nhóm lớp nếu có) để dual-write.
  const { centerId, orgUnitId } = await resolveClassOrg(input, sdb);

  // Cách ly cơ sở: lớp HIỆN TẠI + cơ sở ĐÍCH (nếu đổi) đều phải trong tầm nhìn actor.
  if (!passesScope("Class", { centerId: before.centerId }, actor)) {
    return { error: "Không tìm thấy lớp" };
  }
  if (!actorCanUseCenter(actor, centerId)) {
    return { error: "Không có quyền chuyển lớp sang cơ sở này" };
  }
  // Không chuyển lớp về Hội sở (cùng luật với lúc tạo — xem rejectHeadOfficeCenter).
  const hoErrUpd = await rejectHeadOfficeCenter(centerId);
  if (hoErrUpd) return { error: hoErrUpd };

  // R2-RBAC-3 — GV/TA phải cùng cơ sở lớp (chống gán chéo CS).
  const teacherCenterErr = await assertTeachersInCenter(
    sdb,
    centerId,
    input.teacherId,
    input.assistantId,
  );
  if (teacherCenterErr) return { error: teacherCenterErr };

  // T3.3 — như createClass: bỏ trống bế giảng thì tự tính lại từ lịch hiện tại.
  // ⚠️ Class ∈ SCOPED_MODELS: findUnique lọc hậu kỳ theo record.centerId → select
  // PHẢI kèm centerId (thiếu → trả null cho lớp actor VẪN xem được).
  const current = await sdb.class.findUnique({
    where: { id },
    select: {
      centerId: true,
      curriculumId: true,
      // Lịch phẳng hiện tại — để đối chiếu khi lớp dùng Kế hoạch lịch học (xem dưới).
      scheduleDays: true,
      startTime: true,
      endTime: true,
      scheduleSlots: { select: { weekday: true, startTime: true, endTime: true } },
      _count: { select: { schedulePhases: true } },
    },
  });
  // 08/08 — form sửa lớp KHÔNG còn ô lịch nào (khối "Kế hoạch lịch học" tự lưu). Không có
  // `schedulePhases` trong FormData ⇒ GIỮ NGUYÊN lịch hiện tại: schema mặc định
  // `scheduleDays: []` + `startTime: null`, ghi thẳng là xoá sạch lịch lớp trong im lặng.
  const plan = readSchedulePhases(formData);
  if (plan.provided && "error" in plan) return { error: plan.error };
  const planPhases = plan.provided && "phases" in plan ? plan.phases : null;
  const scheduleProvided = planPhases !== null || formData.getAll("scheduleDays").length > 0;

  const flat = planPhases
    ? flatScheduleAtStart(planPhases, input.startDate ?? null)
    : null;
  const dataWithSchedule = flat
    ? {
        ...input,
        scheduleDays: flat.scheduleDays,
        startTime: flat.startTime,
        endTime: flat.endTime,
      }
    : input;

  const dataWithEndDate = {
    ...dataWithSchedule,
    endDate:
      input.endDate ??
      (await suggestClassEndDate({
        centerId,
        startDate: input.startDate,
        // Lịch không gửi kèm → tính bằng lịch ĐANG LƯU, không phải mảng rỗng của schema.
        scheduleDays: scheduleProvided
          ? dataWithSchedule.scheduleDays
          : (current?.scheduleDays ?? []),
        phases: planPhases ?? undefined,
        courseId: input.courseId,
        curriculumId: current?.curriculumId ?? null,
      }).catch(() => null)),
  };

  // BGĐ 31/07 — giờ riêng theo thứ (chỉ nhận thứ đang học sau khi sửa lịch).
  const scheduleSlots = flat
    ? flat.slots.filter((s) => s.startTime)
    : readScheduleSlots(formData, dataWithSchedule.scheduleDays);

  const usesPhases = (current?._count.schedulePhases ?? 0) > 0;
  // Lịch có ĐỔI THẬT không. Gửi kế hoạch → so kế hoạch cũ/mới (so bản sao phẳng sẽ bỏ sót
  // thay đổi ở giai đoạn tương lai). Gửi lịch phẳng → so như cũ. Không gửi gì → không đổi.
  const beforePhases = usesPhases ? ((await loadClassPhases(id))?.phases ?? []) : [];
  const scheduleTouched = planPhases
    ? phaseSignature(planPhases) !== phaseSignature(beforePhases)
    : scheduleProvided
      ? scheduleChanged(current, dataWithSchedule, scheduleSlots)
      : false;

  // Lớp đã có kế hoạch mà form lại gửi lịch PHẲNG (đường nhập cũ/API) — chặn: ghi đè bản
  // sao trong khi kế hoạch vẫn là nguồn sự thật chỉ tạo ra lệch lịch âm thầm.
  if (usesPhases && !planPhases && scheduleProvided && scheduleTouched) {
    return {
      error:
        "Lớp này dùng Kế hoạch lịch học nhiều giai đoạn — sửa thứ/giờ ở khối “Kế hoạch lịch học”, không sửa bằng lịch phẳng.",
    };
  }

  // 08/08 — ĐỔI NGÀY KHAI GIẢNG PHẢI KÉO THEO BUỔI HỌC. Trước đây chỗ này chỉ tính lại
  // `endDate` (một con số dự phóng) rồi dừng, còn `ClassSession` giữ nguyên dãy cũ ⇒ lịch
  // lớp và buổi học lệch nhau vĩnh viễn mà không có cảnh báo nào. Ca thật:
  // `sata3.15h45-17h15.T7.CS1-201` sửa khai giảng 26/07 → 27/06 nhưng 48 buổi vẫn nằm
  // 01/08/2026 → 26/06/2027 (lệch 5 tuần).
  const startDateChanged =
    ymdOrNull(before.startDate) !== ymdOrNull(dataWithEndDate.startDate ?? null);

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      const updated = await tx.class.update({
        where: { id },
        data: toUpdateData(dataWithEndDate, centerId, orgUnitId, {
          omitSchedule: !scheduleProvided,
        }),
        select: CLASS_SNAPSHOT_SELECT,
      });

      // Kế hoạch gửi kèm form → ghi kế hoạch; `persistPhases` tự đồng bộ luôn bản sao
      // phẳng + bảng slot, nên KHÔNG đụng tay vào `classScheduleSlot` ở nhánh này.
      if (planPhases) {
        await persistPhases(tx, id, planPhases, new Date());
      } else if (scheduleProvided && !usesPhases) {
        // Đường lịch phẳng cũ: thay TOÀN BỘ slot theo form (rỗng = quay về giờ chung).
        await tx.classScheduleSlot.deleteMany({ where: { classId: id } });
        if (scheduleSlots.length > 0) {
          await tx.classScheduleSlot.createMany({
            data: scheduleSlots.map((s) => ({ classId: id, ...s })),
          });
        }
      }

      await logClassAudit({
        classId: id,
        action: "UPDATE",
        actorId,
        actorName,
        oldValues: before,
        newValues: updated,
        changedFields: detectChangedFields(before, updated),
        tx,
      });

      // US-03 chat — cùng transaction: đổi GV/trợ giảng, đổi trạng thái (→ACTIVE tạo
      // nhóm; →COMPLETED archive nhóm) đều đồng bộ membership tại đây.
      await syncConversationMembership(tx, id);
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "Mã lớp đã tồn tại" };
    }
    return { error: "Lớp không tồn tại hoặc lỗi cơ sở dữ liệu" };
  }

  // Xếp lại buổi cho khớp lịch vừa lưu. Ngoài transaction trên: `resyncClassSessions`
  // đọc lại lớp bằng connection khác nên phải chạy SAU commit, nếu không nó vẫn thấy
  // ngày khai giảng cũ. Lỗi ở bước này KHÔNG rollback việc sửa lớp — người dùng còn nút
  // "Xếp lại buổi theo lịch" ở màn lớp để chạy lại.
  // Kế hoạch gửi kèm form thì cũng phải xếp lại buổi — nếu không, lớp đổi nhịp mà dãy
  // buổi giữ nguyên (đúng lỗi "lịch một đằng buổi một nẻo" đã phải vá hôm 08/08).
  let syncWarning: string | undefined;
  if (startDateChanged || scheduleTouched) {
    try {
      const res = await resyncClassSessions({
        classId: id,
        // Đổi ngày khai giảng ⇒ neo lại CẢ DÃY. Chỉ đổi thứ/giờ ⇒ giữ nguyên quá khứ.
        wholeSeries: startDateChanged,
        actor: { id: actorId, name: actorName },
        reason: startDateChanged
          ? "Đổi ngày khai giảng — xếp lại buổi theo lịch"
          : "Đổi lịch học — xếp lại buổi từ hôm nay",
      });
      if (!res.ok) {
        syncWarning = `Đã lưu lớp nhưng CHƯA xếp lại được buổi học: ${res.error ?? "lỗi không rõ"}`;
      } else {
        const parts: string[] = [];
        if (res.generated) parts.push(`đã sinh ${res.generated} buổi`);
        if (res.moved) parts.push(`đã dời ${res.moved} buổi theo lịch mới`);
        if (res.kept) parts.push(`giữ nguyên ${res.kept} buổi đã có dữ liệu`);
        if (parts.length > 0) syncWarning = `Buổi học: ${parts.join(", ")}.`;
        if (res.warning) syncWarning = `${syncWarning ?? ""} ${res.warning}`.trim();
      }
    } catch (err) {
      console.error("[updateClass] resyncClassSessions error:", err);
      syncWarning = "Đã lưu lớp nhưng chưa xếp lại được buổi học — vào lớp bấm “Xếp lại buổi theo lịch”.";
    }
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath(`/classes/${id}/edit`);
  revalidatePath("/sessions");
  return syncWarning ? { warning: syncWarning } : {};
}

/** "YYYY-MM-DD" theo lịch VN của một mốc NGÀY; null giữ nguyên null. */
function ymdOrNull(d: Date | null | undefined): string | null {
  return d ? vnYmd(d) : null;
}

export async function deleteClass(id: string): Promise<ActionResult> {
  const session = await requireClassWrite("delete");
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const before = await sdb.class.findUnique({
    where: { id },
    select: CLASS_SNAPSHOT_SELECT,
  });
  if (!before) return { error: "Không thể xoá lớp này" };

  // Cách ly cơ sở: chỉ xoá lớp trong tầm nhìn actor (chống IDOR).
  if (!passesScope("Class", { centerId: before.centerId }, actor)) {
    return { error: "Không thể xoá lớp này" };
  }

  const { actorId, actorName } = getAuditActor(session);

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      await tx.class.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await logClassAudit({
        classId: id,
        action: "DELETE",
        actorId,
        actorName,
        oldValues: before,
        tx,
      });

      // US-03 chat — lớp xoá mềm → nhóm lớp archive (sync thấy deletedAt → archive).
      await syncConversationMembership(tx, id);
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch {
    return { error: "Không thể xoá lớp này" };
  }
  revalidatePath("/classes");
  return {};
}

// ─── Module Quản lý lớp PHẦN 1 — workflow phê duyệt ─────────────────────────

type WfResult = { ok: true } | { ok: false; error: string };

const SUBMIT_ROLES = ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"] as const;
const APPROVE_ROLES = ["SUPER_ADMIN", "CENTER_MANAGER"] as const;

/** Sale/quản lý gửi lớp đi duyệt (PLANNED/RECRUITING → PENDING_APPROVAL). */
export async function submitClassForApproval(classId: string): Promise<WfResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!hasAnyRole(session.user, [...SUBMIT_ROLES])) {
    return { ok: false, error: "Không có quyền gửi duyệt lớp" };
  }
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { status: true, centerId: true, _count: { select: { enrollments: true } } },
  });
  if (!cls) return { ok: false, error: "Lớp không tồn tại" };

  // Cách ly cơ sở: chỉ gửi duyệt lớp trong tầm nhìn actor (chống IDOR).
  if (!passesScope("Class", { centerId: cls.centerId }, actor)) {
    return { ok: false, error: "Lớp không tồn tại" };
  }

  if (cls.status !== "PLANNED" && cls.status !== "RECRUITING") {
    return { ok: false, error: `Lớp đang ${cls.status}, không thể gửi duyệt` };
  }
  if (cls._count.enrollments === 0) {
    return { ok: false, error: "Lớp chưa có học sinh nào — gán HS trước khi gửi duyệt" };
  }
  await sdb.class.update({
    where: { id: classId },
    data: { status: "PENDING_APPROVAL", submittedForApprovalAt: new Date() },
  });
  revalidatePath("/classes");
  revalidatePath(`/classes/${classId}/edit`);
  revalidatePath("/dashboard");
  return { ok: true };
}

async function requireApprover(classId: string) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!hasAnyRole(session.user, [...APPROVE_ROLES])) {
    return { ok: false as const, error: "Chỉ quản lý cơ sở / SUPER_ADMIN được duyệt" };
  }
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { status: true, centerId: true },
  });
  if (!cls) return { ok: false as const, error: "Lớp không tồn tại" };
  // CENTER_MANAGER (không kèm SUPER_ADMIN) chỉ duyệt cơ sở mình.
  const isSuper = hasAnyRole(session.user, ["SUPER_ADMIN"]);
  if (!isSuper && cls.centerId !== session.user.centerId) {
    return { ok: false as const, error: "Lớp không thuộc cơ sở của bạn" };
  }
  return { ok: true as const, session, cls, sdb };
}

/** Quản lý duyệt lớp (PENDING_APPROVAL → ACTIVE). */
export async function approveClass(classId: string): Promise<WfResult & { warning?: string }> {
  const gate = await requireApprover(classId);
  if (!gate.ok) return gate;
  if (gate.cls.status !== "PENDING_APPROVAL") {
    return { ok: false, error: "Lớp không ở trạng thái chờ duyệt" };
  }
  // US-03 chat — duyệt lớp → ACTIVE là điểm sinh nhóm lớp (BR-01): bọc transaction
  // để tạo Conversation + participant dẫn xuất CÙNG lúc với đổi trạng thái.
  await gate.sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.class.update({
      where: { id: classId },
      data: {
        status: "ACTIVE",
        approvedAt: new Date(),
        approvedById: gate.session.user.id,
        approvedByName: gate.session.user.name ?? gate.session.user.email ?? "Quản lý",
      },
    });
    await syncConversationMembership(tx, classId);
  }, { timeout: 30_000, maxWait: 10_000 });

  // P2 — duyệt lớp ACTIVE → TỰ SINH buổi học (nếu chưa có).
  // 08/08 — KHÔNG nuốt lỗi nữa: trước đây `res.ok === false` (lớp chưa khai lịch, khoá
  // chưa cấu hình số buổi…) bị bỏ qua im lặng ⇒ lớp duyệt xong không có buổi nào mà
  // không ai biết. Vẫn không chặn duyệt — chỉ báo lên để người duyệt xử lý ngay.
  let warning: string | undefined;
  try {
    const gen = await generateClassSessions(classId, { onlyIfEmpty: true });
    if (!gen.ok) {
      warning = `Lớp đã duyệt nhưng CHƯA sinh được buổi học: ${gen.error ?? "lỗi không rõ"}.`;
    } else if (gen.warning) {
      warning = gen.warning;
    }
  } catch (err) {
    console.error("[approveClass] generate sessions error:", err);
    warning = "Lớp đã duyệt nhưng chưa sinh được buổi học — bấm “Sinh buổi học” ở tab Thông tin.";
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${classId}`);
  revalidatePath(`/classes/${classId}/edit`);
  revalidatePath("/sessions");
  revalidatePath("/dashboard");
  return warning ? { ok: true, warning } : { ok: true };
}

/** P2 — nút sinh buổi học thủ công cho 1 lớp (khi cần sinh lại / lớp cũ chưa có buổi). */
export async function generateSessionsAction(
  classId: string,
): Promise<WfResult & { generated?: number; warning?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("classes:edit"))) return { ok: false, error: "Không có quyền" };
  // Cách ly cơ sở: chỉ sinh buổi cho lớp trong tầm nhìn actor (chống IDOR).
  const actor = await resolveActor(session.user.id);
  if (!(await classInScope(actor, classId))) return { ok: false, error: "Lớp không tồn tại" };
  const res = await generateClassSessions(classId, { onlyIfEmpty: true });
  if (!res.ok) return { ok: false, error: res.error ?? "Không sinh được buổi học" };
  revalidatePath(`/classes/${classId}`);
  revalidatePath(`/classes/${classId}/edit`);
  revalidatePath("/sessions");
  // 08/08 — lớp đã có buổi thì `onlyIfEmpty` trả `generated: 0` mà vẫn `ok`, trước đây
  // client toast "Lớp đã có buổi học" ⇒ người dùng tưởng đã kiểm tra xong. Nói thẳng
  // rằng nút này KHÔNG sửa dãy cũ và chỉ đường sang nút xếp lại.
  if (res.generated === 0) {
    return {
      ok: true,
      generated: 0,
      warning:
        "Lớp đã có buổi học nên nút này không tạo thêm. Muốn dãy buổi khớp lại ngày khai giảng + lịch thì bấm “Xếp lại buổi theo lịch”.",
    };
  }
  // T4.1/T4.2 — báo cáo trùng lô: generateClassSessions CHỈ cảnh báo (không chặn),
  // trước đây warning bị nuốt ở action nên người dùng không hề biết.
  return { ok: true, generated: res.generated, ...(res.warning ? { warning: res.warning } : {}) };
}

/**
 * 08/08 — XẾP LẠI dãy buổi cho khớp ngày khai giảng + lịch học (sửa tay).
 *
 * Đường sửa cho những lớp đã lỡ lệch trước khi có bản vá tự động ở `updateClass`.
 * Chỉ đổi `date`, không tạo/xoá buổi; buổi đã có dữ liệu giữ nguyên ngày.
 */
export async function resyncClassSessionsAction(
  classId: string,
): Promise<WfResult & { generated?: number; moved?: number; kept?: number; warning?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("classes:edit"))) return { ok: false, error: "Không có quyền" };
  const actor = await resolveActor(session.user.id);
  if (!(await classInScope(actor, classId))) return { ok: false, error: "Lớp không tồn tại" };

  const { actorId, actorName } = getAuditActor(session);
  const res = await resyncClassSessions({
    classId,
    wholeSeries: true, // sửa tay = neo lại cả dãy từ ngày khai giảng
    actor: { id: actorId, name: actorName },
    reason: "Xếp lại buổi theo ngày khai giảng (sửa tay)",
  });
  if (!res.ok) return { ok: false, error: res.error ?? "Không xếp lại được buổi học" };

  revalidatePath(`/classes/${classId}`);
  revalidatePath(`/classes/${classId}/edit`);
  revalidatePath("/sessions");
  return {
    ok: true,
    generated: res.generated,
    moved: res.moved,
    kept: res.kept,
    ...(res.warning ? { warning: res.warning } : {}),
  };
}

/** Soát 1 lớp: dãy buổi có khớp ngày khai giảng + lịch không (thuần đọc, cho banner). */
export async function auditClassSessionsAction(classId: string): Promise<
  | { ok: true; severity: string; message: string | null; wrongDateCount: number }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  const actor = await resolveActor(session.user.id);
  if (!(await classInScope(actor, classId))) return { ok: false, error: "Lớp không tồn tại" };
  const audit = await auditClassSessions(classId);
  if (!audit) return { ok: false, error: "Lớp không tồn tại" };
  return {
    ok: true,
    severity: audit.severity,
    message: audit.message,
    wrongDateCount: audit.wrongDateCount,
  };
}

/** Quản lý trả lại lớp (PENDING_APPROVAL → RECRUITING) kèm lý do. */
export async function rejectClass(classId: string, reason: string): Promise<WfResult> {
  const gate = await requireApprover(classId);
  if (!gate.ok) return gate;
  if (gate.cls.status !== "PENDING_APPROVAL") {
    return { ok: false, error: "Lớp không ở trạng thái chờ duyệt" };
  }
  const trimmed = reason.trim();
  if (trimmed.length < 5) return { ok: false, error: "Nhập lý do trả lại (≥5 ký tự)" };
  const stamp = formatDateVN(new Date());
  await gate.sdb.class.update({
    where: { id: classId },
    data: {
      status: "RECRUITING",
      submittedForApprovalAt: null,
      notes: `[Trả lại ${stamp}] ${trimmed}`,
    },
  });
  revalidatePath("/classes");
  revalidatePath(`/classes/${classId}/edit`);
  revalidatePath("/dashboard");
  return { ok: true };
}

// ─── Module Quản lý lớp PHẦN 2 — dời buổi tương lai theo lịch mới ────────────

/** Form có đổi thứ/giờ so với lịch phẳng đang lưu không? (so theo NỘI DUNG, không theo thứ tự) */
function scheduleChanged(
  current: {
    scheduleDays: number[];
    startTime: string | null;
    endTime: string | null;
    scheduleSlots: { weekday: number; startTime: string; endTime: string | null }[];
  } | null,
  next: { scheduleDays: number[]; startTime?: string | null; endTime?: string | null },
  nextSlots: { weekday: number; startTime: string; endTime: string | null }[],
): boolean {
  if (!current) return false;
  const days = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b).join(",");
  if (days(current.scheduleDays) !== days(next.scheduleDays)) return true;
  if ((current.startTime ?? null) !== (next.startTime ?? null)) return true;
  if ((current.endTime ?? null) !== (next.endTime ?? null)) return true;
  const norm = (xs: { weekday: number; startTime: string; endTime: string | null }[]) =>
    [...xs]
      .sort((a, b) => a.weekday - b.weekday)
      .map((s) => `${s.weekday}|${s.startTime}|${s.endTime ?? ""}`)
      .join(";");
  return norm(current.scheduleSlots) !== norm(nextSlots);
}

async function computeFutureReschedule(classId: string, actor: Actor) {
  const sdb = scopedDb(actor);

  // 07/08 — lớp ĐÃ lập kế hoạch lịch nhiều giai đoạn thì nút này không dùng được nữa:
  // nó chỉ biết MỘT bộ thứ+giờ (bản sao của giai đoạn đang hiệu lực) nên sẽ rải cả khoá
  // theo nhịp của riêng giai đoạn đó, xoá sạch ý đồ "tháng 8 học 1 buổi/tuần". Đường
  // đúng là khối "Kế hoạch lịch học" ở tab Thông tin — ở đó có mốc áp dụng và có giữ
  // nguyên buổi đã có dữ liệu.
  const phaseCount = await sdb.classSchedulePhase.count({ where: { classId } });
  if (phaseCount > 0) {
    return {
      ok: false as const,
      error:
        "Lớp này đang dùng Kế hoạch lịch học nhiều giai đoạn — dời buổi ở khối “Kế hoạch lịch học” trong tab Thông tin (có ô “áp dụng từ ngày” và giữ nguyên buổi đã điểm danh).",
    };
  }

  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: {
      id: true,
      centerId: true,
      scheduleDays: true,
      startTime: true,
      startDate: true,
      // T4.1 — cần GV/phòng/giờ kết thúc để soát trùng cho lô ngày mới.
      endTime: true,
      teacherId: true,
      roomId: true,
      // BGĐ 31/07 — giờ riêng theo thứ (lớp 2 ca khác giờ).
      scheduleSlots: { select: { weekday: true, startTime: true, endTime: true } },
    },
  });
  if (!cls) return { ok: false as const, error: "Lớp không tồn tại" };

  // Lịch hiệu lực: slot riêng theo thứ (nếu có), lùi về scheduleDays + giờ chung.
  const slots = resolveClassSlots({
    scheduleDays: cls.scheduleDays,
    startTime: cls.startTime,
    endTime: cls.endTime,
    slots: cls.scheduleSlots,
  });
  const scheduleDays = slots.map((s) => s.weekday);
  if (scheduleDays.length === 0) {
    return { ok: false as const, error: "Lớp chưa có lịch (scheduleDays) để dời buổi" };
  }

  const now = new Date();
  // Mốc "hết hôm nay" / "ngày mai" theo LỊCH VN — server Vercel chạy UTC nên
  // `new Date(y,m,d,…)` sẽ lấy nhầm ngày UTC (lệch 7h so với ngày làm việc thật).
  const todayEnd = vnEndOfDay(now);
  const future = await sdb.classSession.findMany({
    // R7-06 AC6: chỉ dời buổi SCHEDULED tương lai — KHÔNG đụng buổi đã COMPLETED/
    // đang IN_PROGRESS hay đã CANCELLED (giữ tổng buổi + không hồi sinh buổi huỷ).
    where: { classId, date: { gt: todayEnd }, status: { notIn: ["COMPLETED", "CANCELLED", "IN_PROGRESS"] } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, topic: true },
  });
  if (future.length === 0) return { ok: false as const, error: "Không có buổi tương lai để dời" };

  const holidayRows = await sdb.holiday.findMany({
    where: { OR: [{ centerId: cls.centerId }, { centerId: null }] },
    select: { date: true, endDate: true },
  });
  const holidays = expandHolidaySet(holidayRows);

  // QA 21/07 — không dời buổi về TRƯỚC ngày khai giảng: mốc quét = max(ngày mai,
  // startDate của lớp). Trước đây lớp khai giảng 28/07 đổi lịch là buổi đầu bị
  // kéo về ngay ngày mai (22/07).
  const tomorrow = vnAddDays(vnStartOfDay(now), 1);
  const startDay = cls.startDate ? vnStartOfDay(cls.startDate) : tomorrow;
  const from = startDay > tomorrow ? startDay : tomorrow;
  const newDates = computeSessionDates({
    from,
    scheduleDays,
    count: future.length,
    holidays,
  });

  // BGĐ 31/07 — giờ buổi lấy theo ĐÚNG THỨ của ngày mới (lớp 2 ca khác giờ).
  const items = future.map((s, i) => {
    const d = newDates[i] ?? new Date(s.date);
    const nd = applySlotTimeToDate(d, slots);
    return { id: s.id, topic: s.topic, oldDate: s.date, newDate: nd };
  });

  // T4.1 — soát trùng PHÒNG/GV cho lô ngày MỚI trước khi dời cả lớp (trước đây
  // applyClassReschedule update date thẳng → double-book âm thầm). Loại chính các
  // buổi đang được dời khỏi phép so (chúng đang nhận ngày mới).
  // BGĐ 31/07 — soát theo TỪNG NHÓM THỨ với giờ của chính thứ đó (lớp 2 ca khác giờ).
  const conflicts: { date: Date; messages: string[] }[] = [];
  for (const slot of slots) {
    if (!slot.startTime) continue;
    const dates = items
      .map((it) => it.newDate)
      .filter((d) => vnWeekday(d) === slot.weekday);
    if (dates.length === 0) continue;
    const found = await detectBatchConflicts({
      centerId: null, // toàn hệ thống: GV có thể dạy 2 cơ sở
      excludeClassId: classId,
      excludeSessionIds: items.map((it) => it.id),
      classStartTime: slot.startTime,
      classEndTime: slot.endTime,
      teacherId: cls.teacherId,
      roomId: cls.roomId,
      dates,
    }).catch(() => []);
    conflicts.push(...found);
  }
  conflicts.sort((a, b) => a.date.getTime() - b.date.getTime());

  return { ok: true as const, items, conflicts };
}

/** Xem trước dời buổi tương lai (không lưu) — kèm cảnh báo trùng phòng/GV (T4.1). */
export async function previewClassReschedule(classId: string): Promise<
  | {
      ok: true;
      items: { id: string; topic: string | null; oldDate: string; newDate: string }[];
      conflicts: { date: string; messages: string[] }[];
    }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("classes:edit"))) return { ok: false, error: "Không có quyền" };
  const actor = await resolveActor(session.user.id);
  const res = await computeFutureReschedule(classId, actor);
  if (!res.ok) return res;
  return {
    ok: true,
    items: res.items.map((it) => ({
      id: it.id,
      topic: it.topic,
      oldDate: it.oldDate.toISOString(),
      newDate: it.newDate.toISOString(),
    })),
    conflicts: res.conflicts.map((c) => ({
      date: c.date.toISOString(),
      messages: c.messages,
    })),
  };
}

/** Áp dụng dời buổi tương lai theo lịch lớp + lịch nghỉ cơ sở. */
export async function applyClassReschedule(classId: string): Promise<WfResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("classes:edit"))) return { ok: false, error: "Không có quyền" };
  // Cách ly cơ sở: chỉ dời buổi cho lớp trong tầm nhìn actor (chống IDOR).
  const actor = await resolveActor(session.user.id);
  if (!(await classInScope(actor, classId))) return { ok: false, error: "Lớp không tồn tại" };
  const sdb = scopedDb(actor);
  const res = await computeFutureReschedule(classId, actor);
  if (!res.ok) return res;

  // T4.1 — CHẶN khi lịch mới đụng phòng/GV của lớp khác (trùng cứng). Cùng chuẩn với
  // adjustSession (đổi 1 buổi cũng chặn) — đừng để dời cả lớp lách qua.
  if (res.conflicts.length > 0) {
    const days = res.conflicts.slice(0, 3).map((c) => formatDateVN(c.date));
    const more =
      res.conflicts.length > days.length ? ` (+${res.conflicts.length - days.length} buổi nữa)` : "";
    return {
      ok: false,
      error: `Không dời được: lịch mới trùng phòng/giáo viên với lớp khác vào ${days.join(", ")}${more}. Đổi phòng/GV hoặc chọn lịch khác rồi thử lại.`,
    };
  }

  // T3.3 — buổi cuối dời thì NGÀY BẾ GIẢNG phải đi theo (items đã sort theo ngày).
  const lastNewDate = res.items[res.items.length - 1]?.newDate ?? null;

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      for (const it of res.items) {
        await tx.classSession.update({ where: { id: it.id }, data: { date: it.newDate } });
      }
      if (lastNewDate) {
        await tx.class.update({
          where: { id: classId },
          data: {
            endDate: new Date(
              lastNewDate.getFullYear(),
              lastNewDate.getMonth(),
              lastNewDate.getDate(),
            ),
          },
        });
      }
      // R7-06 AC6 — phát event để PH/GV được thông báo (handler ở R7-17).
      await publishEvent(
        "class.session_changed",
        { classId, change: "RESCHEDULED", count: res.items.length },
        { tx },
      );
    });
  } catch (err) {
    return { ok: false, error: `Lỗi dời buổi: ${err instanceof Error ? err.message : "Unknown"}` };
  }
  revalidatePath(`/classes/${classId}/edit`);
  revalidatePath("/sessions");
  return { ok: true };
}

// ─── Module Quản lý lớp PHẦN 3 — HỦY LỚP đúng nghĩa (LMS-10 / W3-2) ───────────

/** Trạng thái enrollment "còn sống" trong 1 lớp — sẽ bị rút về WITHDREW khi hủy lớp. */
const LIVE_ENROLLMENT_STATUSES = [
  "CONFIRMED",
  "STUDYING",
  "ACTIVE",
  "PAUSED",
] as const;

/**
 * LMS-10 / W3-2 — HỦY LỚP đúng nghĩa (khác `deleteClass` chỉ soft-delete và để lại
 * enrollment/buổi học mồ côi). Trong 1 transaction:
 *   a) Class.status = CANCELLED.
 *   b) Mọi enrollment còn sống (CONFIRMED/STUDYING/ACTIVE/PAUSED) → WITHDREW
 *      (transition HỢP LỆ theo state machine `lib/enrollments/status.ts`; guard
 *      `canTransition` để chắc). Ghi `enrollmentAuditLog` + `writeAudit` hợp nhất
 *      cho từng cái. KHÔNG hard-delete (FK RESTRICT).
 *   c) Buổi học tương lai (date >= hôm nay, SCHEDULED/IN_PROGRESS) → CANCELLED.
 *   d) Phát DomainEvent `class.cancelled` → handler thông báo PH/GV (idempotent,
 *      không external call trực tiếp).
 * `reason` BẮT BUỘC (≥5 ký tự).
 */
export async function cancelClassAction(
  classId: string,
  reason: string,
): Promise<WfResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // Tái dùng quyền `classes:edit` (giống reschedule / generate sessions).
  if (!(await checkPermission("classes:edit"))) {
    return { ok: false, error: "Không có quyền hủy lớp" };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length < 5) {
    return { ok: false, error: "Nhập lý do hủy lớp (≥5 ký tự)" };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { id: true, name: true, status: true, centerId: true },
  });
  if (!cls) return { ok: false, error: "Lớp không tồn tại" };

  // Cách ly cơ sở: chỉ hủy lớp trong tầm nhìn actor (chống IDOR cascade liên cơ sở).
  if (!passesScope("Class", { centerId: cls.centerId }, actor)) {
    return { ok: false, error: "Lớp không tồn tại" };
  }

  if (cls.status === "CANCELLED") {
    return { ok: false, error: "Lớp đã ở trạng thái đã hủy" };
  }
  if (cls.status === "COMPLETED") {
    return { ok: false, error: "Lớp đã hoàn thành — không thể hủy" };
  }

  const liveEnrollments = await sdb.enrollment.findMany({
    where: {
      classId,
      deletedAt: null,
      status: { in: [...LIVE_ENROLLMENT_STATUSES] },
    },
    select: { id: true, status: true },
  });

  const { actorId, actorName } = getAuditActor(session);
  const changedByUserId = session.user.id ?? null;
  const changedByName = session.user.name ?? session.user.email ?? session.user.id;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const withdrawReason = `[Hủy lớp] ${trimmedReason}`;

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;
      // a) Lớp → CANCELLED.
      await tx.class.update({
        where: { id: classId },
        data: { status: "CANCELLED" },
      });

      // b) Rút mọi enrollment còn sống về WITHDREW (guard state machine).
      for (const enr of liveEnrollments) {
        // canTransition luôn true với 4 trạng thái LIVE ở trên → WITHDREW; giữ guard
        // cho chắc nếu danh sách LIVE đổi về sau.
        if (!canTransition(enr.status as EnrollmentStatus, "WITHDREW")) continue;

        await tx.enrollment.update({
          where: { id: enr.id },
          data: { status: "WITHDREW", endedAt: now },
        });

        // W3-1 / LMS-9 — hủy lớp → tạo yêu cầu hoàn tiền (PENDING) cho mỗi HS bị rút,
        // TRONG cùng transaction. Idempotent + chỉ tạo khi có khoản đã thu (service lo).
        await createRefundRequest({
          enrollmentId: enr.id,
          trigger: "CLASS_CANCELLED",
          reason: withdrawReason,
          requestedById: actorId,
          actorName,
          tx,
        });

        await tx.enrollmentAuditLog.create({
          data: {
            enrollmentId: enr.id,
            fromStatus: enr.status,
            toStatus: "WITHDREW",
            changedByUserId,
            changedByName,
            reason: withdrawReason,
          },
        });
        // AuditLog hợp nhất cho viewer chung (atomic).
        await writeAudit({
          actor: { id: actorId, name: actorName },
          module: "enrollment",
          entityType: "Enrollment",
          entityId: enr.id,
          action: "STATUS_CHANGE",
          oldValues: { status: enr.status },
          newValues: { status: "WITHDREW" },
          reason: withdrawReason,
          orgUnitId: cls.centerId,
          tx,
        });
      }

      // c) Buổi học tương lai (chưa diễn ra) → CANCELLED. Giữ nguyên buổi đã
      //    COMPLETED/CANCELLED và buổi quá khứ.
      await tx.classSession.updateMany({
        where: {
          classId,
          date: { gte: todayStart },
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        },
        data: { status: "CANCELLED" },
      });

      // c2) QA 21/07 (B12) — nhu cầu học bù đang mở của lớp cũng huỷ theo
      //     (không để yêu cầu treo ở /hoc-bu sau khi lớp đã hủy).
      await tx.makeupNeed.updateMany({
        where: { classId, status: { in: ["PENDING", "SCHEDULED"] } },
        data: { status: "CANCELLED" },
      });

      // Audit cho chính lớp (logClassAudit chỉ có CREATE/UPDATE/DELETE → UPDATE).
      await logClassAudit({
        classId,
        action: "UPDATE",
        actorId,
        actorName,
        oldValues: { status: cls.status },
        newValues: { status: "CANCELLED" },
        changedFields: ["status"],
        reason: trimmedReason,
        tx,
      });

      // US-03 chat — lớp CANCELLED → nhóm lớp archive (BR-03), cùng transaction.
      await syncConversationMembership(tx, classId);

      // d) Thông báo PH/GV qua DomainEvent (handler idempotent ở r7-notifications).
      await publishEvent(
        "class.cancelled",
        {
          classId,
          reason: trimmedReason,
          withdrawnCount: liveEnrollments.length,
        },
        { tx },
      );
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi hủy lớp: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${classId}/edit`);
  revalidatePath("/enrollments");
  revalidatePath("/sessions");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ─── HOÀN THÀNH LỚP ──────────────────────────────────────────────────────────
//
// 22/09/2026 — cùng LỚP LỖI với "Huỷ lớp" hồi QA 21/07 (B4), chỉ khác cái cờ.
// "Hoàn thành" là một mục trong dropdown trạng thái của <ClassForm> → chạy
// `updateClass` → hàm đó CHỈ đổi `Class.status` và không đụng gì tới `Enrollment`.
// Trên prod: bấm hoàn thành lớp xong, học viên vẫn nằm "Đang học".
//
// Lỗ THỨ HAI, cùng họ, nằm ở đường "đúng quy trình": `completeCourse`
// (`lib/completion/service.ts`) — tức cả /hoan-thanh-khoa đơn lẻ, bản hàng loạt
// theo lớp, lẫn duyệt đề xuất của giáo viên — tạo CourseCompletion + mã chứng chỉ
// + email PH + care task nhưng CŨNG KHÔNG ghi `Enrollment.status`. Nên kể cả đi
// đúng đường cấp chứng chỉ, em vẫn hiện "Đang học". Chỗ duy nhất trong repo đặt
// Enrollment → COMPLETED là dialog đổi trạng thái thủ công ở /admin/enrollments.
//
// Hàm này đóng CẢ HAI: một cổng duy nhất làm trọn gói (chốt 22/09/2026) —
// ghi danh → COMPLETED, cấp chứng chỉ, gửi email PH, tạo care task tái tục.
// Dropdown không còn chọn được "Hoàn thành" (xem guard trong `updateClass`).

/** Kết quả trả về đủ chi tiết để câu thông báo nói THẬT em nào được/không được. */
export type CompleteClassResult =
  | {
      ok: true;
      /** Số ghi danh vừa chuyển sang "Hoàn thành". */
      completed: number;
      /** Nhóm bị bỏ qua (bảo lưu / chưa vào học), gộp theo trạng thái. */
      skipped: SkippedGroup[];
      /** Chứng chỉ mới cấp trong lượt này. */
      certIssued: number;
      /** Em đã có chứng chỉ khoá này từ trước → bỏ qua, KHÔNG gửi lại email. */
      certAlready: number;
    }
  | { ok: false; error: string };

export async function completeClassAction(classId: string): Promise<CompleteClassResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  // HAI cổng, không phải một. Hành động này vừa ĐÓNG LỚP (`classes:edit`) vừa CẤP
  // CHỨNG CHỈ + GỬI EMAIL PHỤ HUYNH (`completions:manage`) — đúng hai quyền mà form
  // sửa lớp và /hoan-thanh-khoa đang gác riêng lẻ. Fail-closed vì hai quyền này
  // KHÔNG trùng vai: Đào tạo (TRAINING) có `classes:edit` nhưng KHÔNG có
  // `completions:manage`; Giáo viên thì ngược lại. Thiếu một bên mà vẫn chạy là
  // hoặc đóng lớp không chứng chỉ, hoặc phát chứng chỉ cho lớp mình không quản.
  const [canEditClass, canIssueCert] = await Promise.all([
    checkPermission("classes:edit"),
    checkPermission("completions:manage"),
  ]);
  if (!canEditClass) return { ok: false, error: "Không có quyền hoàn thành lớp" };
  if (!canIssueCert) {
    return {
      ok: false,
      error:
        "Hoàn thành lớp sẽ cấp chứng chỉ và gửi email phụ huynh — cần quyền xác nhận hoàn thành khoá. Nhờ quản lý cơ sở thực hiện.",
    };
  }

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const cls = await sdb.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: { id: true, name: true, status: true, centerId: true },
  });
  if (!cls) return { ok: false, error: "Lớp không tồn tại" };

  // Cách ly cơ sở: chỉ đóng lớp trong tầm nhìn actor (chống IDOR cascade liên cơ sở).
  if (!passesScope("Class", { centerId: cls.centerId }, actor)) {
    return { ok: false, error: "Lớp không tồn tại" };
  }

  if (cls.status === "COMPLETED") return { ok: false, error: "Lớp đã hoàn thành" };
  if (cls.status === "CANCELLED") {
    return { ok: false, error: "Lớp đã huỷ — không thể hoàn thành" };
  }
  // Duyệt lớp là một cổng có chữ ký (`approvedById`). Cho lớp đang chờ duyệt nhảy
  // thẳng sang "Hoàn thành" là đi vòng qua cổng đó và để lại lớp xong-mà-chưa-ai-duyệt.
  if (cls.status === "PENDING_APPROVAL") {
    return {
      ok: false,
      error:
        "Lớp đang chờ duyệt — duyệt (hoặc trả lại) ở khối Phê duyệt lớp trước khi hoàn thành.",
    };
  }

  const rows = await sdb.enrollment.findMany({
    where: {
      classId,
      deletedAt: null,
      status: { in: CLASS_CLOSE_ENROLLMENT_STATUSES },
    },
    select: {
      id: true,
      status: true,
      studentId: true,
      courseId: true,
      student: { select: { name: true } },
    },
  });

  const { eligible, skipped } = splitEnrollmentsForCompletion(rows);

  // ── Bước 1: CHỨNG CHỈ TRƯỚC, đổi trạng thái SAU ─────────────────────────────
  //
  // Thứ tự này KHÔNG tuỳ tiện — nó quyết định lượt chạy hỏng nửa chừng có tự chữa
  // được không.
  //   · Đổi trạng thái trước rồi cấp chứng chỉ: em nào lỗi sẽ mang `COMPLETED` mà
  //     không có chứng chỉ, VÀ biến mất khỏi /hoan-thanh-khoa (trang đó chỉ liệt kê
  //     ghi danh còn active — `ENROLLMENT_ACTIVE_STATUS_LIST`, page.tsx:172). Hỏng
  //     câm, không còn đường sửa bằng giao diện.
  //   · Cấp chứng chỉ trước: lỗi ở bước này thì CHƯA có gì đổi — lớp vẫn đang dạy,
  //     em vẫn "Đang học", /hoan-thanh-khoa vẫn thấy đủ, bấm lại là chạy tiếp.
  //     `completeCourse` idempotent theo `studentId_courseId` nên lượt sau bỏ qua em
  //     đã có chứng chỉ (không gửi lại email).
  //
  // Và vì thế: MỘT em lỗi là DỪNG CẢ LƯỢT, không đóng lớp. Đóng lớp rồi mới báo
  // "3 em chưa có chứng chỉ" là đúng cái bẫy vừa mô tả.
  let certIssued = 0;
  let certAlready = 0;

  for (const enr of eligible) {
    const who = enr.student?.name ?? enr.studentId;
    try {
      // `CourseCompletion` KHÔNG thuộc SCOPED_MODELS (chỉ `CourseCompletionRequest`
      // có), nên findUnique ở đây không bị lọc hậu kỳ theo cơ sở — đọc được đúng
      // bản ghi đã có. Bỏ kiểm này là `completeCourse` đi nhánh update của upsert và
      // GỬI LẠI email chúc mừng cho phụ huynh em đã nhận chứng chỉ từ lâu.
      const existing = await sdb.courseCompletion.findUnique({
        where: { studentId_courseId: { studentId: enr.studentId, courseId: enr.courseId } },
        select: { id: true },
      });
      if (existing) {
        certAlready += 1;
        continue;
      }
      const res = await completeCourse({
        studentId: enr.studentId,
        courseId: enr.courseId,
        classId,
        createdById: session.user.id,
      });
      if (!res.ok) {
        return {
          ok: false,
          error: `Chưa đóng lớp — lỗi cấp chứng chỉ cho ${who}: ${res.error ?? "lỗi không rõ"}. Đã cấp ${certIssued} em; xử lý xong rồi bấm lại (em đã có chứng chỉ sẽ được bỏ qua).`,
        };
      }
      certIssued += 1;
    } catch (err) {
      return {
        ok: false,
        error: `Chưa đóng lớp — lỗi cấp chứng chỉ cho ${who}: ${err instanceof Error ? err.message : "Unknown"}. Đã cấp ${certIssued} em; bấm lại để chạy tiếp.`,
      };
    }
  }

  // ── Bước 2: đóng lớp + chuyển ghi danh, ATOMIC ──────────────────────────────
  const { actorId, actorName } = getAuditActor(session);
  const changedByUserId = session.user.id ?? null;
  const changedByName = session.user.name ?? session.user.email ?? session.user.id;
  const now = new Date();
  const completeReason = `[Hoàn thành lớp] ${cls.name}`;

  try {
    await sdb.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as Prisma.TransactionClient;

      // a) Lớp → COMPLETED.
      await tx.class.update({ where: { id: classId }, data: { status: "COMPLETED" } });

      // b) Ghi danh đang học → COMPLETED (guard state machine như nhánh huỷ lớp).
      for (const enr of eligible) {
        // `canTransition` luôn true với STUDYING/ACTIVE → COMPLETED; ca [CLC-04]
        // giữ cho COMPLETABLE_ENROLLMENT_STATUSES không lệch khỏi bảng chuyển.
        if (!canTransition(enr.status as EnrollmentStatus, "COMPLETED")) continue;

        await tx.enrollment.update({
          where: { id: enr.id },
          data: { status: "COMPLETED", endedAt: now },
        });

        await tx.enrollmentAuditLog.create({
          data: {
            enrollmentId: enr.id,
            fromStatus: enr.status,
            toStatus: "COMPLETED",
            changedByUserId,
            changedByName,
            reason: completeReason,
          },
        });
        // AuditLog hợp nhất cho viewer chung (atomic).
        await writeAudit({
          actor: { id: actorId, name: actorName },
          module: "enrollment",
          entityType: "Enrollment",
          entityId: enr.id,
          action: "STATUS_CHANGE",
          oldValues: { status: enr.status },
          newValues: { status: "COMPLETED" },
          reason: completeReason,
          orgUnitId: cls.centerId,
          tx,
        });
      }

      // c) Audit cho chính lớp.
      await logClassAudit({
        classId,
        action: "UPDATE",
        actorId,
        actorName,
        oldValues: { status: cls.status },
        newValues: { status: "COMPLETED" },
        changedFields: ["status"],
        reason: completeReason,
        tx,
      });

      // US-03 chat — lớp COMPLETED → nhóm lớp archive, cùng transaction (như updateClass).
      await syncConversationMembership(tx, classId);
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi hoàn thành lớp: ${err instanceof Error ? err.message : "Unknown"}`,
    };
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${classId}`);
  revalidatePath(`/classes/${classId}/edit`);
  revalidatePath("/enrollments");
  revalidatePath("/hoan-thanh-khoa");
  revalidatePath("/students");
  revalidatePath("/dashboard");
  return { ok: true, completed: eligible.length, skipped, certIssued, certAlready };
}
