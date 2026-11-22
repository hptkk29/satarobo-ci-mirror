import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyCronAuth } from "@/lib/cron/auth";
import { sendEmailForTrigger } from "@/lib/email/trigger";
import { wasReminderSent } from "@/lib/email/reminder-helpers";
import { getSetting } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  // Daily cron chạy 8h sáng VN (UTC 01:00) — quét sessions trong cửa sổ nhắc
  // (SystemSetting cron.classReminderMin/MaxHours — default 12h-48h tới).
  // Bắt được mọi session ngày hôm sau bất kể giờ học sáng/chiều/tối.
  const now = new Date();
  const [minHours, maxHours] = await Promise.all([
    getSetting("cron.classReminderMinHours"),
    getSetting("cron.classReminderMaxHours"),
  ]);
  const windowStart = new Date(now.getTime() + minHours * 3600 * 1000);
  const windowEnd = new Date(now.getTime() + maxHours * 3600 * 1000);

  const sessions = await db.classSession.findMany({
    where: {
      date: { gte: windowStart, lte: windowEnd },
    },
    include: {
      class: {
        select: {
          id: true,
          name: true,
          center: { select: { name: true } },
        },
      },
    },
  });

  const stats = {
    sessionsFound: sessions.length,
    enrollmentsProcessed: 0,
    sent: 0,
    skippedNoEmail: 0,
    skippedAlreadySent: 0,
    skippedReserved: 0,
    failed: 0,
  };

  for (const session of sessions) {
    // Enrollments đang học (D5 "STUDYING" + legacy "ACTIVE")
    const enrollments = await db.enrollment.findMany({
      where: {
        classId: session.classId,
        status: { in: ["ACTIVE", "STUDYING"] },
        deletedAt: null, // FIX-C3
      },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            parentName: true,
            parentEmail: true,
            status: true,
          },
        },
      },
    });

    for (const enrollment of enrollments) {
      stats.enrollmentsProcessed++;
      const student = enrollment.student;

      // Skip nếu student đang PAUSED/GRADUATED/INACTIVE
      if (student.status !== "ACTIVE") {
        stats.skippedReserved++;
        continue;
      }

      if (!student.parentEmail?.trim()) {
        stats.skippedNoEmail++;
        continue;
      }

      // Idempotency: 1 reminder/session/student trong cửa sổ nhắc (maxHours)
      const contextId = `${session.id}:${student.id}`;
      const alreadySent = await wasReminderSent(
        "ClassSessionReminder",
        contextId,
        maxHours,
      );
      if (alreadySent) {
        stats.skippedAlreadySent++;
        continue;
      }

      const result = await sendEmailForTrigger({
        trigger: "CLASS_REMINDER",
        recipient: {
          email: student.parentEmail,
          name: student.parentName ?? "Quý phụ huynh",
        },
        vars: {
          parent_name: student.parentName ?? "Quý phụ huynh",
          student_name: student.name,
          class_name: session.class.name,
          session_date: session.date,
          center_name: session.class.center?.name ?? "Sata Robo",
          session_topic: session.topic ?? "Buổi học theo lộ trình",
        },
        context: { type: "ClassSessionReminder", id: contextId },
        triggerType: "SYSTEM",
      });

      if (result.ok) stats.sent++;
      else stats.failed++;
    }
  }

  console.log("[cron] class-reminder:", stats);
  return NextResponse.json({ ok: true, stats });
}
