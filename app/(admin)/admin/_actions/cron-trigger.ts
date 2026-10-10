"use server";

import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { sendEmailForTrigger } from "@/lib/email/trigger";
import { wasReminderSent } from "@/lib/email/reminder-helpers";
import { revalidatePath } from "next/cache";

/**
 * Manual trigger CLASS_REMINDER cho một ClassSession cụ thể.
 * Dùng cho test hoặc khi cron miss.
 */
export async function triggerClassReminderAction(input: { sessionId: string }) {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: "Chưa đăng nhập" };
  if (!(await checkPermission("emails:manage"))) {
    return { ok: false as const, error: "Không có quyền" };
  }

  // Cách ly cơ sở: ClassSession/Enrollment ∈ SCOPED_MODELS → sdb tự inject
  // `centerId IN visible`; buổi cơ sở khác → findUnique trả null (chống IDOR).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const cs = await sdb.classSession.findUnique({
    where: { id: input.sessionId },
    include: {
      class: {
        select: {
          name: true,
          center: { select: { name: true } },
        },
      },
    },
  });
  if (!cs) return { ok: false as const, error: "Buổi học không tồn tại" };

  const enrollments = await sdb.enrollment.findMany({
    where: {
      classId: cs.classId,
      status: { in: ["ACTIVE", "STUDYING"] },
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

  let sent = 0;
  let skipped = 0;

  for (const e of enrollments) {
    const s = e.student;
    if (s.status !== "ACTIVE" || !s.parentEmail?.trim()) {
      skipped++;
      continue;
    }
    const contextId = `${cs.id}:${s.id}`;
    if (await wasReminderSent("ClassSessionReminder", contextId)) {
      skipped++;
      continue;
    }
    const result = await sendEmailForTrigger({
      trigger: "CLASS_REMINDER",
      recipient: {
        email: s.parentEmail,
        name: s.parentName ?? "Quý phụ huynh",
      },
      vars: {
        parent_name: s.parentName ?? "Quý phụ huynh",
        student_name: s.name,
        class_name: cs.class.name,
        session_date: cs.date,
        center_name: cs.class.center?.name ?? "Sata Robo",
        session_topic: cs.topic ?? "Buổi học theo lộ trình",
      },
      context: { type: "ClassSessionReminder", id: contextId },
      triggerType: "MANUAL",
      actor: {
        userId: session.user.id,
        name: session.user.name ?? "Admin",
      },
    });
    if (result.ok) sent++;
    else skipped++;
  }

  revalidatePath(`/admin/classes/${cs.classId}`);
  return { ok: true as const, sent, skipped };
}
