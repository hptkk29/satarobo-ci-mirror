import { TRANG_THAI_CHO_QUAN_LY } from "@/lib/work-request";
import { db } from "@/lib/db";
import { hasRole, type Action, type CanUser } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/auth/actor";
import { evaluatePermission } from "@/lib/auth/permission-eval";
import { recordPermissionShadow } from "@/lib/auth/shadow-report";
import { isRbacV2Enabled, isCenterChecklistEnabled, isElearningEnabled } from "@/lib/flags";
import { elearningHomeUrl } from "@/lib/auth/hosts";
import { isChecklistComplete } from "@/lib/center-checklist";
import { getNearingEndEnrollments } from "@/lib/students/renewal";
import { getSetting } from "@/lib/settings/service";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { normalizePeriodComments } from "@/lib/lms/report-card-core";
import {
  REPORT_CARD_MILESTONES,
  milestoneLabel,
  missingMilestoneComments,
} from "@/lib/lms/report-card-milestone";
import { formatDateVN } from "@/lib/format/date";
import { attachDeadlines } from "@/lib/lms/media-review-deadline-config";
import { groupPendingMedia, pickOverdueFolders } from "@/lib/lms/media-review-overdue";
import { WR_KIND_LABEL, type WorkRequestKindV } from "@/lib/work-request";
import {
  formatDayKeyDMY,
  shiftDayKey,
  vnDayKey,
  vnDayStartUtc,
} from "@/lib/students/birthday-dates";

// =============================================================================
// MODULE TRUNG TÂM PHÊ DUYỆT & NHẮC VIỆC — PHẦN 1
// getPendingTasks(user) gom MỌI loại "việc cần xử lý" từ các module khác, lọc
// theo QUYỀN + CƠ SỞ của user. Mỗi loại: { type, label, count, overdueCount,
// href, items[] }. Chỉ trả về loại việc thuộc quyền user.
// =============================================================================

export type PendingTaskType =
  | "class_approval"
  | "timesheet_adjust"
  | "parent_request"
  | "media_approval"
  | "session_incomplete"
  | "center_checklist"
  | "lead_followup"
  | "renewal"
  | "student_risk"
  | "student_care"
  | "student_birthday"
  | "class_no_teacher"
  | "registered_stale"
  | "report_card_milestone"
  | "elearning_due";

export interface PendingTaskItem {
  id: string;
  label: string;
  href: string;
  overdue?: boolean;
}

export interface PendingTaskGroup {
  type: PendingTaskType;
  label: string;
  count: number;
  overdueCount: number;
  href: string;
  items: PendingTaskItem[];
}

export type TaskUser = CanUser & {
  id: string;
  centerId?: string | null;
};

/** Tham số hiển thị/ngưỡng quá hạn, resolve từ SystemSetting (dashboard.*). */
interface PendingCfg {
  itemLimit: number;
  staleMs: number;
  /** Số ngày báo trước buổi tổ chức sinh nhật (SystemSetting student.birthdayAlertDaysBefore). */
  birthdayAlertDays: number;
  /**
   * Kiểm quyền THEO CỜ `RBAC_V2_ENABLED` + sinh shadow-diff.
   *
   * Trước đây file này gọi thẳng `can()` matrix v1 ⇒ (a) không sinh dòng shadow nào nên
   * lệch v1↔v2 ở đây chưa từng được kiểm, (b) sau flip #09 vẫn lọc nhóm việc theo v1.
   * Không dùng `checkPermission()` vì nó tự gọi `auth()`+`resolveActor()` — 9 lần/request
   * và làm hàm mất tính thuần. Thay vào đó caller resolve `Actor` MỘT lần rồi truyền vào.
   */
  can: (action: Action) => boolean;
  /** Kiểm quyền CÓ target cơ sở — cho nhóm việc gác bằng action scope CENTER (rbac-scope R1). */
  canAt: (action: Action, centerId: string) => boolean;
}

/** Đóng gói `evaluatePermission` + ghi shadow (fire-and-forget) cho 1 request. */
function makePermChecker(user: TaskUser, actor: Actor): (action: Action, centerId?: string) => boolean {
  const flagOn = isRbacV2Enabled();
  return (action, centerId) =>
    evaluatePermission({
      sessionUser: user,
      actor,
      action,
      target: centerId ? { centerId } : undefined,
      flagOn,
      onEvaluated: ({ v1, v2 }) => {
        if (v1 !== v2) {
          void recordPermissionShadow({ action, userId: actor.userId, v1, v2, targetKey: centerId ?? null });
        }
      },
    });
}

