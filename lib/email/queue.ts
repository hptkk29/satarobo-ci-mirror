import { db } from "@/lib/db";
import { sendEmail } from "./send";
import { renderTemplate } from "./render";
import type { Prisma } from "@prisma/client";
import { chuanBiGuiHoaDon, ghiKetQuaGuiHoaDon, NGU_CANH_EMAIL_HOA_DON } from "@/lib/finance/hoa-don/dinh-kem-email";

// =============================================================================
// Cụm A2 — Email queue.
// enqueueEmail(): chỉ TẠO bản ghi PENDING (gọi an toàn trong/ngoài transaction
// nghiệp vụ — KHÔNG gửi ngay). processEmailQueue(): worker/cron gửi + retry.
// =============================================================================

type Vars = Record<string, string | number | null | undefined>;

export interface EnqueueEmailInput {
  to: string;
  toName?: string | null;
  /** EmailTemplate.code để render qua template. */
  templateKey?: string | null;
  /** Inline fallback khi không dùng template (subject/body có thể chứa {{var}}). */
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  vars?: Vars;
  scheduledAt?: Date;
  context?: { type: string; id: string };
  /**
   * Transaction của người gọi — dòng hàng đợi commit / rollback CÙNG nghiệp vụ. Hoá đơn điện tử
   * cần điều này: giành lượt gửi + xếp hàng phải nguyên tử (PLAN §7), không thì lỗi xếp hàng để
   * lại một lượt kẹt "đang gửi" mãi.
   */
  tx?: Prisma.TransactionClient;
}

/** Đẩy 1 email vào hàng đợi (status PENDING). Không gửi. */
export async function enqueueEmail(input: EnqueueEmailInput): Promise<{ ok: boolean; id?: string }> {
  const to = input.to?.trim();
  if (!to) return { ok: false };
  const row = await (input.tx ?? db).emailQueue.create({
    data: {
      toEmail: to,
      toName: input.toName ?? null,
      templateKey: input.templateKey ?? null,
      subject: input.subject ?? null,
      bodyText: input.bodyText ?? null,
      bodyHtml: input.bodyHtml ?? null,
      payload: (input.vars ?? {}) as Prisma.InputJsonValue,
      contextType: input.context?.type ?? null,
      contextId: input.context?.id ?? null,
      scheduledAt: input.scheduledAt ?? new Date(),
    },
    select: { id: true },
  });
  return { ok: true, id: row.id };
}

export interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
}

/**
 * Câu lấy lô cho worker. `guiHoaDon = false` (cờ hoá đơn TẮT — GĐ 8) ⇒ LOẠI dòng hoá đơn NGAY TRONG
 * SQL, không lấy lên rồi bỏ qua: lấy-rồi-bỏ thì 25 dòng hoá đơn tồn cũ nhất chiếm trọn lô mỗi nhịp và
 * email thường (OTP, thông báo) chết đói. Nhánh `contextType: null` BẮT BUỘC — trong SQL `NULL <> 'x'`
 * là NULL chứ không phải true, thiếu nó là loại luôn mọi email không có ngữ cảnh.
 */
