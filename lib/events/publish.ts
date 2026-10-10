// lib/events/publish.ts — A0-07: ghi DomainEvent (trong transaction nghiệp vụ nếu truyền tx).
import { Prisma, type PrismaClient, type DomainEvent } from "@prisma/client";
import { db } from "@/lib/db";

type TxClient = Prisma.TransactionClient;

/**
 * Ghi 1 DomainEvent PENDING. Truyền `tx` để ghi CÙNG transaction nghiệp vụ
 * (rollback nghiệp vụ → không có event = atomic). `dedupeKey` trùng → trả event cũ.
 */
export async function publishEvent(
  type: string,
  payload: Record<string, unknown>,
  opts?: { tx?: TxClient; dedupeKey?: string; maxAttempts?: number },
): Promise<DomainEvent | null> {
  const client: PrismaClient | TxClient = opts?.tx ?? db;
  try {
    return await client.domainEvent.create({
      data: {
        type,
        payloadJson: payload as Prisma.InputJsonValue,
        dedupeKey: opts?.dedupeKey ?? null,
        maxAttempts: opts?.maxAttempts ?? 5,
      },
    });
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