/** Câu 08 — SLA xử lý yêu cầu phụ huynh: 12 giờ. */
const PARENT_REQUEST_SLA_MS = 12 * 60 * 60 * 1000;
/** Câu 38 — khách đã đăng ký (REGISTERED) chưa convert quá lâu → nhắc chốt ghi danh. */
const REGISTERED_STALE_DAYS = 3;
const REGISTERED_STALE_MS = REGISTERED_STALE_DAYS * 86_400_000;

function scope(user: TaskUser) {
  const isSuper = hasRole(user, "SUPER_ADMIN");
  const isCM = hasRole(user, "CENTER_MANAGER");
  const isManager = isSuper || isCM;
  // CM (không kèm SUPER_ADMIN) → giới hạn cơ sở mình; còn lại null = mọi cơ sở.
  const centerScope = isCM && !isSuper ? (user.centerId ?? null) : null;
  return { isSuper, isCM, isManager, centerScope };
}

// ─── Từng nguồn việc ─────────────────────────────────────────────────────────

async function classApproval(user: TaskUser, now: Date, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  const { isManager, centerScope } = scope(user);
  if (!isManager) return null;
  const twoDaysAgo = new Date(now.getTime() - cfg.staleMs);

  const rows = await db.class.findMany({
    where: { status: "PENDING_APPROVAL", deletedAt: null, ...(centerScope ? { centerId: centerScope } : {}) },
    select: { id: true, name: true, classCode: true, submittedForApprovalAt: true },
    orderBy: { submittedForApprovalAt: "asc" },
    take: 50,
  });
  const overdueCount = rows.filter((r) => r.submittedForApprovalAt && r.submittedForApprovalAt < twoDaysAgo).length;
  return {
    type: "class_approval",
    label: "Lớp chờ duyệt",
    count: rows.length,
    overdueCount,
    href: "/classes?status=PENDING_APPROVAL",
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: r.classCode ? `${r.classCode} · ${r.name}` : r.name,
      href: `/classes/${r.id}/edit`,
      overdue: !!r.submittedForApprovalAt && r.submittedForApprovalAt < twoDaysAgo,
    })),
  };
}

/**
 * L5 chấm công v3 (06/09/2026) — ĐƠN TỪ chờ duyệt (WorkRequest), thay nhóm "Yêu cầu chỉnh công"
 * cũ (TimesheetAdjustmentRequest — đã đóng băng, màn /cham-cong/chinh-cong đã gỡ). Gác bằng
 * `hr_attendance:approve` CÓ target từng cơ sở nhìn thấy (action scope CENTER — gọi trần là
 * QLCS tự khoá mình, rbac-scope R1). Giữ key nhóm `timesheet_adjust` để pending-sync/badge cũ
 * không đổi.
 */
async function timesheetAdjust(user: TaskUser, now: Date, cfg: PendingCfg, actor: Actor): Promise<PendingTaskGroup | null> {
  const centerIds = [...new Set([...actor.visibleCenterIds, "hoi-so"])].filter((c) => cfg.canAt("hr_attendance:approve", c));
  if (centerIds.length === 0) return null;
  const twoDaysAgo = new Date(now.getTime() - cfg.staleMs);

  const rows = await db.workRequest.findMany({
    where: { status: { in: [...TRANG_THAI_CHO_QUAN_LY] }, centerId: { in: centerIds } },
    select: { id: true, kind: true, fromDate: true, createdAt: true, submittedLate: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const overdueCount = rows.filter((r) => r.createdAt < twoDaysAgo).length;
  return {
    type: "timesheet_adjust",
    label: "Đơn từ chờ duyệt",
    count: rows.length,
    overdueCount,
    href: "/don-tu",
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: `${WR_KIND_LABEL[r.kind as WorkRequestKindV] ?? r.kind}${r.fromDate ? ` ${formatDateVN(r.fromDate)}` : ""}${r.submittedLate ? " (nộp muộn)" : ""}`,
      href: "/don-tu",
      overdue: r.createdAt < twoDaysAgo,
    })),
  };
}

async function parentRequest(user: TaskUser, now: Date, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  if (!cfg.can("parent-requests:manage")) return null;
  const { centerScope } = scope(user);
  // Câu 08 — SLA yêu cầu phụ huynh là 12h (KHÔNG dùng staleDays chung của dashboard).
  const staleBefore = new Date(now.getTime() - PARENT_REQUEST_SLA_MS);

  const rows = await db.parentRequest.findMany({
    where: { status: "PENDING", ...(centerScope ? { student: { centerId: centerScope } } : {}) },
    select: { id: true, type: true, createdAt: true, student: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const overdueCount = rows.filter((r) => r.createdAt < staleBefore).length;
  return {
    type: "parent_request",
    label: "Yêu cầu phụ huynh",
    count: rows.length,
    overdueCount,
    href: "/parent-requests",
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: `${r.student.name} — ${r.type}`,
      href: r.type === "ABSENCE" ? "/parent-requests/bao-vang" : r.type === "MAKEUP" ? "/hoc-bu" : "/parent-requests",
      overdue: r.createdAt < staleBefore,
    })),
  };
}

