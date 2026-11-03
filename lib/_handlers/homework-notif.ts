// lib/_handlers/homework-notif.ts — R7-17 (homework): thông báo "Bài tập mới" cho HV.
//
// Consumer THỨ 2 (song song handler R7-14 onSessionTaughtAssignHomework) trên cùng
// event `session.taught`. Sau khi R7-14 auto tạo HomeworkAssignment, handler này đọc
// các assignment của buổi rồi tạo Notification audience=STUDENT cho TỪNG bài, kèm tên
// exam ("Bài tập mới: <tên>"). Idempotent qua dedupeKey `homework.new:${assignmentId}`.
//
// Lưu ý race: dispatcher chạy các handler của 1 event SONG SONG (Promise.allSettled),
// nên ở lần dispatch đầu handler này có thể đọc 0 assignment (R7-14 chưa createMany kịp).
// Để KHÔNG mất thông báo mà cũng KHÔNG spam FAILED cho buổi không có bài: nếu chưa thấy
// assignment NHƯNG buổi thực sự CÓ exam PUBLISHED (và mode ≠ DEFER) → throw để outbox
// retry (lần sau assignment đã có → tạo thông báo, DONE). Buổi không có exam → return êm.
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";

const str = (v: unknown): string => (v == null ? "" : String(v));

export async function onSessionTaughtHomeworkNotif(event: DomainEventLite): Promise<void> {
  const sessionId = str(event.payload.sessionId);
  if (!sessionId) return;

  const assignments = await db.homeworkAssignment.findMany({
    where: { classSessionId: sessionId },
    select: { id: true, examId: true, studentId: true },
  });

  // Chưa có assignment → phân biệt "R7-14 chưa kịp tạo" vs "buổi không có bài".
  if (assignments.length === 0) {
    if (str(event.payload.assignMode) === "DEFER") return; // GV hoãn giao → không có bài, không retry.

    const session = await db.classSession.findUnique({
      where: { id: sessionId },
      select: { classId: true, lessonId: true, plan: { select: { lessonId: true } } },
    });
    const lessonId = session?.lessonId ?? session?.plan?.lessonId ?? null;
    if (!session || !lessonId) return; // buổi không gắn lesson → không có bài.

    const examCount = await db.exam.count({
      where: { lessonId, status: "PUBLISHED", OR: [{ classId: null }, { classId: session.classId }] },
    });
    if (examCount > 0) {
      // Bài tập DỰ KIẾN do R7-14 tạo (đang chạy song song) chưa sẵn sàng → retry idempotent.
      throw new Error(`homework-notif: assignment chưa sẵn sàng cho session ${sessionId} — sẽ retry`);
    }
    return; // không exam → không có bài để báo.
  }

  // Có assignment → tạo Notification theo TỪNG bài (kèm tên exam).
  const session = await db.classSession.findUnique({
    where: { id: sessionId },
    select: { classId: true, class: { select: { name: true, centerId: true } } },
  });
  const examIds = [...new Set(assignments.map((a) => a.examId))];
  const exams = await db.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, title: true } });
  const titleById = new Map(exams.map((e) => [e.id, e.title]));
  const className = session?.class?.name ?? "";

  for (const a of assignments) {
    const examTitle = titleById.get(a.examId) ?? "bài tập";
    const dedupeKey = `homework.new:${a.id}`;
    const body = className
      ? `Lớp ${className} có bài tập mới: ${examTitle}.`
      : `Có bài tập mới: ${examTitle}.`;
    await db.notification.upsert({
      where: { dedupeKey },
      create: {
        title: `Bài tập mới: ${examTitle}`,
        body,
        audience: "STUDENT",
        studentId: a.studentId,
        classId: session?.classId ?? null,
        centerId: session?.class?.centerId ?? null,
        createdByName: "Hệ thống",
        dedupeKey,
      },
      update: {},
    });
  }
}

export function registerHomeworkNotifHandlers(): void {
  on("session.taught", onSessionTaughtHomeworkNotif);
}
