// lib/lms/session-teacher-notify.ts — #06 L6 (câu 47/48): thông báo GV về buổi dạy
// thay (trước 1 ngày) + nhắc chốt buổi (lifecycle v2). Notify per-user qua
// StaffNotification (inbox nhân sự, hiện ở chuông), idempotent theo (userId, dedupeKey)
// — cùng mẫu lib/portal/parent-request-notify.ts + lib/notify/attendance.ts.
//
// ⚠️ Câu 46: KHÔNG đưa contact PH — chỉ tên lớp + ngày buổi. Cron dùng db trần (hệ
// thống, không actor) — hợp lệ (Loại C, ngoài scopedDb).
import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { isSessionLifecycleV2Enabled } from "@/lib/flags";

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh (UTC+7, không DST)
const DAY_MS = 24 * 60 * 60 * 1000;
/** Cửa sổ quét buổi chưa chốt (tránh nhắc buổi quá cũ). */
export const CLOSE_REMINDER_WINDOW_MS = 7 * DAY_MS;

/** [00:00, 24:00) NGÀY MAI theo giờ tường VN → mốc UTC để query Timestamptz. */
function vnTomorrowRange(now = new Date()): { from: Date; to: Date } {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const startTomorrowUtc =
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() + 1) - VN_OFFSET_MS;
  return { from: new Date(startTomorrowUtc), to: new Date(startTomorrowUtc + DAY_MS) };
}

const dayVN = new Intl.DateTimeFormat("vi-VN", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

/** Ghi StaffNotification 1 LẦN cho GV (idempotent theo dedupeKey — cron lặp không nhân đôi). */
async function notifyOnce(params: {
  userId: string;
  sessionId: string;
  dedupeKey: string;
  title: string;
  body: string;
}): Promise<void> {
  await notifyStaff({
    userIds: [params.userId],
    dedupeKey: params.dedupeKey,
    category: "CLASS", // = PendingTaskType việc lớp/buổi (cùng #16 notifyTeacherAttendanceEdited)
    title: params.title,
    body: params.body,
    href: "/lich", // site GV — Lịch dạy (clean URL rewrite → /teacher/lich)
    entityId: params.sessionId,
    // Không `reopen`: cron chạy lặp lại trên cùng buổi cho tới khi GV chốt — kéo về
    // chưa-đọc là nhắc lại mỗi lượt, đúng thứ dedupeKey sinh ra để chặn.
  });
}

/**
 * Câu 47 — Cron: buổi NGÀY MAI có GV dạy thay (substituteTeacherId) → báo GV đó TRƯỚC
 * 1 ngày. dedupe `session.substitute:<sessionId>` (mỗi buổi 1 lần cho GV dạy thay).
 */
export async function runSubstituteTeacherNotify(
  now = new Date(),
): Promise<{ scanned: number; notified: number }> {
  const { from, to } = vnTomorrowRange(now);
  const sessions = await db.classSession.findMany({
    where: {
      date: { gte: from, lt: to },
      status: "SCHEDULED",
      substituteTeacherId: { not: null },
    },
    select: {
      id: true,
      date: true,
      substituteTeacherId: true,
      class: { select: { name: true } },
    },
  });

  let notified = 0;
  for (const s of sessions) {
    if (!s.substituteTeacherId) continue;
    await notifyOnce({
      userId: s.substituteTeacherId,
      sessionId: s.id,
      dedupeKey: `session.substitute:${s.id}`,
      title: "Bạn được phân dạy thay ngày mai",
      body: `Lớp ${s.class.name} — buổi ${dayVN.format(s.date)}. Xem chi tiết ở Lịch dạy.`,
    });
    notified++;
  }
  return { scanned: sessions.length, notified };
}

/**
 * Câu 48 — Cron: nhắc GV CHỐT buổi đã qua giờ nhưng chưa hoàn tất (lifecycle v2). Quét
 * buổi trong [now−7d, now) còn SCHEDULED/IN_PROGRESS → nhắc GV đứng lớp (actualTeacherId
 * ?? substituteTeacherId ?? class.teacherId). dedupe `session.close-reminder:<sessionId>`.
 * CHỈ chạy khi SESSION_LIFECYCLE_V2 ON (chốt buổi là luồng v2; flag OFF → no-op).
 */
export async function runSessionCloseReminder(
  now = new Date(),
  opts?: { lifecycleV2?: boolean },
): Promise<{ scanned: number; notified: number }> {
  const on = opts?.lifecycleV2 ?? isSessionLifecycleV2Enabled();
  if (!on) return { scanned: 0, notified: 0 };

  const windowStart = new Date(now.getTime() - CLOSE_REMINDER_WINDOW_MS);
  const sessions = await db.classSession.findMany({
    where: {
      date: { gte: windowStart, lt: now },
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
    },
    select: {
      id: true,
      date: true,
      actualTeacherId: true,
      substituteTeacherId: true,
      class: { select: { name: true, teacherId: true } },
    },
  });

  let notified = 0;
  for (const s of sessions) {
    const teacherId = s.actualTeacherId ?? s.substituteTeacherId ?? s.class.teacherId;
    if (!teacherId) continue;
    await notifyOnce({
      userId: teacherId,
      sessionId: s.id,
      dedupeKey: `session.close-reminder:${s.id}`,
      title: "Nhắc: chốt buổi dạy",
      body: `Buổi lớp ${s.class.name} (${dayVN.format(s.date)}) chưa được hoàn tất. Vui lòng chốt buổi (điểm danh/nhận xét).`,
    });
    notified++;
  }
  return { scanned: sessions.length, notified };
}