/**
 * F-21 — id ảnh đang QUÁ HẠN duyệt, theo hạn thật của F-20 (10h sáng ngày hôm sau
 * NGÀY DẠY, đặt được theo từng cơ sở).
 *
 * Trước đây chỗ này dùng ngưỡng chung của dashboard ("nằm chờ quá `staleDays` kể từ
 * lúc TẢI LÊN"). Hai mốc lệch nhau cả hai chiều, và mốc cũ còn bỏ sót đúng ca hay
 * gặp nhất: giáo viên tải ảnh lên muộn cho buổi tuần trước — hạn của buổi đó đã trôi
 * từ lâu, nhưng vì mới tải lên nên bị coi là "còn 2 ngày nữa mới trễ".
 *
 * Hỏng ở đây KHÔNG được làm chết cả cái chuông (hàm này nằm trong `Promise.all` của
 * 15 nguồn việc) → mọi lỗi rơi về ngưỡng cũ thay vì ném lên.
 */
async function mediaOverdueIds(
  rows: readonly {
    id: string;
    classId: string;
    classSessionId: string | null;
    takenAt: Date | null;
    createdAt: Date;
  }[],
  now: Date,
  staleMs: number,
): Promise<Set<string>> {
  try {
    const sessionIds = [
      ...new Set(rows.map((r) => r.classSessionId).filter((v): v is string => !!v)),
    ];
    const sessions = sessionIds.length
      ? await db.classSession.findMany({
          where: { id: { in: sessionIds } },
          select: { id: true, classId: true, date: true },
        })
      : [];
    const folders = groupPendingMedia(rows, new Map(sessions.map((s) => [s.id, s])));
    const classes = await db.class.findMany({
      // Lớp đã xoá mềm → không tính là quá hạn (ảnh của nó là rác chờ dọn).
      where: { id: { in: [...new Set(folders.map((f) => f.classId))] }, deletedAt: null },
      select: { id: true, centerId: true, orgUnitId: true },
    });
    const quaHan = pickOverdueFolders(
      await attachDeadlines(folders, new Map(classes.map((c) => [c.id, c]))),
      now,
    );
    return new Set(quaHan.flatMap((f) => f.mediaIds));
  } catch (err) {
    console.warn("[pending-tasks] không tính được hạn duyệt ảnh — dùng ngưỡng cũ:", err);
    const cutoff = now.getTime() - staleMs;
    return new Set(rows.filter((r) => r.createdAt.getTime() < cutoff).map((r) => r.id));
  }
}

async function mediaApproval(user: TaskUser, now: Date, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  if (!cfg.can("media:approve")) return null;
  const { centerScope } = scope(user);

  // ClassSessionMedia.classId là cột phẳng → lọc cơ sở qua tập classId trong cơ sở.
  let classFilter: { classId: { in: string[] } } | undefined;
  if (centerScope) {
    const classes = await db.class.findMany({ where: { centerId: centerScope, deletedAt: null }, select: { id: true } });
    classFilter = { classId: { in: classes.map((c) => c.id) } };
  }
  const rows = await db.classSessionMedia.findMany({
    where: { status: "PENDING", ...(classFilter ?? {}) },
    select: {
      id: true,
      fileName: true,
      classId: true,
      classSessionId: true,
      takenAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const quaHan = await mediaOverdueIds(rows, now, cfg.staleMs);
  return {
    type: "media_approval",
    label: "Ảnh chờ duyệt",
    count: rows.length,
    overdueCount: rows.filter((r) => quaHan.has(r.id)).length,
    href: "/media",
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: r.fileName ?? "Ảnh lớp học",
      href: "/media",
      overdue: quaHan.has(r.id),
    })),
  };
}

async function sessionIncomplete(user: TaskUser, now: Date, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  const { isManager, centerScope } = scope(user);
  if (!isManager) return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const rows = await db.classSession.findMany({
    where: {
      date: { lt: startOfToday },
      status: { not: "COMPLETED" },
      ...(centerScope ? { class: { centerId: centerScope } } : {}),
    },
    select: { id: true, date: true, class: { select: { name: true, classCode: true } } },
    orderBy: { date: "desc" },
    take: 50,
  });
  return {
    type: "session_incomplete",
    label: "Buổi học chưa hoàn tất",
    count: rows.length,
    overdueCount: rows.length, // quá ngày mà chưa xong → đều quá hạn
    href: "/sessions",
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: `${r.class.classCode ? `${r.class.classCode} · ` : ""}${r.class.name} (${formatDateVN(r.date)})`,
      href: `/sessions/${r.id}`,
      overdue: true,
    })),
  };
}

