// lib/events/dispatcher.ts — A0-07: xử lý batch DomainEvent PENDING (cron 1').
// Claim optimistic (PENDING→PROCESSING) chống xử lý đôi; handlers allSettled (1 handler
// fail không chặn handler khác); retry tới maxAttempts → FAILED. Cờ tắt được.
import { db } from "@/lib/db";
import { isDispatcherEnabled } from "@/lib/flags";
import { getHandlers, decideOutcome } from "@/lib/events/registry";

export type DispatchResult = {
  skipped?: boolean;
  claimed: number;
  done: number;
  retried: number;
  failed: number;
};

/** Đưa event PROCESSING treo (crash) quá `timeoutMs` về PENDING (reaper). */
export async function reapStuckEvents(now = new Date(), timeoutMs = 5 * 60_000): Promise<number> {
  const cutoff = new Date(now.getTime() - timeoutMs);
  const r = await db.domainEvent.updateMany({
    where: { status: "PROCESSING", createdAt: { lt: cutoff } },
    data: { status: "PENDING" },
  });
  return r.count;
}

export async function dispatchPendingEvents(opts?: {
  batchSize?: number;
  now?: Date;
  flagOn?: boolean;
}): Promise<DispatchResult> {
  const flagOn = opts?.flagOn ?? isDispatcherEnabled();
  if (!flagOn) return { skipped: true, claimed: 0, done: 0, retried: 0, failed: 0 };

  const now = opts?.now ?? new Date();
  const batchSize = opts?.batchSize ?? 50;

  const pending = await db.domainEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  let done = 0,
    retried = 0,
    failed = 0,
    claimed = 0;

  for (const ev of pending) {
    // Claim optimistic: chỉ xử lý nếu CÒN PENDING (chống 2 dispatcher tick xử lý đôi).
    const lock = await db.domainEvent.updateMany({
      where: { id: ev.id, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (lock.count === 0) continue;
    claimed++;

    const handlers = getHandlers(ev.type);
    const results = await Promise.allSettled(
      handlers.map((h) =>
        h({ id: ev.id, type: ev.type, payload: (ev.payloadJson ?? {}) as Record<string, unknown> }),
      ),
    );
    const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    const attempts = ev.attempts + 1;
    const outcome = decideOutcome({ anyFailed: failures.length > 0, attempts, maxAttempts: ev.maxAttempts });

    if (outcome === "DONE") {
      await db.domainEvent.update({ where: { id: ev.id }, data: { status: "DONE", attempts, processedAt: now } });
      done++;
    } else {
      const lastError = failures.map((f) => String(f.reason)).join(" | ").slice(0, 500);
      await db.domainEvent.update({ where: { id: ev.id }, data: { status: outcome, attempts, lastError } });
      if (outcome === "FAILED") failed++;
      else retried++;
    }
  }

  return { claimed, done, retried, failed };
}