export function cauLayHangDoi(now: Date, limit: number, opts: { guiHoaDon: boolean }): Prisma.EmailQueueFindManyArgs {
  return {
    where: {
      status: "PENDING",
      scheduledAt: { lte: now },
      ...(opts.guiHoaDon ? {} : { OR: [{ contextType: null }, { contextType: { not: NGU_CANH_EMAIL_HOA_DON } }] }),
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
  };
}

/**
 * Worker: lấy tối đa `limit` email PENDING đến hạn, render + gửi.
 * Thành công → SENT; lỗi → tăng attempts (giữ PENDING để retry), vượt maxAttempts → FAILED.
 * `guiHoaDon` BẮT BUỘC (luật 7) — người gọi đọc cờ hoá đơn; dòng hoá đơn khi TẮT nằm nguyên PENDING.
 */
export async function processEmailQueue(limit: number, opts: { guiHoaDon: boolean }): Promise<ProcessResult> {
  const now = new Date();
  const rows = await db.emailQueue.findMany(cauLayHangDoi(now, limit, opts));

  let sent = 0;
  let failed = 0;
  let boQua = 0;

  for (const row of rows) {
    // Dòng HOÁ ĐƠN ĐIỆN TỬ: đọc LẠI hoá đơn (chỉ gửi bản còn hiệu lực) + ký URL tệp đính kèm.
    // Không tin payload hàng đợi — khoá tệp lấy từ chính hoá đơn (lib/finance/hoa-don/dinh-kem-email.ts).
    const laHoaDon = row.contextType === NGU_CANH_EMAIL_HOA_DON && Boolean(row.contextId);
    // Lưới thứ hai sau câu SQL: cờ tắt thì KHÔNG đụng dòng hoá đơn — không gửi, không ghi, giữ PENDING.
    if (laHoaDon && !opts.guiHoaDon) {
      boQua++;
      continue;
    }
    const vars = (row.payload ?? {}) as Vars;

    // Resolve subject/body: ưu tiên template theo code, fallback inline.
    let subject = row.subject ?? "";
    let bodyText = row.bodyText ?? "";
    let bodyHtml = row.bodyHtml ?? "";
    let templateId: string | null = null;
    let fromName: string | null = null;
    let replyTo: string | null = null;

    if (row.templateKey) {
      const tpl = await db.emailTemplate.findUnique({ where: { code: row.templateKey } });
      if (tpl && tpl.isActive) {
        subject = tpl.subject;
        bodyText = tpl.bodyText;
        bodyHtml = tpl.bodyHtml;
        templateId = tpl.id;
        fromName = tpl.fromName;
        replyTo = tpl.replyTo;
      }
    }

    subject = renderTemplate(subject, vars);
    bodyText = renderTemplate(bodyText, vars);
    bodyHtml = renderTemplate(bodyHtml || `<pre>${bodyText}</pre>`, vars);

    let dinhKem: { filename: string; path: string }[] | undefined;
    let idempotencyKey: string | undefined;
    if (laHoaDon) {
      const cb = await chuanBiGuiHoaDon(row.contextId as string);
      if (!cb.ok) {
        const attempts = row.attempts + 1;
        const cuoiCung = cb.chan || attempts >= row.maxAttempts;
        await db.emailQueue.update({
          where: { id: row.id },
          data: {
            attempts,
            error: cb.loi,
            status: cuoiCung ? "FAILED" : "PENDING",
            scheduledAt: cuoiCung ? row.scheduledAt : new Date(Date.now() + 5 * 60_000),
          },
        });
        await ghiKetQuaGuiHoaDon(row.contextId as string, { daGui: false, loi: cb.loi, cuoiCung });
        failed++;
        continue;
      }
      dinhKem = cb.attachments;
      idempotencyKey = cb.idempotencyKey;
    }

    if (!subject || !bodyText) {
      // Thiếu nội dung (không template, không inline) → FAILED, không retry.
      await db.emailQueue.update({
        where: { id: row.id },
        data: { status: "FAILED", error: "Thiếu template/nội dung email", attempts: { increment: 1 } },
      });
      // Dòng hoá đơn: lượt gửi về LOI CÙNG lúc (+ báo người). Thiếu dòng này thì hàng đợi đã bỏ cuộc mà
      // màn kế toán / trang đơn vẫn in "Đang gửi" mãi — hai nơi nói hai điều, không ai được báo.
      if (laHoaDon) {
        await ghiKetQuaGuiHoaDon(row.contextId as string, { daGui: false, loi: "Thiếu nội dung email", cuoiCung: true });
      }
      failed++;
      continue;
    }

    const result = await sendEmail({
      to: row.toEmail,
      toName: row.toName ?? undefined,
      subject,
      bodyText,
      bodyHtml,
      fromName: fromName ?? undefined,
      replyTo: replyTo ?? undefined,
      templateId,
      contextType: row.contextType,
      contextId: row.contextId,
      triggerType: "SYSTEM",
      attachments: dinhKem,
      idempotencyKey,
    });

    if (laHoaDon) {
      const attempts = row.attempts + 1;
      await ghiKetQuaGuiHoaDon(
        row.contextId as string,
        result.ok ? { daGui: true } : { daGui: false, loi: result.error, cuoiCung: attempts >= row.maxAttempts },
      );
    }

    if (result.ok) {
      await db.emailQueue.update({
        where: { id: row.id },
        data: { status: "SENT", sentAt: new Date(), emailLogId: result.logId, error: null },
      });
      sent++;
    } else {
      const attempts = row.attempts + 1;
      const exhausted = attempts >= row.maxAttempts;
      await db.emailQueue.update({
        where: { id: row.id },
        data: {
          attempts,
          error: result.error,
          status: exhausted ? "FAILED" : "PENDING",
          // Lùi lịch retry ~5' mỗi lần.
          scheduledAt: exhausted ? row.scheduledAt : new Date(Date.now() + 5 * 60_000),
        },
      });
      failed++;
    }
  }

  return { processed: rows.length - boQua, sent, failed };
}

/** Gửi lại 1 email FAILED (reset về PENDING). */
export async function retryEmailQueueItem(id: string): Promise<void> {
  await db.emailQueue
    .update({ where: { id }, data: { status: "PENDING", attempts: 0, error: null, scheduledAt: new Date() } })
    .catch(() => {});
}