/**
 * #17 Gap 1 (câu 55) — GV viết đánh giá kỳ ở BUỔI 5 và BUỔI 12.
 *
 * "Đạt buổi N" = lớp đã có N buổi COMPLETED (ClassSession không có số thứ tự buổi;
 * buổi CANCELLED không tính vì buổi bù là ClassSession riêng). Việc chưa xong = mốc đã
 * đạt nhưng `ReportCard.periodComments` chưa có nhận xét cho kỳ đó.
 *
 * Phạm vi: GV thấy lớp MÌNH dạy (teacher/assistant); quản lý thấy lớp trong cơ sở mình.
 * Không gate theo action — đây là "việc của tôi", lọc bằng quyền sở hữu lớp.
 */
async function reportCardMilestone(user: TaskUser, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  const { isManager, centerScope } = scope(user);
  const isTeacher = hasRole(user, "TEACHER");
  if (!isManager && !isTeacher) return null;

  const classWhere = isManager
    ? { deletedAt: null, ...(centerScope ? { centerId: centerScope } : {}) }
    : { deletedAt: null, OR: [{ teacherId: user.id }, { assistantId: user.id }] };

  const classes = await db.class.findMany({
    where: classWhere,
    select: {
      id: true,
      name: true,
      classCode: true,
      _count: { select: { sessions: { where: { status: "COMPLETED" } } } },
    },
    take: 100,
  });

  const minMilestone = REPORT_CARD_MILESTONES[0];
  const reached = classes.filter((c) => c._count.sessions >= minMilestone);
  if (reached.length === 0) return null;

  const enrollments = await db.enrollment.findMany({
    // `ACTIVE` là status LEGACY; workflow D5 dùng CONFIRMED/STUDYING/PAUSED. Lọc "ACTIVE"
    // trần sẽ bỏ sót gần hết ghi danh thật → dùng đúng hằng số chung.
    // FIX A2: soft-delete chỉ set deletedAt (status GIỮ NGUYÊN) → thiếu deletedAt: null là
    // GV bị nhắc viết học bạ cho HV đã xoá khỏi lớp.
    where: {
      classId: { in: reached.map((c) => c.id) },
      status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
      deletedAt: null,
    },
    select: { id: true, classId: true, student: { select: { name: true } } },
  });
  if (enrollments.length === 0) return null;

  // ReportCard là ref phẳng (enrollmentId @unique, không có relation) → query riêng.
  const cards = await db.reportCard.findMany({
    where: { enrollmentId: { in: enrollments.map((e) => e.id) } },
    select: { enrollmentId: true, periodComments: true },
  });
  const commentsByEnrollment = new Map(
    cards.map((c) => [c.enrollmentId, normalizePeriodComments(c.periodComments)]),
  );
  const completedByClass = new Map(reached.map((c) => [c.id, c._count.sessions]));
  const classById = new Map(reached.map((c) => [c.id, c]));

  const items: PendingTaskItem[] = [];
  for (const e of enrollments) {
    const completed = completedByClass.get(e.classId) ?? 0;
    const missing = missingMilestoneComments(completed, commentsByEnrollment.get(e.id) ?? []);
    for (const m of missing) {
      const cls = classById.get(e.classId)!;
      items.push({
        id: `${e.id}:${m}`,
        label: `${cls.classCode ? `${cls.classCode} · ` : ""}${e.student.name} — ${milestoneLabel(m)}`,
        href: `/report-cards/${e.id}`,
        // Buổi 12 mà chưa viết kỳ buổi 5 → trễ hẳn một kỳ.
        overdue: completed >= REPORT_CARD_MILESTONES[REPORT_CARD_MILESTONES.length - 1],
      });
    }
  }
  if (items.length === 0) return null;

  return {
    type: "report_card_milestone",
    label: "Học bạ kỳ chưa viết (buổi 5 / buổi 12)",
    count: items.length,
    overdueCount: items.filter((i) => i.overdue).length,
    href: "/report-cards",
    items: items.slice(0, cfg.itemLimit),
  };
}

