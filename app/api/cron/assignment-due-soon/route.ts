import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron/auth";

export const dynamic = "force-dynamic";

// YYYY-MM-DD theo giờ VN (Asia/Ho_Chi_Minh) — khoá chống spam 1 nhắc/ngày/bài.
const vnDate = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(d);

// R7-17 (homework) — nhắc bài tập SẮP ĐẾN HẠN: HomeworkAssignment còn ASSIGNED có
// dueAt trong [now, now+24h] → Notification audience=STUDENT cho HV. Idempotent theo
// `homework.due:${assignmentId}:${YYYY-MM-DD VN}` → chạy hằng ngày không trùng trong ngày.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const assignments = await db.homeworkAssignment.findMany({
    where: { status: "ASSIGNED", dueAt: { gte: now, lte: in24h } },
    select: { id: true, examId: true, studentId: true, classSessionId: true, dueAt: true },
    take: 1000,
  });

  const stats = { found: assignments.length, sent: 0 };
  if (assignments.length === 0) {
    console.log("[cron] assignment-due-soon:", stats);
    return NextResponse.json({ ok: true, stats });
  }

  // Batch lookup tên exam + lớp/cơ sở của buổi (HomeworkAssignment dùng FK phẳng, không relation).
  const examIds = [...new Set(assignments.map((a) => a.examId))];
  const sessionIds = [...new Set(assignments.map((a) => a.classSessionId))];
  const [exams, sessions] = await Promise.all([
    db.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, title: true } }),
    db.classSession.findMany({
      where: { id: { in: sessionIds } },
      select: { id: true, classId: true, class: { select: { name: true, centerId: true } } },
    }),
  ]);
  const examById = new Map(exams.map((e) => [e.id, e.title]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  for (const a of assignments) {
    if (!a.dueAt) continue;
    const examTitle = examById.get(a.examId) ?? "bài tập";
    const session = sessionById.get(a.classSessionId);
    const due = a.dueAt.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
    const dedupeKey = `homework.due:${a.id}:${vnDate(a.dueAt)}`;
    await db.notification.upsert({
      where: { dedupeKey },
      create: {
        title: "Bài tập sắp đến hạn",
        body: `Bài tập "${examTitle}" sắp đến hạn nộp (${due}). Con nhớ hoàn thành đúng hạn nhé.`,
        audience: "STUDENT",
        studentId: a.studentId,
        classId: session?.classId ?? null,
        centerId: session?.class?.centerId ?? null,
        createdByName: "Hệ thống",
        dedupeKey,
      },
      update: {},
    });
    stats.sent++;
  }

  console.log("[cron] assignment-due-soon:", stats);
  return NextResponse.json({ ok: true, stats });
}
