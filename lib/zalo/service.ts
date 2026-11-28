import "server-only";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email/queue";
import { znsProvider, type ZaloProvider } from "@/lib/zalo/provider";
import type { Prisma } from "@prisma/client";

// =============================================================================
// Cụm C5 — Gửi thông báo Zalo qua adapter. Tắt an toàn khi thiếu credential:
// log SKIPPED + fallback email (nếu có), KHÔNG ném lỗi phá luồng gọi.
// =============================================================================

export interface ZaloNotifyInput {
  toPhone: string;
  templateKey?: string | null;
  params?: Record<string, string | number>;
  /** Email dự phòng khi Zalo không gửi được (tắt/lỗi). */
  fallbackEmail?: {
    to: string;
    toName?: string | null;
    subject: string;
    bodyText: string;
  } | null;
}

export interface ZaloNotifyResult {
  ok: boolean;
  status: "SENT" | "SKIPPED" | "FAILED";
  fallbackEmailed: boolean;
  logId: string;
}

export async function sendZaloNotification(
  input: ZaloNotifyInput,
  provider: ZaloProvider = znsProvider,
): Promise<ZaloNotifyResult> {
  const configured = provider.isConfigured();

  // Helper: gửi email dự phòng nếu có.
  async function doFallback(): Promise<boolean> {
    if (!input.fallbackEmail?.to) return false;
    await enqueueEmail({
      to: input.fallbackEmail.to,
      toName: input.fallbackEmail.toName ?? undefined,
      subject: input.fallbackEmail.subject,
      bodyText: input.fallbackEmail.bodyText,
      context: { type: "ZALO_FALLBACK", id: input.toPhone },
    }).catch(() => {});
    return true;
  }

  const payload = (input.params ?? {}) as Prisma.InputJsonValue;

  // 1) Chưa cấu hình → SKIPPED + fallback email, không lỗi.
  if (!configured) {
    const fb = await doFallback();
    const log = await db.zaloMessageLog.create({
      data: {
        toPhone: input.toPhone,
        templateKey: input.templateKey ?? null,
        payload,
        status: "SKIPPED",
        errorMessage: "Zalo chưa cấu hình credential",
        fallbackEmailed: fb,
      },
      select: { id: true },
    });
    return { ok: true, status: "SKIPPED", fallbackEmailed: fb, logId: log.id };
  }

  // 2) Đã cấu hình → gọi provider.
  let result;
  try {
    result = await provider.send({ toPhone: input.toPhone, templateKey: input.templateKey, params: input.params });
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : "Unknown" };
  }

  if (result.ok) {
    const log = await db.zaloMessageLog.create({
      data: {
        toPhone: input.toPhone,
        templateKey: input.templateKey ?? null,
        payload,
        status: "SENT",
        providerMessageId: result.providerMessageId ?? null,
        sentAt: new Date(),
      },
      select: { id: true },
    });
    return { ok: true, status: "SENT", fallbackEmailed: false, logId: log.id };
  }

  // 3) Lỗi → FAILED + fallback email.
  const fb = await doFallback();
  const log = await db.zaloMessageLog.create({
    data: {
      toPhone: input.toPhone,
      templateKey: input.templateKey ?? null,
      payload,
      status: "FAILED",
      errorMessage: result.error ?? "Gửi Zalo thất bại",
      fallbackEmailed: fb,
    },
    select: { id: true },
  });
  return { ok: false, status: "FAILED", fallbackEmailed: fb, logId: log.id };
}
