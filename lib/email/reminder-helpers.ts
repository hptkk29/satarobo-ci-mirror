import { db } from "@/lib/db";

/**
 * Check if a reminder has already been sent successfully for given context.
 * Used for idempotency — don't double-send within same window.
 *
 * @param contextType — VD: "ClassSessionReminder", "EnrollmentRenewal"
 * @param contextId — id của session/enrollment
 * @param withinHours — chỉ check trong khoảng N giờ gần đây (default 48h)
 */
export async function wasReminderSent(
  contextType: string,
  contextId: string,
  withinHours = 48,
): Promise<boolean> {
  const since = new Date(Date.now() - withinHours * 3600 * 1000);
  const log = await db.emailLog.findFirst({
    where: {
      contextType,
      contextId,
      status: "SENT",
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return log !== null;
}
