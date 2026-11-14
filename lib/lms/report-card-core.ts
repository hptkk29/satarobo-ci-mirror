// lib/lms/report-card-core.ts — R7-15: PHẦN THUẦN của học bạ ReportCard.
//
// KHÔNG import db / server-only → an toàn dùng trong CLIENT component (editor) lẫn
// server. Chỉ logic + type: máy trạng thái, số liệu (pure), snapshot, T5 scope.
// (Phần đụng DB nằm ở lib/lms/report-card.ts — re-export file này.)
import type { AttendanceSummary } from "@/lib/attendance/summary";
import type { Actor } from "@/lib/auth/actor";

export type ReportCardStatusValue = "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "RECALLED";

export const REPORT_CARD_STATUS_LABEL: Record<ReportCardStatusValue, string> = {
  DRAFT: "Nháp",
  PENDING_REVIEW: "Chờ duyệt",
  PUBLISHED: "Đã phát hành",
  RECALLED: "Đã thu hồi",
};

// ── Số liệu động (live) ──────────────────────────────────────────────────────

/** Tổng hợp bài tập (AssignmentSubmission). */
export interface AssignmentSummary {
  total: number; // tổng bài tập được giao cho học viên (có record submission)
  submitted: number; // đã nộp (SUBMITTED/LATE/GRADED)
  graded: number; // đã chấm điểm
  averageScore: number | null; // điểm TB (chuẩn hoá thang 10) trên các bài đã chấm
}

/** 1 kỹ năng robot ở mức đánh giá MỚI NHẤT. */
export interface ReportCardSkill {
  skill: string; // RoboticsSkill
  level: string; // SkillLevel
}

export interface ReportCardMetrics {
  attendance: AttendanceSummary & { rate: number };
  exams: { count: number; passed: number; averageScore: number | null };
  // LMS-13 (W4-a): field MỚI — OPTIONAL để snapshot CŨ (thiếu field) vẫn parse được.
  assignments?: AssignmentSummary;
  skills?: ReportCardSkill[];
  computedAt: string; // ISO
}

/** Tỉ lệ chuyên cần % (THUẦN — test). */
// Trả về PHẦN TRĂM 0–100 (khác computeAttendanceRate ở attendance-rate.ts trả PHÂN SỐ 0–1).
// Rename để không nhầm 100× — LIB-03.
/**
 * % CHUYÊN CẦN = có mặt / số buổi ĐÃ DIỄN RA.
 *
 * ⚠️ 04/09/2026 — trước đây mẫu số là `att.total` (TỔNG buổi của KHOÁ), nên site phụ
 * huynh đọc 7/12 còn giáo viên/admin đọc 7/11 cho cùng một đứa trẻ cùng một lúc
 * (`lib/progress.ts` vốn đã chia cho buổi đã diễn ra). Tỉ lệ theo tổng buổi khoá còn
 * bị THẤP GIẢ suốt đầu khoá: con đi đủ buổi 1 vẫn hiện 1/12 = 8%.
 *
 * "Khoá đi được tới đâu" là câu hỏi KHÁC — dùng `courseProgressPercent`.
 */
export function attendanceRatePercent(att: AttendanceSummary): number {
  return att.daDienRa > 0 ? Math.round((att.attended / att.daDienRa) * 100) : 0;
}

/** % TIẾN ĐỘ KHOÁ = số buổi đã dạy / tổng buổi chuẩn của khoá. */
export function courseProgressPercent(att: AttendanceSummary): number {
  if (att.total <= 0) return 0;
  // Kẹp trần 100: lớp dạy bù / thêm buổi có thể vượt số buổi chuẩn của khoá, mà
  // "tiến độ 103%" thì phụ huynh đọc ra là hệ thống sai.
  return Math.min(100, Math.round((att.daDienRa / att.total) * 100));
}

export interface ExamAttemptLite {
  totalScore: number | null;
  totalPoints: number | null;
  passed: boolean | null;
}

