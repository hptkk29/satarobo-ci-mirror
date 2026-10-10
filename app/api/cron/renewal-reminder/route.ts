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

  // Tìm Enrollment ACTIVE/STUDYING có endDate trong cửa sổ nhắc tái tục
  // (SystemSetting cron.renewalReminderMin/MaxDays — default 13-15 ngày).
  // Window ~2 ngày — cron chạy daily, safe nếu skip 1 ngày.
  const now = new Date();
  const [minDays, maxDays, idempotencyDays] = await Promise.all([
    getSetting("cron.renewalReminderMinDays"),
    getSetting("cron.renewalReminderMaxDays"),
    getSetting("cron.renewalReminderIdempotencyDays"),
  ]);
  const minEnd = new Date(now.getTime() + minDays * 86400 * 1000);
  const maxEnd = new Date(now.getTime() + maxDays * 86400 * 1000);

  const enrollments = await db.enrollment.findMany({
    where: {
      status: { in: ["ACTIVE", "STUDYING"] },
      endDate: { gte: minEnd, lte: maxEnd },
      deletedAt: null, // FIX-C3
    },
    include: {
      student: {
        select: {
          name: true,
          parentName: true,
          parentEmail: true,
          status: true,
        },
      },
      course: { select: { name: true } },
    },
  });

  const stats = {
    enrollmentsFound: enrollments.length,
    sent: 0,
    skippedNoEmail: 0,
    skippedAlreadySent: 0,
    skippedReserved: 0,
    failed: 0,
  };

  for (const enrollment of enrollments) {
    const student = enrollment.student;

    if (student.status !== "ACTIVE") {
      stats.skippedReserved++;
      continue;
    }

    if (!student.parentEmail?.trim()) {
      stats.skippedNoEmail++;
      continue;
    }

    // Idempotency: 1 renewal reminder per enrollment trong N ngày (cấu hình)
    const alreadySent = await wasReminderSent(
      "EnrollmentRenewal",
      enrollment.id,
      idempotencyDays * 24,
    );
    if (alreadySent) {
      stats.skippedAlreadySent++;
      continue;
    }

    const endDate = enrollment.endDate!;
    const daysRemaining = Math.ceil(
      (endDate.getTime() - now.getTime()) / 86400000,
    );

    const result = await sendEmailForTrigger({
      trigger: "RENEWAL_REMINDER",
      recipient: {
        email: student.parentEmail,
        name: student.parentName ?? "Quý phụ huynh",
      },
      vars: {
        parent_name: student.parentName ?? "Quý phụ huynh",
        student_name: student.name,
        course_name: enrollment.course.name,
        end_date: endDate,
        days_remaining: String(daysRemaining),
      },
      context: { type: "EnrollmentRenewal", id: enrollment.id },
      triggerType: "SYSTEM",
    });

    if (result.ok) stats.sent++;
    else stats.failed++;
  }

  console.log("[cron] renewal-reminder:", stats);
  return NextResponse.json({ ok: true, stats });
}
