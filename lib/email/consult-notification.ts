import { db } from "@/lib/db";
import { sendEmail } from "./send";
import { renderTemplate } from "./render";

const CONSULT_TEMPLATE_CODE = "CONSULT_LEAD_NOTIFICATION_INTERNAL";

type ConsultNotificationParams = {
  leadId: string;
  parentName: string;
  phone: string;
  email?: string | null;
  childName?: string | null;
  courseSlug: string; // VD: "sata1"
  courseName?: string; // VD: "Sata1 - Robosim Master"
  preferredTime?: string;
  landingPage?: string | null;
  createdAt: Date;
};

/**
 * Send consult lead notification to internal admin email.
 * Recipient: process.env.CONSULT_NOTIFICATION_TO (fallback satarobo@gmail.com).
 * Fire-and-forget — never throws.
 */
export async function sendConsultLeadNotification(
  params: ConsultNotificationParams,
): Promise<void> {
  try {
    const to =
      process.env.CONSULT_NOTIFICATION_TO?.trim() || "satarobo@gmail.com";

    const template = await db.emailTemplate.findUnique({
      where: { code: CONSULT_TEMPLATE_CODE },
    });

    if (!template || !template.isActive) {
      console.warn(
        "[consult-notification] template missing or inactive — skipping",
      );
      return;
    }

    const vars: Record<string, string | Date> = {
      lead_id: params.leadId,
      parent_name: params.parentName,
      phone: params.phone,
      email: params.email ?? "(không có)",
      child_name: params.childName ?? "(không có)",
      preferred_time: params.preferredTime ?? "(không có)",
      course_slug: params.courseSlug,
      course_name: params.courseName ?? params.courseSlug,
      landing_page: params.landingPage ?? "/khoa-hoc/" + params.courseSlug,
      created_at: params.createdAt,
    };

    const subject = renderTemplate(template.subject, vars);
    const bodyText = renderTemplate(template.bodyText, vars);
    const bodyHtml = renderTemplate(template.bodyHtml, vars);

    await sendEmail({
      to,
      toName: "Sata Robo Admin",
      subject,
      bodyText,
      bodyHtml,
      fromName: template.fromName ?? undefined,
      replyTo: params.email ?? undefined,
      templateId: template.id,
      contextType: "Lead",
      contextId: params.leadId,
      triggeredByUserId: null,
      triggeredByName: "Website Consult",
      triggerType: "SYSTEM",
    });
  } catch (err) {
    console.error("[consult-notification] error:", err);
  }
}
