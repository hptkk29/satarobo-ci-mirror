/**
 * A0-07 — DomainEvent outbox + dispatcher (atomic/retry/idempotent/allSettled). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { assertTestDb } from "../_helpers/seed";
import { publishEvent } from "../../../lib/events/publish";
import { dispatchPendingEvents } from "../../../lib/events/dispatcher";
import { on, clearHandlers } from "../../../lib/events/registry";
import {
  registerPingDemo,
  resetPingDemo,
  handlerB,
  handlerAlwaysFail,
  pingMarkers,
} from "../../../lib/events/_demo/ping-handlers";

test.describe("[A0-07] DomainEvent outbox", () => {
  test.beforeEach(async () => {
    assertTestDb();
    await db.domainEvent.deleteMany({});
    clearHandlers();
    resetPingDemo();
    registerPingDemo(); // demo.ping → handlerA + handlerB
    on("demo.fail", handlerAlwaysFail);
    on("demo.mix", handlerB);
    on("demo.mix", handlerAlwaysFail);
  });

  test("[A0-07-T6-01] publish trong tx rồi rollback → KHÔNG có event (AC1 atomic)", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await publishEvent("demo.ping", { msg: "x" }, { tx });
        throw new Error("rollback");
      }),
    ).rejects.toThrow();
    expect(await db.domainEvent.count({ where: { type: "demo.ping" } })).toBe(0);
  });

  test("[A0-07-T1-01] commit → dispatcher → DONE + handlers chạy (AC2)", async () => {
    await publishEvent("demo.ping", { msg: "hi" });
    const r = await dispatchPendingEvents({ flagOn: true });
    expect(r.done).toBe(1);
    const ev = await db.domainEvent.findFirst({ where: { type: "demo.ping" } });
    expect(ev?.status).toBe("DONE");
    expect(pingMarkers).toEqual(expect.arrayContaining(["A:hi", "B:hi"]));
  });

  test("[A0-07-T6-03] dedupeKey trùng → không tạo trùng (AC7)", async () => {
    await publishEvent("demo.ping", { msg: "1" }, { dedupeKey: "k1" });
    await publishEvent("demo.ping", { msg: "2" }, { dedupeKey: "k1" });
    expect(await db.domainEvent.count({ where: { dedupeKey: "k1" } })).toBe(1);
  });

  test("[A0-07-T8-01/02] handler fail → retry rồi FAILED (AC3)", async () => {
    await publishEvent("demo.fail", {}, { maxAttempts: 2 });
    await dispatchPendingEvents({ flagOn: true });
    let ev = await db.domainEvent.findFirst({ where: { type: "demo.fail" } });
    expect(ev?.status).toBe("PENDING");
    expect(ev?.attempts).toBe(1);
    await dispatchPendingEvents({ flagOn: true });
    ev = await db.domainEvent.findFirst({ where: { type: "demo.fail" } });
    expect(ev?.status).toBe("FAILED");
    expect(ev?.attempts).toBe(2);
    expect(ev?.lastError).toContain("lỗi");
  });

  test("[A0-07-T8-03] 1 trong 2 handler fail → handler kia vẫn chạy (AC6 allSettled)", async () => {
    await publishEvent("demo.mix", { msg: "m" });
    await dispatchPendingEvents({ flagOn: true });
    expect(pingMarkers).toContain("B:m"); // B chạy dù handlerAlwaysFail lỗi
    const ev = await db.domainEvent.findFirst({ where: { type: "demo.mix" } });
    expect(ev?.status).toBe("PENDING"); // có lỗi → không DONE
  });

  test("[A0-07-T12-01] dispatcher_enabled=false → không xử lý (AC8)", async () => {
    await publishEvent("demo.ping", { msg: "off" });
    const r = await dispatchPendingEvents({ flagOn: false });
    expect(r.skipped).toBe(true);
    const ev = await db.domainEvent.findFirst({ where: { type: "demo.ping" } });
    expect(ev?.status).toBe("PENDING");
  });

  test("[A0-07-T6-04] event PROCESSING không bị xử lý đôi (claim)", async () => {
    const ev = await publishEvent("demo.ping", { msg: "claimed" });
    await db.domainEvent.update({ where: { id: ev!.id }, data: { status: "PROCESSING" } });
    const r = await dispatchPendingEvents({ flagOn: true });
    expect(r.claimed).toBe(0); // chỉ fetch PENDING
    const after = await db.domainEvent.findUnique({ where: { id: ev!.id } });
    expect(after?.status).toBe("PROCESSING");
  });
});