async function centerChecklist(user: TaskUser, now: Date, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  // 20/08 — tính năng checklist cơ sở đã GỠ (cờ mặc định OFF, xem `lib/flags.ts`).
  // Trả `null` = hợp đồng chung của mọi hàm trong file này ("không có việc loại này") ⇒ khối
  // "Checklist cơ sở hôm qua" tự biến mất khỏi dashboard và chuông tự đánh dấu ĐÃ ĐỌC thông
  // báo cũ, không phải sửa chỗ render.
  // Chốt đặt TRƯỚC mọi truy vấn: hàm này quét toàn bộ Center + CenterDayChecklist mỗi lần
  // dựng dashboard/mở chuông — giữ lại là tốn 2 query cho một nhóm chắc chắn bị vứt.
  if (!isCenterChecklistEnabled()) return null;

  const { isManager, centerScope } = scope(user);
  if (!isManager) return null;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

  const centers = centerScope
    ? await db.center.findMany({ where: { id: centerScope }, select: { id: true, name: true } })
    : await db.center.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  if (centers.length === 0) return { type: "center_checklist", label: "Checklist cơ sở hôm qua", count: 0, overdueCount: 0, href: "/cham-cong/checklist-co-so", items: [] };

  const checklists = await db.centerDayChecklist.findMany({
    where: { date: yesterday, centerId: { in: centers.map((c) => c.id) } },
  });
  const complete = new Set(checklists.filter((c) => isChecklistComplete(c)).map((c) => c.centerId));
  const missing = centers.filter((c) => !complete.has(c.id));
  return {
    type: "center_checklist",
    label: "Checklist cơ sở hôm qua",
    count: missing.length,
    overdueCount: missing.length,
    href: "/cham-cong/checklist-co-so",
    items: missing.slice(0, cfg.itemLimit).map((c) => ({
      id: c.id,
      label: `${c.name} — chưa hoàn tất`,
      href: "/cham-cong/checklist-co-so",
      overdue: true,
    })),
  };
}

async function leadFollowup(user: TaskUser, now: Date, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  const canAll = cfg.can("leads:view-all");
  const canOwn = cfg.can("leads:view-own");
  if (!canAll && !canOwn) return null;
  const { isSuper, isCM } = scope(user);
  const centerScope = isCM && !isSuper ? (user.centerId ?? null) : null;
  // SALES_CSM (chỉ view-own) → lead của mình.
  const selfOnly = !canAll && canOwn;

  const baseWhere = {
    deletedAt: null,
    ...(selfOnly ? { assignedToId: user.id } : centerScope ? { centerId: centerScope } : {}),
  };

  const [newLeads, overdueLeads, items] = await Promise.all([
    db.lead.count({ where: { ...baseWhere, status: "MOI" } }),
    db.lead.count({ where: { ...baseWhere, tasks: { some: { status: "OPEN", dueAt: { lt: now } } } } }),
    db.lead.findMany({
      where: {
        ...baseWhere,
        OR: [{ status: "MOI" }, { tasks: { some: { status: "OPEN", dueAt: { lt: now } } } }],
      },
      select: { id: true, parentName: true, status: true },
      orderBy: { createdAt: "asc" },
      take: cfg.itemLimit,
    }),
  ]);
  const count = newLeads + overdueLeads;
  if (count === 0 && items.length === 0) {
    return { type: "lead_followup", label: "Lead cần xử lý", count: 0, overdueCount: 0, href: "/leads", items: [] };
  }
  return {
    type: "lead_followup",
    label: "Lead cần xử lý",
    count,
    overdueCount: overdueLeads,
    href: "/leads",
    items: items.map((l) => ({
      id: l.id,
      label: `${l.parentName}${l.status === "MOI" ? " (mới)" : ""}`,
      href: `/leads/${l.id}`,
    })),
  };
}

async function renewal(user: TaskUser, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  const canAll = cfg.can("enrollments:view-all");
  if (!canAll && !cfg.can("enrollments:view-own")) return null;
  const { isSuper, isCM } = scope(user);
  const centerScope = isCM && !isSuper ? (user.centerId ?? null) : null;

  const list = await getNearingEndEnrollments({ centerId: centerScope });
  const overdueCount = list.filter((i) => i.remaining <= 2).length;
  return {
    type: "renewal",
    label: "Học viên sắp hết khoá",
    count: list.length,
    overdueCount,
    href: "/enrollments?tab=sap-het-khoa",
    items: list.slice(0, cfg.itemLimit).map((i) => ({
      id: i.enrollmentId,
      label: `${i.studentName} — còn ${i.remaining} buổi`,
      href: `/students/${i.studentId}/edit`,
      overdue: i.remaining <= 2,
    })),
  };
}

