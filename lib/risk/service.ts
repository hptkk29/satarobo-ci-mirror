import { db } from "@/lib/db";
import type { AttendanceStatus } from "@prisma/client";

// =============================================================================
// Cụm B2 — đánh giá rủi ro học viên + tạo care task cho SALES_CSM.
// Gọi sau điểm danh / nộp bài (không cần realtime phức tạp).
// =============================================================================

// "Vắng" = cả enum CŨ (ABSENT/EXCUSED — đường admin) lẫn enum MỚI
// (ABSENT_EXCUSED/ABSENT_UNEXCUSED — site GV ghi từ R7-08). Cùng ngữ nghĩa
// ABSENT_SET của lib/attendance/summary.ts — thiếu 2 giá trị mới thì điểm danh
// từ site GV không bao giờ kích hoạt cảnh báo vắng liên tiếp.
const ABSENT_STATUSES = new Set<AttendanceStatus>([
  "ABSENT",
  "EXCUSED",
  "ABSENT_EXCUSED",
  "ABSENT_UNEXCUSED",
]);

type AlertType =
  | "CONSECUTIVE_ABSENCE"
  | "HIGH_ABSENCE"
  | "MISSED_SUBMISSIONS"
  | "NEEDS_SUPPORT"
  | "NEARING_END_NO_RENEWAL"
  | "OVERDUE_PAYMENT";

const ALERT_TITLE: Record<AlertType, string> = {
  CONSECUTIVE_ABSENCE: "Nghỉ 2 buổi liên tiếp",
  HIGH_ABSENCE: "Nghỉ vượt ngưỡng",
  MISSED_SUBMISSIONS: "Không nộp bài nhiều lần",
  NEEDS_SUPPORT: "GV đánh dấu cần hỗ trợ",
  NEARING_END_NO_RENEWAL: "Sắp hết khoá chưa tái đăng ký",
  OVERDUE_PAYMENT: "Công nợ quá hạn",
};

/** Chọn SALES_CSM phụ trách (tạm: sale active của cơ sở). null nếu không có. */
async function pickCsm(centerId: string | null): Promise<string | null> {
  const sale = await db.user.findFirst({
    where: { roles: { has: "SALES_CSM" }, isActive: true, deletedAt: null, ...(centerId ? { centerId } : {}) },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return sale?.id ?? null;
}

/**
 * Tạo alert (idempotent: bỏ qua nếu đã có alert OPEN cùng loại) + 1 care task.
 */
export async function raiseRiskAlert(params: {
  studentId: string;
  centerId: string | null;
  type: AlertType;
  severity?: "LOW" | "MEDIUM" | "HIGH";
  detail?: string;
}): Promise<{ created: boolean; alertId?: string }> {
  const existing = await db.studentRiskAlert.findFirst({
    where: { studentId: params.studentId, type: params.type, status: "OPEN" },
    select: { id: true },
  });
  if (existing) return { created: false, alertId: existing.id };

  const studentName = (
    await db.student.findUnique({ where: { id: params.studentId }, select: { name: true } })
  )?.name;
  const assignedToId = await pickCsm(params.centerId);

  const alert = await db.studentRiskAlert.create({
    data: {
      studentId: params.studentId,
      centerId: params.centerId,
      type: params.type,
      severity: params.severity ?? "MEDIUM",
      detail: params.detail ?? null,
      careTasks: {
        create: {
          studentId: params.studentId,
          centerId: params.centerId,
          assignedToId,
          title: `Chăm sóc: ${ALERT_TITLE[params.type]} — ${studentName ?? "HV"}`,
          description: params.detail ?? null,
          dueAt: new Date(Date.now() + 2 * 86400000),
        },
      },
    },
    select: { id: true },
  });
  return { created: true, alertId: alert.id };
}

/**
 * Đánh giá rủi ro sau điểm danh: nghỉ 2 buổi ĐÃ DIỄN RA gần nhất liên tiếp
 * (chưa bù) → CONSECUTIVE_ABSENCE.
 */
export async function evaluateAbsenceRisk(studentId: string, classId: string): Promise<void> {
  const now = new Date();
  // 2 buổi đã diễn ra gần nhất của lớp.
  const recent = await db.classSession.findMany({
    where: { classId, date: { lte: now } },
    orderBy: { date: "desc" },
    take: 2,
    select: { id: true, class: { select: { centerId: true } } },
  });
  if (recent.length < 2) return;

  const atts = await db.attendance.findMany({
    where: { studentId, sessionId: { in: recent.map((s) => s.id) } },
    select: { sessionId: true, status: true, makeupStatus: true },
  });
  const byId = new Map(atts.map((a) => [a.sessionId, a]));

  const bothAbsent = recent.every((s) => {
    const a = byId.get(s.id);
    return a && ABSENT_STATUSES.has(a.status) && a.makeupStatus !== "MADE_UP";
  });
  if (!bothAbsent) return;

  await raiseRiskAlert({
    studentId,
    centerId: recent[0].class.centerId,
    type: "CONSECUTIVE_ABSENCE",
    severity: "HIGH",
    detail: "Học viên vắng 2 buổi liên tiếp gần nhất — cần liên hệ phụ huynh.",
  });
}