/** Tổng hợp điểm bài tập (chuẩn hoá về thang 10). THUẦN — test bảng biên. */
export function computeExamAverage(attempts: ExamAttemptLite[]): {
  count: number;
  passed: number;
  averageScore: number | null;
} {
  const scored = attempts.filter((a) => a.totalScore != null);
  const count = scored.length;
  const passed = attempts.filter((a) => a.passed === true).length;
  if (count === 0) return { count: 0, passed, averageScore: null };
  const sum = scored.reduce((s, a) => {
    const pts = a.totalPoints && a.totalPoints > 0 ? a.totalPoints : 10;
    return s + ((a.totalScore ?? 0) / pts) * 10;
  }, 0);
  return { count, passed, averageScore: Math.round((sum / count) * 10) / 10 };
}

export interface AssignmentSubmissionLite {
  status: "NOT_SUBMITTED" | "SUBMITTED" | "LATE" | "GRADED";
  score: number | null;
  totalPoints: number | null; // điểm tối đa của bài tập
}

/**
 * Tổng hợp bài tập (chuẩn hoá điểm về thang 10). THUẦN — test bảng biên.
 * Cùng công thức điểm với computeExamAverage; điểm TB chỉ tính trên bài ĐÃ CHẤM.
 */
export function computeAssignmentSummary(subs: AssignmentSubmissionLite[]): AssignmentSummary {
  const total = subs.length;
  const submitted = subs.filter(
    (s) => s.status === "SUBMITTED" || s.status === "LATE" || s.status === "GRADED",
  ).length;
  const gradedRows = subs.filter((s) => s.status === "GRADED" && s.score != null);
  const graded = gradedRows.length;
  if (graded === 0) return { total, submitted, graded: 0, averageScore: null };
  const sum = gradedRows.reduce((acc, s) => {
    const pts = s.totalPoints && s.totalPoints > 0 ? s.totalPoints : 10;
    return acc + ((s.score ?? 0) / pts) * 10;
  }, 0);
  return { total, submitted, graded, averageScore: Math.round((sum / graded) * 10) / 10 };
}

/**
 * Lấy mức đánh giá MỚI NHẤT mỗi kỹ năng (rows KHÔNG cần sắp xếp trước). THUẦN — test.
 * Giữ thứ tự xuất hiện đầu tiên của mỗi kỹ năng sau khi đã chọn bản mới nhất.
 */
