// lib/events/handlers/homework-assign.ts — R7-14 (PR1): auto-giao bài khi buổi taught.
//
// Consumer thứ 2 cho `session.taught` (song song handler StaffNotification ở
// lib/_handlers/r7-lifecycle.ts). Đọc assignMode/dueAt từ payload (do completeSession
// gắn) → tạo HomeworkAssignment cho HV active của lớp qua assignHomeworkForSession.
// Idempotent (unique key + createMany skipDuplicates) → replay event an toàn (AC2).
//   • NOW (mặc định) → hạn = hôm nay + Exam.defaultDueDays.
//   • CUSTOM_DUE     → hạn = dueAt GV chọn.
//   • DEFER          → không giao (chờ nút "Giao bài").
import { assignHomeworkForSession, type AssignMode } from "@/lib/lms/assignment";
import { on, type DomainEventLite } from "@/lib/events/registry";

const str = (v: unknown): string => (v == null ? "" : String(v));

function parseMode(v: unknown): AssignMode {
  const s = str(v);
  return s === "DEFER" || s === "CUSTOM_DUE" ? s : "NOW";
}

export async function onSessionTaughtAssignHomework(event: DomainEventLite): Promise<void> {
  const sessionId = str(event.payload.sessionId);
  if (!sessionId) return;

  const assignMode = parseMode(event.payload.assignMode);
  const dueRaw = event.payload.dueAt;
  const customDueAt =
    typeof dueRaw === "string" && dueRaw && !Number.isNaN(Date.parse(dueRaw))
      ? new Date(dueRaw)
      : null;

  await assignHomeworkForSession({
    sessionId,
    assignMode,
    customDueAt,
    assignedById: str(event.payload.assignedById) || null,
  });
}

export function registerHomeworkAssignHandlers(): void {
  on("session.taught", onSessionTaughtAssignHomework);
}