async function studentRisk(user: TaskUser, now: Date, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  const { isManager, centerScope } = scope(user);
  if (!isManager) return null;
  const twoDaysAgo = new Date(now.getTime() - cfg.staleMs);
  const rows = await db.studentRiskAlert.findMany({
    where: { status: "OPEN", ...(centerScope ? { centerId: centerScope } : {}) },
    select: { id: true, type: true, severity: true, createdAt: true, student: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const overdueCount = rows.filter((r) => r.severity === "HIGH" || r.createdAt < twoDaysAgo).length;
  return {
    type: "student_risk",
    label: "Cảnh báo rủi ro HV",
    count: rows.length,
    overdueCount,
    href: "/canh-bao-rui-ro",
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: `${r.student.name} — ${r.type}`,
      href: `/students/${r.student.id}/edit`,
      overdue: r.severity === "HIGH",
    })),
  };
}

async function studentCare(user: TaskUser, now: Date, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  const { isSuper, isCM } = scope(user);
  const isSales = hasRole(user, "SALES_CSM");
  if (!isSuper && !isCM && !isSales) return null;
  const centerScope = isCM && !isSuper ? (user.centerId ?? null) : null;
  // SALES (không quản lý) → task của mình; CM → cơ sở; super → tất cả.
  const where = isSales && !isSuper && !isCM
    ? { status: "OPEN" as const, assignedToId: user.id }
    : { status: "OPEN" as const, ...(centerScope ? { centerId: centerScope } : {}) };

  const rows = await db.studentCareTask.findMany({
    where,
    select: { id: true, title: true, dueAt: true, student: { select: { id: true } } },
    orderBy: { dueAt: "asc" },
    take: 50,
  });
  const overdueCount = rows.filter((r) => r.dueAt < now).length;
  return {
    type: "student_care",
    label: "Việc chăm sóc HV",
    count: rows.length,
    overdueCount,
    href: "/cham-soc-hv",
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: r.title,
      href: `/students/${r.student.id}/edit`,
      overdue: r.dueAt < now,
    })),
  };
}

/**
 * Sinh nhật học viên sắp tới hạn tổ chức (06/08/2026).
 *
 * Mốc là `celebrationDate` — NGÀY BUỔI TỔ CHỨC, không phải ngày sinh nhật: hôm sinh
 * nhật không có lớp thì buổi tổ chức rơi TRƯỚC đó, bám ngày sinh nhật là hiện việc
 * sau khi buổi đã tan.
 *
 * `overdue` = buổi tổ chức đã qua mà chưa ai bấm "Đã chúc" — tức lỡ mất buổi, phải
 * chăm sóc bù bằng cách khác.
 */
async function studentBirthday(
  user: TaskUser,
  now: Date,
  cfg: PendingCfg,
): Promise<PendingTaskGroup | null> {
  const { isSuper, isCM } = scope(user);
  const isSales = hasRole(user, "SALES_CSM");
  if (!isSuper && !isCM && !isSales) return null;
  const centerScope = isCM && !isSuper ? (user.centerId ?? null) : null;

  const todayKey = vnDayKey(now);
  const rows = await db.studentBirthdayGreeting.findMany({
    where: {
      celebratedAt: null,
      celebrationDate: {
        // Lùi tối đa cfg.staleMs để việc đã lỡ còn hiện (nhắc chăm sóc bù), nhưng
        // không kéo lê sinh nhật của cả tháng trước lên bảng việc.
        gte: new Date(now.getTime() - cfg.staleMs),
        lt: vnDayStartUtc(shiftDayKey(todayKey, cfg.birthdayAlertDays + 1)),
      },
      ...(centerScope ? { centerId: centerScope } : {}),
    },
    select: {
      id: true,
      celebrationDate: true,
      birthdayDate: true,
      student: { select: { id: true, name: true } },
    },
    orderBy: { celebrationDate: "asc" },
    take: 50,
  });
  if (rows.length === 0) return null;

  const overdueCount = rows.filter(
    (r) => r.celebrationDate !== null && vnDayKey(r.celebrationDate) < todayKey,
  ).length;

  return {
    type: "student_birthday",
    label: "Sinh nhật học viên",
    count: rows.length,
    overdueCount,
    href: "/sinh-nhat",
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: `${r.student.name} — sinh nhật ${formatDayKeyDMY(vnDayKey(r.birthdayDate))}`,
      href: "/sinh-nhat",
      overdue: r.celebrationDate !== null && vnDayKey(r.celebrationDate) < todayKey,
    })),
  };
}

