// lib/events/dispatcher.ts — A0-07: xử lý batch DomainEvent PENDING (cron 1').
// Claim optimistic (PENDING→PROCESSING) chống xử lý đôi; handlers allSettled (1 handler
// fail không chặn handler khác); retry tới maxAttempts → FAILED. Cờ tắt được.
//
// V8.29 — THUÊ XỬ LÝ (lease): lúc claim ghi `claimedAt`/`claimedBy`/`heartbeatAt`; trong lúc handler chạy, nhịp tim làm mới `heartbeatAt` (mỗi lease/3);
// reaper chỉ thu hồi khi nhịp tim (hoặc claimedAt; hoặc createdAt với hàng cũ chưa có 3 cột) quá hạn ⇒ sự kiện tồn lâu mà đang được xử lý hợp lệ KHÔNG bị nhặt về PENDING.
// Ghi kết quả có HÀNG RÀO: chỉ chủ lease (`claimedBy`) được đổi trạng thái; mất lease (bị reaper thu hồi, worker khác nhận) ⇒ bỏ qua, không ghi đè.
// Lease hết hạn tính là MỘT lần thử (attempts+1; đủ maxAttempts ⇒ FAILED) để một sự kiện làm sập worker lặp lại không quay vòng mãi.
// Ngữ nghĩa vẫn AT-LEAST-ONCE: handler phải idempotent (dedupeKey).
import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { isDispatcherEnabled } from "@/lib/flags";
import { getHandlers, decideOutcome } from "@/lib/events/registry";

export type DispatchResult = {
  skipped?: boolean;
  claimed: number;
  done: number;
  retried: number;
  failed: number;
  /** Số lần ghi kết quả bị bỏ qua vì đã mất lease (sự kiện thuộc worker khác). */
  matLease?: number;
};

/** Thời hạn thuê mặc định: 5 phút không có nhịp tim ⇒ coi là worker sập/treo. */
export const THUE_MAC_DINH_MS = 5 * 60_000;

/**
 * Thu hồi sự kiện PROCESSING mà lease đã HẾT HẠN: nhịp tim quá hạn; hoặc chưa có nhịp tim mà `claimedAt` quá hạn; hoặc hàng CŨ (chưa có cột lease) mà `createdAt` quá hạn.
 * Mỗi lần thu hồi tính MỘT lần thử: còn lượt ⇒ PENDING, hết lượt ⇒ FAILED (lastError nêu rõ). Trả số hàng bị thu hồi (cả hai loại).
 */
export async function reapStuckEvents(now = new Date(), timeoutMs = THUE_MAC_DINH_MS): Promise<number> {
  const cutoff = new Date(now.getTime() - timeoutMs);
  const n = await db.$executeRaw(Prisma.sql`
    UPDATE "DomainEvent" SET
      "status" = CASE WHEN "attempts" + 1 >= "maxAttempts" THEN 'FAILED' ELSE 'PENDING' END,
      "attempts" = "attempts" + 1,
      "lastError" = 'lease hết hạn (worker sập hoặc treo)',
      "claimedAt" = NULL, "claimedBy" = NULL, "heartbeatAt" = NULL
    WHERE "status" = 'PROCESSING'
      AND COALESCE("heartbeatAt", "claimedAt", "createdAt") < ${cutoff}
  `);
  return Number(n);
}

export async function dispatchPendingEvents(opts?: {
  batchSize?: number;
  now?: Date;
  flagOn?: boolean;
  /** Thời hạn thuê (ms). Nhịp tim = leaseMs/3. Mặc định 5 phút. */
  leaseMs?: number;
}): Promise<DispatchResult> {
  const flagOn = opts?.flagOn ?? isDispatcherEnabled();
  if (!flagOn) return { skipped: true, claimed: 0, done: 0, retried: 0, failed: 0 };

  const batchSize = opts?.batchSize ?? 50;
  const leaseMs = opts?.leaseMs ?? THUE_MAC_DINH_MS;
  const worker = `${process.pid}:${randomUUID().slice(0, 8)}`; // mỗi lượt gọi MỘT định danh (hai lượt đồng thời trong cùng tiến trình vẫn khác nhau)

  const pending = await db.domainEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  let done = 0,
    retried = 0,
    failed = 0,
    claimed = 0,
    matLease = 0;

  for (const ev of pending) {
    // Claim optimistic: chỉ xử lý nếu CÒN PENDING (chống 2 dispatcher tick xử lý đôi). Ghi kèm lease.
    const tClaim = new Date();
    const lock = await db.domainEvent.updateMany({
      where: { id: ev.id, status: "PENDING" },
      data: { status: "PROCESSING", claimedAt: tClaim, claimedBy: worker, heartbeatAt: tClaim },
    });
    if (lock.count === 0) continue;
    claimed++;

    // Nhịp tim: giữ lease trong lúc handler chạy lâu. Chỉ làm mới khi CÒN là chủ lease.
    const nhip = setInterval(() => {
      void db.domainEvent
        .updateMany({ where: { id: ev.id, status: "PROCESSING", claimedBy: worker }, data: { heartbeatAt: new Date() } })
        .catch(() => undefined);
    }, Math.max(200, Math.floor(leaseMs / 3)));
    nhip.unref?.();

    let results: PromiseSettledResult<void>[];
    try {
      const handlers = getHandlers(ev.type);
      results = await Promise.allSettled(
        handlers.map((h) => Promise.resolve().then(() => h({ id: ev.id, type: ev.type, payload: (ev.payloadJson ?? {}) as Record<string, unknown> }))), // lỗi ĐỒNG BỘ của handler cũng thành rejection
      );
    } finally {
      clearInterval(nhip);
    }
    const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    const attempts = ev.attempts + 1;
    const outcome = decideOutcome({ anyFailed: failures.length > 0, attempts, maxAttempts: ev.maxAttempts });

    // Ghi kết quả CÓ HÀNG RÀO: chỉ khi vẫn là chủ lease. Đổi trạng thái luôn kèm `claimedBy` trong điều kiện.
    const dieuKien = { id: ev.id, status: "PROCESSING", claimedBy: worker };
    if (outcome === "DONE") {
      const r = await db.domainEvent.updateMany({ where: dieuKien, data: { status: "DONE", attempts, processedAt: opts?.now ?? new Date() } });
      if (r.count === 0) matLease++;
      else done++;
    } else {
      const lastError = failures.map((f) => String(f.reason)).join(" | ").slice(0, 500);
      const r = await db.domainEvent.updateMany({
        where: dieuKien,
        data: { status: outcome, attempts, lastError, claimedAt: null, claimedBy: null, heartbeatAt: null },
      });
      if (r.count === 0) matLease++;
      else if (outcome === "FAILED") failed++;
      else retried++;
    }
  }

  return matLease > 0 ? { claimed, done, retried, failed, matLease } : { claimed, done, retried, failed };
}
