import { db } from "@/lib/db";
import { sendEmail } from "./send";
import { renderTemplate } from "./render";
import type { EmailTemplateTrigger } from "@prisma/client";

export type TriggerSendParams = {
  trigger: EmailTemplateTrigger;
  vars: Record<string, string | number | Date | null | undefined>;
  recipient: {
    email: string | null | undefined;
    name?: string | null;
  };
  context?: {
    type: string;
    id: string;
  };
  triggerType?: "SYSTEM" | "USER_ACTION" | "MANUAL";
  actor?: {
    userId: string | null;
    name: string;
  };
};

/**
 * Find an active template for the given trigger, render it, and send.
 * Fire-and-forget pattern: never throws, always logs failures to EmailLog.
 */
export async function sendEmailForTrigger(
  params: TriggerSendParams,
): Promise<{ ok: true; logId: string } | { ok: false; skipped: string }> {
  if (!params.recipient.email?.trim()) {
    return { ok: false, skipped: "no_recipient_email" };
  }

  const template = await db.emailTemplate.findFirst({
    where: { trigger: params.trigger, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  if (!template) {
    console.warn(
      `[email] No active template for trigger ${params.trigger} — skipping`,
    );
    return { ok: false, skipped: "no_active_template" };
  }

  const subject = renderTemplate(template.subject, params.vars);
  const bodyText = renderTemplate(template.bodyText, params.vars);
  const bodyHtml = renderTemplate(template.bodyHtml, params.vars);

  const result = await sendEmail({
    to: params.recipient.email,
    toName: params.recipient.name ?? undefined,
    subject,
    bodyText,
    bodyHtml,
    fromName: template.fromName ?? undefined,
    replyTo: template.replyTo ?? undefined,
    templateId: template.id,
    contextType: params.context?.type ?? null,
    contextId: params.context?.id ?? null,
    triggeredByUserId: params.actor?.userId ?? null,
    triggeredByName: params.actor?.name ?? null,
    triggerType: params.triggerType ?? "SYSTEM",
  });

  if (!result.ok) {
    console.error(
      `[email] sendEmailForTrigger ${params.trigger} failed:`,
      result.error,
    );
    return { ok: false, skipped: `send_failed: ${result.error}` };
  }

  return { ok: true, logId: result.logId };
}