async function classNoTeacher(user: TaskUser, now: Date, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  const { isManager, centerScope } = scope(user);
  if (!isManager) return null;
  // Buổi NGÀY MAI chưa có GV (class.teacherId null) và không có GV thực/dạy-thay.
  const startTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const endTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

  const rows = await db.classSession.findMany({
    where: {
      date: { gte: startTomorrow, lt: endTomorrow },
      status: { not: "CANCELLED" },
      actualTeacherId: null,
      substituteTeacherId: null,
      // Lọc lớp chưa gán GV + cách ly cơ sở qua class.centerId (ClassSession gắn lớp).
      class: { teacherId: null, deletedAt: null, ...(centerScope ? { centerId: centerScope } : {}) },
    },
    select: { id: true, date: true, class: { select: { name: true, classCode: true } } },
    orderBy: { date: "asc" },
    take: 50,
  });
  return {
    type: "class_no_teacher",
    label: "Lớp thiếu GV ngày mai",
    count: rows.length,
    overdueCount: rows.length, // ngày mai đã thiếu GV → cần xử lý gấp
    href: "/sessions",
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: `${r.class.classCode ? `${r.class.classCode} · ` : ""}${r.class.name} (${formatDateVN(r.date)})`,
      href: `/sessions/${r.id}`,
      overdue: true,
    })),
  };
}

async function registeredStale(user: TaskUser, now: Date, cfg: PendingCfg): Promise<PendingTaskGroup | null> {
  // Câu 38 — khách đã "Đã đăng ký" (DA_DANG_KY) nhưng chưa chốt ghi danh quá lâu.
  // GĐ5 — DA_DANG_KY nay gộp cả ENROLLED cũ, nên tập này KHÔNG còn thuần "chưa chốt":
  // lead đã convert xong vẫn mang DA_DANG_KY và sẽ lọt vào nhóm tồn đọng. Xem ghi chú
  // ở `where` bên dưới — đã lọc thêm `convertedAt: null` để giữ đúng nghĩa "câu 38".
  const canAll = cfg.can("leads:view-all");
  const canOwn = cfg.can("leads:view-own");
  if (!canAll && !canOwn) return null;
  const { isSuper, isCM } = scope(user);
  const centerScope = isCM && !isSuper ? (user.centerId ?? null) : null;
  const selfOnly = !canAll && canOwn; // SALES_CSM (chỉ view-own) → khách của mình.
  const staleBefore = new Date(now.getTime() - REGISTERED_STALE_MS);

  const rows = await db.lead.findMany({
    where: {
      deletedAt: null,
      status: "DA_DANG_KY",
      // GĐ5 — lọc thêm `convertedAt: null`: sau khi gộp ENROLLED vào DA_DANG_KY, không
      // có điều kiện này thì MỌI lead đã chốt ghi danh cũng lên chuông "chưa chốt".
      convertedAt: null,
      // GĐ1 — đo bằng MỐC ĐỔI TRẠNG THÁI THẬT (`statusChangedAt`), không còn dùng
      // `updatedAt` làm proxy. Proxy cũ sai theo hướng nguy hiểm nhất: MỌI thao tác
      // chạm lead (ghi chú, đổi người phụ trách, gắn nguồn giới thiệu) đều dời
      // `updatedAt`, nên lead nằm im hai tuần vẫn không bao giờ lên chuông.
      //
      // Lead cũ có `statusChangedAt` NULL (chưa đổi trạng thái lần nào kể từ GĐ1) —
      // rơi về `updatedAt` để không mất trắng nhóm tồn đọng đang có.
      OR: [
        { statusChangedAt: { lt: staleBefore } },
        { statusChangedAt: null, updatedAt: { lt: staleBefore } },
      ],
      ...(selfOnly ? { assignedToId: user.id } : centerScope ? { centerId: centerScope } : {}),
    },
    select: {
      id: true,
      parentName: true,
      childName: true,
      updatedAt: true,
      statusChangedAt: true,
    },
    orderBy: [{ statusChangedAt: "asc" }, { updatedAt: "asc" }],
    take: 50,
  });
  return {
    type: "registered_stale",
    label: "Khách đã đăng ký quá lâu",
    count: rows.length,
    overdueCount: rows.length,
    // ⚠️ Khớp với `status: "DA_DANG_KY"` của truy vấn ngay trên. Giá trị enum đã chết
    // (?status=REGISTERED) bị màn /leads bỏ qua im lặng ⇒ bấm chuông ra CẢ danh sách.
    href: "/leads?status=DA_DANG_KY",
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: `${r.childName ?? r.parentName} — chưa chốt ghi danh`,
      href: `/leads/${r.id}`,
      overdue: true,
    })),
  };
}

/**
 * Gom mọi loại việc cần xử lý theo quyền + cơ sở của user. Trả về các nhóm
 * (chỉ nhóm user có quyền), sắp xếp nhóm có việc QUÁ HẠN lên đầu.
 */
