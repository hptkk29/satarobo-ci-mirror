import { db } from "@/lib/db";
import { getResendClient, getFromEmail, getReplyTo } from "./resend";

export type SendEmailParams = {
  to: string;
  toName?: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  fromName?: string;
  replyTo?: string;

  templateId?: string | null;
  contextType?: string | null;
  contextId?: string | null;
  triggeredByUserId?: string | null;
  triggeredByName?: string | null;
  triggerType?: "USER_ACTION" | "SYSTEM" | "MANUAL";

  // BGĐ 31/07 — email chứa bí mật dùng-1-lần (mật khẩu cấp tài khoản): bản gửi
  // Resend là bodyText/bodyHtml thật, bản LƯU EmailLog dùng 2 field này (đã mask)
  // để mật khẩu không nằm plaintext trong DB / màn /admin/email-logs.
  logBodyText?: string;
  logBodyHtml?: string;

  /** Tệp đính kèm dạng URL (Resend tự tải) — hoá đơn điện tử dùng URL ký 300 giây. */
  attachments?: { filename: string; path: string }[];
  /** Khoá chống gửi đôi phía Resend (header `Idempotency-Key`). */
  idempotencyKey?: string;
};

export type SendEmailResult =
  | { ok: true; logId: string; resendId: string | null }
  | { ok: false; logId: string; error: string };

/**
 * Send via Resend + log result. Never throws — always returns result.
 */
export async function sendEmail(
  params: SendEmailParams,
): Promise<SendEmailResult> {
  const log = await db.emailLog.create({
    data: {
      templateId: params.templateId ?? null,
      toEmail: params.to,
      toName: params.toName ?? null,
      subject: params.subject,
      bodyText: params.logBodyText ?? params.bodyText,
      bodyHtml: params.logBodyHtml ?? params.bodyHtml,
      status: "PENDING",
      contextType: params.contextType ?? null,
      contextId: params.contextId ?? null,
      triggeredByUserId: params.triggeredByUserId ?? null,
      triggeredByName: params.triggeredByName ?? null,
      triggerType: params.triggerType ?? "SYSTEM",
    },
  });

  const client = getResendClient();
  if (!client) {
    await db.emailLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        failureReason: "RESEND_API_KEY missing — email send skipped",
      },
    });
    return {
      ok: false,
      logId: log.id,
      error: "Email service không khả dụng (thiếu API key)",
    };
  }

  const fromBase = getFromEmail();
  const from = params.fromName
    ? overrideFromDisplayName(fromBase, params.fromName)
    : fromBase;
  const replyTo = params.replyTo ?? getReplyTo();

  try {
    const response = await client.emails.send(
      {
        from,
        to: params.toName ? `${params.toName} <${params.to}>` : params.to,
        subject: params.subject,
        text: params.bodyText,
        html: params.bodyHtml,
        replyTo,
        ...(params.attachments?.length ? { attachments: params.attachments } : {}),
      },
      params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined,
    );

    if (response.error) {
      const reason = `${response.error.name}: ${response.error.message}`;
      await db.emailLog.update({
        where: { id: log.id },
        data: { status: "FAILED", failureReason: reason },
      });
      return { ok: false, logId: log.id, error: reason };
    }

    const resendId = response.data?.id ?? null;
    await db.emailLog.update({
      where: { id: log.id },
      data: {
        status: "SENT",
        resendId,
        sentAt: new Date(),
      },
    });

    if (params.templateId) {
      await db.emailTemplate
        .update({
          where: { id: params.templateId },
          data: {
            sentCount: { increment: 1 },
            lastSentAt: new Date(),
          },
        })
        .catch(() => {});
    }

    return { ok: true, logId: log.id, resendId };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    await db.emailLog.update({
      where: { id: log.id },
      data: { status: "FAILED", failureReason: reason },
    });
    return { ok: false, logId: log.id, error: reason };
  }
}

function overrideFromDisplayName(fromBase: string, newDisplay: string): string {
  const match = fromBase.match(/<(.+)>/);
  if (match) return `${newDisplay} <${match[1]}>`;
  return `${newDisplay} <${fromBase}>`;
}
