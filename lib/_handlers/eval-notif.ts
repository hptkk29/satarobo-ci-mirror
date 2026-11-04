// lib/_handlers/eval-notif.ts — R7-17: consumer cho DomainEvent "eval.opened".
// Khi 1 đợt đánh giá/khảo sát chuyển sang MỞ (lib/eval/rounds.ts setRoundStatus):
//  - TEACHER_EVAL  → Notification (audience STUDENT) cho từng HV đủ điều kiện đánh giá GV.
//  - CENTER_SURVEY → Notification (audience CENTER) cho PH cơ sở của đợt.
// Idempotent: dedupeKey ổn định theo round (+ studentId) → replay không tạo trùng.
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { TAUGHT_STATUSES } from "@/lib/eval/eligibility";

const str = (v: unknown): string => (v == null ? "" : String(v));

export async function onEvalOpened(event: DomainEventLite): Promise<void> {
  const roundId = str(event.payload.roundId);
  if (!roundId) return;
  const scope = str(event.payload.scope);
  const centerId = event.payload.centerId == null ? null : str(event.payload.centerId);
  const courseId = event.payload.courseId == null ? null : str(event.payload.courseId);

  // Tên đợt cho nội dung thông báo (đọc lại từ DB; bỏ qua nếu đợt đã bị xoá).
  const round = await db.evaluationRound.findUnique({
    where: { id: roundId },
    select: { name: true },
  });
  if (!round) return;
  const roundName = round.name;

  if (scope === "CENTER_SURVEY") {
    // PH cơ sở của đợt — broadcast theo centerId (audience=CENTER). A1-LOW 10/07:
    // đợt TOÀN HỆ THỐNG (centerId=null) → audience CENTER+null KHÔNG match
    // parentAudienceOr (centerId IN [...]) = không ai nhận chuông → dùng ALL_PARENTS.
    await db.notification.upsert({
      where: { dedupeKey: `eval.opened:${roundId}` },
      create: {
        title: "Khảo sát trung tâm đang mở",
        body: `Khảo sát "${roundName}" đang mở. Vui lòng dành ít phút gửi ý kiến của quý phụ huynh.`,
        audience: centerId ? "CENTER" : "ALL_PARENTS",
        centerId,
        createdByName: "Hệ thống",
        dedupeKey: `eval.opened:${roundId}`,
      },
      update: { body: `Khảo sát "${roundName}" đang mở. Vui lòng dành ít phút gửi ý kiến của quý phụ huynh.` },
    });
    return;
  }

  // TEACHER_EVAL — HV đủ điều kiện: enrollment đang/đã học (TAUGHT_STATUSES),
  // áp filter khóa/cơ sở của đợt (mirror lib/eval/eligibility). Mỗi HV 1 notification.
  const enrollments = await db.enrollment.findMany({
    where: {
      status: { in: TAUGHT_STATUSES },
      ...(courseId ? { courseId } : {}),
      ...(centerId ? { class: { centerId } } : {}),
    },
    select: { studentId: true, student: { select: { centerId: true } } },
    distinct: ["studentId"],
  });

  for (const e of enrollments) {
    const studentId = e.studentId;
    if (!studentId) continue;
    const dedupeKey = `eval.opened:${roundId}:student:${studentId}`;
    const body = `Đợt đánh giá "${roundName}" đang mở. Mời quý phụ huynh/học viên gửi đánh giá giáo viên.`;
    await db.notification.upsert({
      where: { dedupeKey },
      create: {
        title: "Đợt đánh giá giáo viên đang mở",
        body,
        audience: "STUDENT",
        studentId,
        centerId: e.student?.centerId ?? centerId,
        createdByName: "Hệ thống",
        dedupeKey,
      },
      update: { body },
    });
  }
}

export function registerEvalNotifHandlers(): void {
  on("eval.opened", onEvalOpened);
}