export async function getPendingTasks(user: TaskUser, actor: Actor): Promise<PendingTaskGroup[]> {
  const now = new Date();
  const [itemLimit, staleDays, birthdayAlertDays] = await Promise.all([
    getSetting("dashboard.pendingItemLimit"),
    getSetting("dashboard.pendingStaleDays"),
    getSetting("student.birthdayAlertDaysBefore"),
  ]);
  const cfg: PendingCfg = {
    itemLimit,
    staleMs: staleDays * 86400000,
    birthdayAlertDays,
    can: makePermChecker(user, actor),
    canAt: makePermChecker(user, actor),
  };
  const groups = await Promise.all([
    classApproval(user, now, cfg),
    timesheetAdjust(user, now, cfg, actor),
    parentRequest(user, now, cfg),
    mediaApproval(user, now, cfg),
    sessionIncomplete(user, now, cfg),
    centerChecklist(user, now, cfg),
    leadFollowup(user, now, cfg),
    renewal(user, cfg),
    studentRisk(user, now, cfg),
    studentCare(user, now, cfg),
    studentBirthday(user, now, cfg),
    classNoTeacher(user, now, cfg),
    reportCardMilestone(user, cfg),
    registeredStale(user, now, cfg),
    elearningDue(user, now, cfg),
  ]);
  return groups
    .filter((g): g is PendingTaskGroup => g !== null)
    .sort((a, b) => b.overdueCount - a.overdueCount || b.count - a.count);
}

/** Tổng số việc + tổng quá hạn (cho badge). */
export function summarizePendingTasks(groups: PendingTaskGroup[]): { total: number; overdue: number } {
  return groups.reduce(
    (acc, g) => ({ total: acc.total + g.count, overdue: acc.overdue + g.overdueCount }),
    { total: 0, overdue: 0 },
  );
}

/**
 * EL-06 — KHOÁ ĐÀO TẠO NỘI BỘ SẮP TỚI HẠN / ĐÃ QUÁ HẠN của CHÍNH người đang xem.
 *
 * ⚠️ Đây là kênh in-app BẮT BUỘC, không phải tiện ích. QĐ-CDA-08 bỏ hẳn Zalo ZNS,
 * nên kênh còn lại là email công ty + in-app — và người không mở email trong ngày
 * thì mốc nhắc T-2 giờ KHÔNG có cách nào chạm tới họ. Chuông là chỗ bù duy nhất.
 *
 * ⚠️ Nhóm này lấy việc của CHÍNH người đang xem, khác mọi nhóm khác trong tệp
 * (vốn là việc quản lý phải duyệt). Lọc theo `userId` chứ không theo cơ sở.
 */
async function elearningDue(
  user: TaskUser,
  now: Date,
  cfg: PendingCfg,
): Promise<PendingTaskGroup | null> {
  if (!isElearningEnabled()) return null;

  // Cửa sổ báo trước 3 ngày: sớm hơn thì việc nằm lì trong chuông cả tuần và
  // người ta quen mắt bỏ qua; muộn hơn thì không kịp học.
  const sapToi = new Date(now.getTime() + 3 * 86400000);

  const rows = await db.trnEnrollment.findMany({
    where: {
      userId: user.id,
      status: { in: ["NOT_STARTED", "IN_PROGRESS", "OVERDUE"] },
      // Đang tạm dừng đồng hồ thì không giục (C4): họ đang nghỉ dài.
      pausedAt: null,
      dueAt: { not: null, lte: sapToi },
    },
    select: { id: true, dueAt: true, courseId: true },
    orderBy: { dueAt: "asc" },
    take: 50,
  });
  if (rows.length === 0) return null;

  const khoa = await db.trnCourse.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.courseId))] } },
    select: { id: true, title: true },
  });
  const ten = new Map(khoa.map((k) => [k.id, k.title]));

  const quaHan = rows.filter((r) => r.dueAt !== null && r.dueAt.getTime() < now.getTime());

  return {
    type: "elearning_due",
    label: "Khoá đào tạo nội bộ tới hạn",
    count: rows.length,
    overdueCount: quaHan.length,
    // Đường dẫn TUYỆT ĐỐI sang host đào tạo: chuông nằm trên host admin/GV, còn
    // khu học ở host khác — đường tương đối sẽ dẫn về đúng site đang đứng.
    href: elearningHomeUrl(),
    items: rows.slice(0, cfg.itemLimit).map((r) => ({
      id: r.id,
      label: ten.get(r.courseId) ?? "Khoá đào tạo",
      href: `${elearningHomeUrl()}/hoc/${r.id}`,
      overdue: r.dueAt !== null && r.dueAt.getTime() < now.getTime(),
    })),
  };
}
