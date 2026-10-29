// lib/events/publish.ts — A0-07: ghi DomainEvent (trong transaction nghiệp vụ nếu truyền tx).
import { Prisma, type PrismaClient, type DomainEvent } from "@prisma/client";
import { db } from "@/lib/db";

type TxClient = Prisma.TransactionClient;

/**
 * Ghi 1 DomainEvent PENDING. Truyền `tx` để ghi CÙNG transaction nghiệp vụ
 * (rollback nghiệp vụ → không có event = atomic). `dedupeKey` trùng → trả event cũ.
 *
 * ⚠️ TRONG tx + có `dedupeKey` ⇒ `INSERT … ON CONFLICT DO NOTHING` (`createMany` +
 * `skipDuplicates`), KHÔNG `create` rồi bắt P2002 [vá 06/10/2026, GĐ1 POS — F1/T7].
 *
 * Bản cũ `create` ⇒ P2002 ⇒ `catch` ⇒ `findUnique` trên CÙNG `tx`. Nhưng Postgres đã đánh dấu
 * transaction HỎNG ngay ở câu ném: câu đọc tiếp theo ném `25P02 current transaction is aborted`
 * ⇒ CẢ lượt nghiệp vụ cuộn ngược — với đường tiền (`thuTheoPhieuGop` phát `phieu-gop.da-chia`
 * trong tx rót tiền) nghĩa là một lần phát trùng khoá làm MẤT luôn lượt ghi tiền. Repo đã biết
 * hình dạng này (chú thích `khop-phat-nghe.test.ts`: "dedupeKey kèm mốc dời để tránh P2002 trong
 * transaction") nhưng chưa vá ở gốc. Ca `[POS1-EV-01]` (tests/finance/pos-gd1.test.ts).
 *
 * Đường KHÔNG tx giữ nguyên `create` + bắt P2002: không có transaction nào để hỏng, và
 * `[A0-07-T6-03]` ghim hành vi đó.
 */
export async function publishEvent(
  type: string,
  payload: Record<string, unknown>,
  opts?: { tx?: TxClient; dedupeKey?: string; maxAttempts?: number },
): Promise<DomainEvent | null> {
  const data = {
    type,
    payloadJson: payload as Prisma.InputJsonValue,
    dedupeKey: opts?.dedupeKey ?? null,
    maxAttempts: opts?.maxAttempts ?? 5,
  };

  if (opts?.tx && opts.dedupeKey) {
    // ON CONFLICT DO NOTHING — không ném, transaction nghiệp vụ còn lành.
    await opts.tx.domainEvent.createMany({ data: [data], skipDuplicates: true });
    return opts.tx.domainEvent.findUnique({ where: { dedupeKey: opts.dedupeKey } });
  }

  const client: PrismaClient | TxClient = opts?.tx ?? db;
  try {
    return await client.domainEvent.create({ data });
  } catch (e) {
    // dedupeKey trùng (P2002) → idempotent producer-side: không tạo trùng.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      if (opts?.dedupeKey) {
        return client.domainEvent.findUnique({ where: { dedupeKey: opts.dedupeKey } });
      }
      return null;
    }
    throw e;
  }
}
