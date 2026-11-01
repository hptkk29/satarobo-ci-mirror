"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import {
  emailTemplateSchema,
  TRIGGER_VARIABLES,
} from "@/lib/validators/email-template";
import { extractVariables, renderTemplate } from "@/lib/email/render";
import { sendEmail } from "@/lib/email/send";
import { SAMPLE_VARS } from "@/lib/email/sample-vars";
import { getAuditActor } from "@/lib/audit/log";

// EmailTemplate/EmailLog là model global (∉ SCOPED_MODELS) → sdb pass-through.
async function requireEmailsManage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("emails:manage")))
    redirect("/dashboard?error=unauthorized");
  const actor = await resolveActor(session.user.id);
  return { session, sdb: scopedDb(actor) };
}

export async function createTemplateAction(input: unknown) {
  const { sdb } = await requireEmailsManage();
  const parsed = emailTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const data = parsed.data;

  const existing = await sdb.emailTemplate.findUnique({
    where: { code: data.code },
  });
  if (existing)
    return { ok: false as const, error: `Code "${data.code}" đã tồn tại` };

  const usedVars = new Set([
    ...extractVariables(data.subject),
    ...extractVariables(data.bodyText),
    ...extractVariables(data.bodyHtml),
  ]);
  const allowedVars = new Set(TRIGGER_VARIABLES[data.trigger]);
  const unknown = Array.from(usedVars).filter((v) => !allowedVars.has(v));
  if (data.trigger !== "MANUAL" && unknown.length > 0) {
    return {
      ok: false as const,
      error: `Biến không hợp lệ cho trigger ${data.trigger}: ${unknown.join(", ")}. Hợp lệ: ${TRIGGER_VARIABLES[data.trigger].join(", ")}`,
    };
  }

  const template = await sdb.emailTemplate.create({
    data: {
      code: data.code,
      name: data.name,
      description: data.description ?? null,
      trigger: data.trigger,
      isActive: data.isActive,
      subject: data.subject,
      bodyText: data.bodyText,
      bodyHtml: data.bodyHtml,
      availableVariables:
        data.availableVariables.length > 0
          ? data.availableVariables
          : Array.from(usedVars),
      fromName: data.fromName ?? null,
      replyTo: data.replyTo ?? null,
    },
  });

  revalidatePath("/email-templates");
  return { ok: true as const, templateId: template.id };
}

export async function updateTemplateAction(id: string, input: unknown) {
  const { sdb } = await requireEmailsManage();
  const parsed = emailTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const data = parsed.data;

  const existing = await sdb.emailTemplate.findUnique({ where: { id } });
  if (!existing)
    return { ok: false as const, error: "Template không tồn tại" };

  if (data.code !== existing.code) {
    return {
      ok: false as const,
      error: "Không thể sửa code sau khi tạo (tránh break trigger)",
    };
  }

  const usedVars = new Set([
    ...extractVariables(data.subject),
    ...extractVariables(data.bodyText),
    ...extractVariables(data.bodyHtml),
  ]);
  const allowedVars = new Set(TRIGGER_VARIABLES[data.trigger]);
  const unknown = Array.from(usedVars).filter((v) => !allowedVars.has(v));
  if (data.trigger !== "MANUAL" && unknown.length > 0) {
    return {
      ok: false as const,
      error: `Biến không hợp lệ: ${unknown.join(", ")}. Hợp lệ: ${TRIGGER_VARIABLES[data.trigger].join(", ")}`,
    };
  }

  await sdb.emailTemplate.update({
    where: { id },
    data: {
      name: data.name,
      description: data.description ?? null,
      trigger: data.trigger,
      isActive: data.isActive,
      subject: data.subject,
      bodyText: data.bodyText,
      bodyHtml: data.bodyHtml,
      availableVariables:
        data.availableVariables.length > 0
          ? data.availableVariables
          : Array.from(usedVars),
      fromName: data.fromName ?? null,
      replyTo: data.replyTo ?? null,
    },
  });

  revalidatePath("/email-templates");
  revalidatePath(`/email-templates/${id}`);
  revalidatePath(`/email-templates/${id}/edit`);
  return { ok: true as const, templateId: id };
}

export async function toggleTemplateActiveAction(id: string) {
  const { sdb } = await requireEmailsManage();
  const existing = await sdb.emailTemplate.findUnique({
    where: { id },
    select: { isActive: true },
  });
  if (!existing)
    return { ok: false as const, error: "Template không tồn tại" };

  await sdb.emailTemplate.update({
    where: { id },
    data: { isActive: !existing.isActive },
  });

  revalidatePath("/email-templates");
  return { ok: true as const, isActive: !existing.isActive };
}

export async function deleteTemplateAction(id: string) {
  const { sdb } = await requireEmailsManage();
  const logCount = await sdb.emailLog.count({ where: { templateId: id } });
  if (logCount > 0) {
    return {
      ok: false as const,
      error: `Template đã có ${logCount} email logs. Đặt isActive=false thay vì xoá.`,
    };
  }
  await sdb.emailTemplate.delete({ where: { id } });
  revalidatePath("/email-templates");
  return { ok: true as const };
}

// ─── TEST SEND (Phase 5.13.1) ───────────────────────────────────────
export async function sendTestEmailAction(input: {
  templateId: string;
  toEmail: string;
  varOverrides?: Record<string, string>;
}) {
  const { session, sdb } = await requireEmailsManage();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.toEmail)) {
    return { ok: false as const, error: "Email không hợp lệ" };
  }

  const template = await sdb.emailTemplate.findUnique({
    where: { id: input.templateId },
  });
  if (!template)
    return { ok: false as const, error: "Template không tồn tại" };

  const vars: Record<string, string> = {
    ...SAMPLE_VARS[template.trigger],
    ...(input.varOverrides ?? {}),
  };

  const subject = "[TEST] " + renderTemplate(template.subject, vars);
  const bodyText = "[TEST EMAIL]\n\n" + renderTemplate(template.bodyText, vars);
  const bodyHtml =
    '<div style="background:#fef3c7;padding:8px;text-align:center;color:#92400e;font-weight:bold;">[TEST EMAIL]</div>' +
    renderTemplate(template.bodyHtml, vars);

  const { actorId, actorName } = getAuditActor(session);

  const result = await sendEmail({
    to: input.toEmail.trim(),
    subject,
    bodyText,
    bodyHtml,
    templateId: template.id,
    contextType: "TestSend",
    contextId: template.id,
    triggeredByUserId: actorId,
    triggeredByName: actorName,
    triggerType: "MANUAL",
  });

  return result.ok
    ? { ok: true as const, logId: result.logId }
    : { ok: false as const, error: result.error };
}