export function latestSkillLevels(
  rows: { skill: string; level: string; assessedAt: string }[],
): ReportCardSkill[] {
  const latest = new Map<string, { level: string; assessedAt: string }>();
  for (const r of rows) {
    const cur = latest.get(r.skill);
    if (!cur || r.assessedAt > cur.assessedAt) latest.set(r.skill, { level: r.level, assessedAt: r.assessedAt });
  }
  return Array.from(latest.entries()).map(([skill, v]) => ({ skill, level: v.level }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Máy trạng thái — transition guard THUẦN.
// ═══════════════════════════════════════════════════════════════════════════

export type ReportCardCapability = "manage" | "review";

export interface TransitionRule {
  to: ReportCardStatusValue;
  capability: ReportCardCapability;
  reasonRequired: boolean;
}

/**
 * Đồ thị chuyển trạng thái hợp lệ:
 *  DRAFT          → PENDING_REVIEW  (GV nộp, capability=manage)
 *  PENDING_REVIEW → PUBLISHED       (QL/Đào tạo phát hành, capability=review)
 *  PENDING_REVIEW → DRAFT           (trả lại + lý do, capability=review)
 *  PUBLISHED      → RECALLED        (thu hồi + lý do, capability=review)
 *  RECALLED       → PENDING_REVIEW  (sửa xong nộp lại, capability=manage)
 * MỌI cạnh khác (vd DRAFT→PUBLISHED) → CHẶN.
 */
export const REPORT_CARD_TRANSITIONS: Record<ReportCardStatusValue, TransitionRule[]> = {
  DRAFT: [{ to: "PENDING_REVIEW", capability: "manage", reasonRequired: false }],
  PENDING_REVIEW: [
    { to: "PUBLISHED", capability: "review", reasonRequired: false },
    { to: "DRAFT", capability: "review", reasonRequired: true },
  ],
  PUBLISHED: [{ to: "RECALLED", capability: "review", reasonRequired: true }],
  RECALLED: [{ to: "PENDING_REVIEW", capability: "manage", reasonRequired: false }],
};

export interface TransitionCheck {
  ok: boolean;
  error?: string;
  rule?: TransitionRule;
}

/** Kiểm tra 1 chuyển trạng thái có hợp lệ với capability + reason không (THUẦN). */
export function checkTransition(input: {
  from: ReportCardStatusValue;
  to: ReportCardStatusValue;
  capabilities: ReportCardCapability[];
  reason?: string | null;
}): TransitionCheck {
  const rule = REPORT_CARD_TRANSITIONS[input.from]?.find((r) => r.to === input.to);
  if (!rule) {
    return {
      ok: false,
      error: `Không thể chuyển ${REPORT_CARD_STATUS_LABEL[input.from]} → ${REPORT_CARD_STATUS_LABEL[input.to]}`,
    };
  }
  if (!input.capabilities.includes(rule.capability)) {
    return { ok: false, error: "Bạn không có quyền thực hiện chuyển trạng thái này" };
  }
  if (rule.reasonRequired && !(input.reason && input.reason.trim())) {
    return { ok: false, error: "Cần nhập lý do" };
  }
  return { ok: true, rule };
}

/** Nội dung học bạ chỉ sửa được ở DRAFT hoặc RECALLED. */
export function isReportCardEditable(status: ReportCardStatusValue): boolean {
  return status === "DRAFT" || status === "RECALLED";
}

/**
 * Ai được SỬA nội dung học bạ theo trạng thái + capability (THUẦN — #17 Gap3, câu 55).
 *  - DRAFT / mới          → cần 'manage' (GV nhập đánh giá).
 *  - RECALLED (đã phát hành RỒI thu hồi) → cần 'review': CHỈ QL cơ sở / Đào tạo / Admin
 *    được sửa lại; GV (manage-only) BỊ CHẶN. GV vẫn viết DRAFT + đánh giá buổi bình thường.
 *  - PENDING_REVIEW / PUBLISHED → khoá nội dung (isReportCardEditable=false).
 * Dùng ở tầng action (saveReportCardAction) để siết đúng "sửa-sau-phát-hành".
 */
export function canEditReportCardContent(
  status: ReportCardStatusValue,
  capabilities: ReportCardCapability[],
): boolean {
  if (!isReportCardEditable(status)) return false;
  const required: ReportCardCapability = status === "RECALLED" ? "review" : "manage";
  return capabilities.includes(required);
}

/** Capability từ kết quả can() (manage = GV nhập, review = QL/Đào tạo duyệt). */
export function actorCapabilities(perms: { manage: boolean; review: boolean }): ReportCardCapability[] {
  const caps: ReportCardCapability[] = [];
  if (perms.manage) caps.push("manage");
  if (perms.review) caps.push("review");
  return caps;
}

// ═══════════════════════════════════════════════════════════════════════════
// T5 SCOPE — GV lớp mình, QL cơ sở mình.
// ═══════════════════════════════════════════════════════════════════════════

export type ScopeActor = Pick<
  Actor,
  "isSuperAdmin" | "isHoLevel" | "visibleCenterIds" | "assignedClassIds"
>;

/**
 * ReportCard/Enrollment ĐÃ ∈ SCOPED_MODELS (#03 Pha B 86edfbc) nhưng hàm này vẫn là
 * cổng scope TAY cho đường đọc RAW db (carve-out câu 20 — QL tiếp nhận XEM học bạ
 * cũ HV chuyển cơ sở; ĐỪNG migrate các call-site đó sang sdb, sẽ giết carve-out):
 *  - SUPER_ADMIN / HO-level: bỏ qua.
 *  - Mọi vai khác: centerId của lớp PHẢI ∈ visibleCenterIds (T5).
 *  - GV (chỉ có capability=manage, KHÔNG review): classId PHẢI ∈ assignedClassIds.
 */
export function checkEnrollmentScope(input: {
  actor: ScopeActor;
  centerId: string | null;
  classId: string;
  capabilities: ReportCardCapability[];
  // #04 carve-out câu 20 (2 QL đã ký): HV chuyển cơ sở → QL cơ sở TIẾP NHẬN được XEM học bạ
  // cũ (gồm phần cơ sở cũ). CHỈ đường ĐỌC (view page) truyền receivingCenterId = cơ sở HIỆN
  // TẠI của HV (Student.centerId). Đường GHI (save/recall/publish) KHÔNG truyền → EDIT vẫn
  // chỉ cơ sở cũ + Toại (giữ cách ly ghi, #17).
  receivingCenterId?: string | null;
}): { ok: boolean; error?: string } {
  const { actor, centerId, classId, capabilities, receivingCenterId } = input;
  if (actor.isSuperAdmin || actor.isHoLevel) return { ok: true };

  if (!centerId || !actor.visibleCenterIds.includes(centerId)) {
    // Carve-out câu 20 (READ-only): học bạ ngoài cơ sở NHƯNG HV hiện thuộc cơ sở actor quản lý
    // (đã chuyển về) → cho XEM. receivingCenterId chỉ được truyền ở đường đọc → không nới EDIT.
    if (receivingCenterId && actor.visibleCenterIds.includes(receivingCenterId)) {
      return { ok: true };
    }
    return { ok: false, error: "Học bạ ngoài phạm vi cơ sở của bạn" };
  }
  const isReviewer = capabilities.includes("review");
  if (!isReviewer && !actor.assignedClassIds.has(classId)) {
    return { ok: false, error: "Bạn chỉ được nhập học bạ lớp mình phụ trách" };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Vá 24/07 (Gói E — user chốt): Đào tạo/HO-level chỉ DUYỆT cross-center;
// GHI nội dung học bạ phải theo cơ sở của quyền manage.
// ═══════════════════════════════════════════════════════════════════════════

export type ActionScopeActor = Pick<Actor, "isSuperAdmin" | "permissions" | "grantsAllow">;

/**
 * Center-scope của MỘT action cụ thể từ actor.permissions (THUẦN — vá 24/07):
 * union centerScope các entry có ĐÚNG action đó; "ALL" nếu ≥1 entry ALL, hoặc
 * grantsAllow chứa action (per-user grant = ngoại lệ toàn cục), hoặc SUPER_ADMIN.
 * KHÁC getModelVisibleCenterIds (gom theo PREFIX model) — đây là scope theo TỪNG
 * action, để tách "duyệt cross-center" (review ALL từ TRAINING@HO) khỏi "ghi theo
 * cơ sở" (manage [CS1] từ CM/TEACHER@CS1) cho actor kiêm nhiệm kiểu Toại.
 */
export function actionCenterScope(actor: ActionScopeActor, action: string): "ALL" | string[] {
  if (actor.isSuperAdmin) return "ALL";
  if (actor.grantsAllow.has(action)) return "ALL";
  const centers = new Set<string>();
  for (const p of actor.permissions) {
    if (p.action !== action) continue;
    if (p.centerScope === "ALL") return "ALL";
    if (Array.isArray(p.centerScope)) for (const c of p.centerScope) centers.add(c);
  }
  return [...centers];
}

/**
 * Guard đường GHI nội dung học bạ (save + transition capability=manage) — vá 24/07:
 * center của enrollment PHẢI ∈ actionCenterScope(actor, "report-cards:manage").
 * checkEnrollmentScope nuốt HO-level (cần cho đường DUYỆT câu 55) nên KHÔNG đủ cho
 * đường ghi — Toại (TRAINING@HO chỉ review + CM/TEACHER@CS1) hết ghi học bạ CS2
 * nhưng vẫn duyệt CS2. Role HO CÓ manage (centerScope ALL) không đổi hành vi.
 * centerId null (lớp HO/legacy) → đòi scope ALL (đối xứng pattern Class PR #65).
 */
export function checkManageWriteScope(input: {
  actor: ActionScopeActor;
  centerId: string | null;
}): { ok: boolean; error?: string } {
  const scope = actionCenterScope(input.actor, "report-cards:manage");
  if (scope === "ALL") return { ok: true };
  if (!input.centerId || !scope.includes(input.centerId)) {
    return { ok: false, error: "Ghi học bạ ngoài phạm vi cơ sở của quyền nhập — bạn chỉ được duyệt" };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOT — đóng băng số liệu lúc phát hành.
// ═══════════════════════════════════════════════════════════════════════════

export interface PeriodComment {
  period: string;
  comment: string;
}

export interface ReportCardSnapshotScore {
  criterionId: string;
  name: string;
  level: number;
  note: string | null;
}

export interface ReportCardSnapshot {
  version: 1;
  metrics: ReportCardMetrics;
  finalComment: string | null;
  completionStatus: string | null;
  periodComments: PeriodComment[];
  scores: ReportCardSnapshotScore[];
  student: { name: string; studentCode: string | null };
  course: { name: string };
  className: string;
  publishedAt: string;
}

/** Chuẩn hoá periodComments JSON (lưu lỏng) → mảng {period, comment} (THUẦN). */
export function normalizePeriodComments(raw: unknown): PeriodComment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({ period: String(x.period ?? ""), comment: String(x.comment ?? "") }))
    .filter((x) => x.period.trim() || x.comment.trim());
}

/** Dựng snapshot bất biến lúc phát hành (THUẦN — deep-copy số liệu để đóng băng). */
export function buildPublishedSnapshot(input: {
  metrics: ReportCardMetrics;
  reportCard: { finalComment: string | null; completionStatus: string | null; periodComments: unknown };
  scores: { criterionId: string; level: number; note: string | null }[];
  criteria: { id: string; name: string }[];
  student: { name: string; studentCode: string | null };
  course: { name: string };
  className: string;
  publishedAt: Date;
}): ReportCardSnapshot {
  const critName = new Map(input.criteria.map((c) => [c.id, c.name]));
  return {
    version: 1,
    // JSON round-trip để đóng băng (tránh tham chiếu metrics nguồn đổi sau).
    metrics: JSON.parse(JSON.stringify(input.metrics)) as ReportCardMetrics,
    finalComment: input.reportCard.finalComment,
    completionStatus: input.reportCard.completionStatus,
    periodComments: normalizePeriodComments(input.reportCard.periodComments),
    scores: input.scores.map((s) => ({
      criterionId: s.criterionId,
      name: critName.get(s.criterionId) ?? "(tiêu chí)",
      level: s.level,
      note: s.note,
    })),
    student: input.student,
    course: input.course,
    className: input.className,
    publishedAt: input.publishedAt.toISOString(),
  };
}

export interface PublishedReportCardView extends ReportCardSnapshot {
  id: string;
  enrollmentId: string;
}

/** Parse publishedSnapshot JSON an toàn (THUẦN). Trả null nếu hỏng/không đủ shape. */
export function parsePublishedSnapshot(
  id: string,
  enrollmentId: string,
  raw: unknown,
): PublishedReportCardView | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<ReportCardSnapshot>;
  if (!s.metrics || !s.student || !s.course) return null;
  return {
    version: 1,
    id,
    enrollmentId,
    metrics: s.metrics as ReportCardMetrics,
    finalComment: s.finalComment ?? null,
    completionStatus: s.completionStatus ?? null,
    periodComments: Array.isArray(s.periodComments) ? s.periodComments : [],
    scores: Array.isArray(s.scores) ? s.scores : [],
    student: s.student as { name: string; studentCode: string | null },
    course: s.course as { name: string },
    className: s.className ?? "",
    publishedAt: s.publishedAt ?? "",
  };
}
