import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { dispatchPendingEvents, reapStuckEvents } from "@/lib/events/dispatcher";
import { publishEvent } from "@/lib/events/publish";
import { ensureHandlersRegistered } from "@/lib/events/register";
import { on } from "@/lib/events/registry";
import { recordTransaction } from "@/lib/satacoin/service";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [DSP] Dispatcher DomainEvent — độ ổn định (V8.28). POSTGRES THẬT (DB nháp), gọi thẳng `dispatchPendingEvents` / `reapStuckEvents` (cùng hàm mà `GET /api/cron/dispatch-events` gọi).
 * Tiền tố `v828.` cho loại sự kiện thử; dọn theo loại + học viên `dsp-`.
 *   [DSP-01] BA dispatcher chạy ĐỒNG THỜI trên 12 sự kiện ⇒ mỗi sự kiện được xử lý ĐÚNG MỘT lần (claim có điều kiện), mọi dòng DONE
 *   [DSP-02] đường THẬT: coin +N ghi sổ ⇒ coin.earned; HAI dispatcher đồng thời ⇒ ĐÚNG MỘT Notification
 *   [DSP-03] xử lý LẠI một sự kiện đã DONE (PENDING lại) ⇒ vẫn MỘT Notification (handler idempotent theo dedupeKey)
 *   [DSP-04] retry: lỗi 2 lần rồi thành công ⇒ PENDING(attempts1,2) → DONE; luôn lỗi ⇒ FAILED đúng maxAttempts, lastError có, KHÔNG bị nhặt lại
 *   [DSP-05] reaper: PROCESSING treo > 5' về PENDING; PROCESSING mới KHÔNG bị đụng
 *   [DSP-06] publishEvent cùng dedupeKey (kể cả đồng thời) ⇒ MỘT DomainEvent
 *   [DSP-07] cờ DISPATCHER_ENABLED=false ⇒ bỏ qua, không claim
 *   [DSP-09] LEASE: sự kiện tồn LÂU (createdAt cũ) mà vừa được claim/đang có nhịp tim KHÔNG bị reaper thu hồi; lease quá hạn ⇒ thu hồi + tính MỘT lần thử (đủ maxAttempts ⇒ FAILED); hàng cũ chưa có cột lease rơi về createdAt
 *   [DSP-10] handler chạy lâu gấp 3 lần lease + reaper chạy liên tục ở worker khác ⇒ NHỊP TIM giữ lease: handler chạy ĐÚNG MỘT lần, DONE, attempts 1
 *   [DSP-11] HÀNG RÀO: mất lease giữa chừng (worker khác nhận) ⇒ worker cũ KHÔNG ghi đè trạng thái, `matLease` đếm
 *   [DSP-12] đo được: sự kiện DONE có claimedAt/claimedBy và processedAt ≥ claimedAt (nền cho chỉ số p95); lỗi ĐỒNG BỘ của handler cũng thành retry
 *   [DSP-08] ngữ nghĩa AT-LEAST-ONCE: handler này lỗi, handler kia thành công ⇒ lượt retry chạy lại CẢ HAI (handler phải idempotent — ghim để không ai tin là exactly-once)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const HS = "dsp-hs";
const lanChay = new Map<string, number>();
const dem = (k: string) => lanChay.get(k) ?? 0;
const tang = (k: string) => lanChay.set(k, dem(k) + 1);
const soLanLoi = 0;

async function don() {
  const txs = await db.sataCoinTransaction.findMany({ where: { studentId: HS }, select: { id: true } });
  await db.domainEvent.deleteMany({ where: { OR: [{ type: { startsWith: "v828." } }, { dedupeKey: { in: txs.map((t) => `coin.earned:${t.id}`) } }, { dedupeKey: { startsWith: "v828-" } }] } });
  await db.notification.deleteMany({ where: { studentId: HS } });
  await db.sataCoinTransaction.deleteMany({ where: { studentId: HS } });
  await db.student.deleteMany({ where: { id: HS } });
}
const taoSuKien = (type: string, n: number, extra: Record<string, unknown> = {}) =>
  Promise.all(Array.from({ length: n }, (_, i) => publishEvent(type, { i }, { dedupeKey: `v828-${type}-${i}-${Math.random().toString(36).slice(2, 8)}`, ...extra })));
const LON = { batchSize: 1000 };

describe.skipIf(!RUN)("[DSP] Dispatcher DomainEvent — Postgres thật", () => {
  beforeAll(async () => {
    process.env.PORTAL_SATACOIN_ENABLED = "true";
    delete process.env.DISPATCHER_ENABLED;
    await don();
    await db.student.create({ data: { id: HS, name: "Bé Dispatcher Thử" } as never });
    ensureHandlersRegistered();
    on("v828.dem", async (e) => { tang(e.id); });
    on("v828.hai-lan-loi", async (e) => { tang(e.id); if (dem(e.id) <= 2) throw new Error("lỗi tạm thời"); });
    on("v828.luon-loi", async () => { throw new Error("lỗi vĩnh viễn"); });
    on("v828.cham", async (e) => { tang(e.id); await new Promise((ok) => setTimeout(ok, 1800)); });
    on("v828.mat-lease", async (e) => {
      tang(e.id);
      await db.domainEvent.update({ where: { id: e.id }, data: { claimedBy: "worker-khac", heartbeatAt: new Date() } }); // worker khác đã nhận lại
    });
    on("v828.dong-bo", () => { tang("dong-bo"); throw new Error("lỗi đồng bộ"); });
    on("v828.nua-nua", async (e) => { tang(`tot:${e.id}`); });
    on("v828.nua-nua", async (e) => { tang(`xau:${e.id}`); if (dem(`xau:${e.id}`) < 2) throw new Error("handler xấu lần đầu"); });
  });
  afterAll(async () => {
    await don();
    delete process.env.PORTAL_SATACOIN_ENABLED;
  });

  it("[DSP-01] ba dispatcher đồng thời trên 12 sự kiện ⇒ mỗi sự kiện xử lý ĐÚNG MỘT lần, tất cả DONE", async () => {
    const evs = (await taoSuKien("v828.dem", 12)).filter((e): e is NonNullable<typeof e> => !!e);
    expect(evs).toHaveLength(12);
    const kq = await Promise.all([dispatchPendingEvents(LON), dispatchPendingEvents(LON), dispatchPendingEvents(LON)]);
    for (const e of evs) expect(dem(e.id), `sự kiện ${e.id}`).toBe(1);
    const dong = await db.domainEvent.findMany({ where: { id: { in: evs.map((e) => e.id) } }, select: { status: true, attempts: true } });
    expect(dong.every((d) => d.status === "DONE" && d.attempts === 1)).toBe(true);
    expect(kq.reduce((t, r) => t + r.done, 0)).toBeGreaterThanOrEqual(12);
  });

  it("[DSP-02] coin +N: HAI dispatcher đồng thời ⇒ ĐÚNG MỘT Notification (đường ghi sổ thật)", async () => {
    const r = await recordTransaction({ studentId: HS, amount: 5, type: "EARN", reason: "DSP-02", eventKey: "dsp-02" });
    expect(r.ok).toBe(true);
    await Promise.all([dispatchPendingEvents(LON), dispatchPendingEvents(LON)]);
    const ev = await db.domainEvent.findUnique({ where: { dedupeKey: `coin.earned:${r.txId}` }, select: { status: true } });
    expect(ev?.status).toBe("DONE");
    expect(await db.notification.count({ where: { studentId: HS, dedupeKey: { startsWith: `coin.earned:${r.txId}` } } })).toBe(1);
  });

  it("[DSP-03] sự kiện đã DONE bị đặt PENDING lại (như bị reaper nhặt lại) ⇒ chạy lại vẫn MỘT Notification", async () => {
    const r = await recordTransaction({ studentId: HS, amount: 3, type: "EARN", reason: "DSP-03", eventKey: "dsp-03" });
    await dispatchPendingEvents(LON);
    const khoa = `coin.earned:${r.txId}`;
    expect((await db.domainEvent.findUnique({ where: { dedupeKey: khoa } }))?.status).toBe("DONE");
    await db.domainEvent.update({ where: { dedupeKey: khoa }, data: { status: "PENDING" } });
    await dispatchPendingEvents(LON);
    expect((await db.domainEvent.findUnique({ where: { dedupeKey: khoa } }))?.status).toBe("DONE");
    expect(await db.notification.count({ where: { studentId: HS, dedupeKey: { startsWith: khoa } } })).toBe(1);
  });

  it("[DSP-04] retry: lỗi hai lần rồi thành công ⇒ DONE; luôn lỗi ⇒ FAILED đúng maxAttempts và không bị nhặt lại", async () => {
    const ev = (await publishEvent("v828.hai-lan-loi", {}, { dedupeKey: `v828-retry-${Date.now()}` }))!;
    await dispatchPendingEvents(LON);
    let r = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect([r.status, r.attempts]).toEqual(["PENDING", 1]);
    expect(r.lastError).toContain("lỗi tạm thời");
    await dispatchPendingEvents(LON);
    r = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect([r.status, r.attempts]).toEqual(["PENDING", 2]);
    await dispatchPendingEvents(LON);
    r = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect([r.status, r.attempts]).toEqual(["DONE", 3]);

    const hong = (await publishEvent("v828.luon-loi", {}, { dedupeKey: `v828-hong-${Date.now()}`, maxAttempts: 3 }))!;
    for (let i = 0; i < 3; i++) await dispatchPendingEvents(LON);
    const f = (await db.domainEvent.findUnique({ where: { id: hong.id } }))!;
    expect([f.status, f.attempts]).toEqual(["FAILED", 3]);
    expect(f.lastError).toContain("lỗi vĩnh viễn");
    const them = await dispatchPendingEvents(LON);
    expect((await db.domainEvent.findUnique({ where: { id: hong.id } }))!.attempts).toBe(3); // FAILED không bị nhặt lại
    expect(them.failed).toBe(0);
  });

  it("[DSP-05] reaper: PROCESSING treo > 5 phút ⇒ PENDING; PROCESSING mới KHÔNG bị đụng", async () => {
    const cu = await db.domainEvent.create({ data: { type: "v828.dem", payloadJson: {}, status: "PROCESSING", dedupeKey: `v828-reap-cu-${Date.now()}`, createdAt: new Date(Date.now() - 10 * 60_000) } });
    const moi = await db.domainEvent.create({ data: { type: "v828.dem", payloadJson: {}, status: "PROCESSING", dedupeKey: `v828-reap-moi-${Date.now()}` } });
    expect(await reapStuckEvents()).toBeGreaterThanOrEqual(1);
    expect((await db.domainEvent.findUnique({ where: { id: cu.id } }))?.status).toBe("PENDING");
    expect((await db.domainEvent.findUnique({ where: { id: moi.id } }))?.status).toBe("PROCESSING");
    await db.domainEvent.update({ where: { id: moi.id }, data: { status: "DONE" } });
    await dispatchPendingEvents(LON);
  });

  it("[DSP-06] publishEvent cùng dedupeKey (kể cả đồng thời, trong và ngoài giao dịch) ⇒ MỘT DomainEvent", async () => {
    const khoa = `v828-pub-${Date.now()}`;
    const kq = await Promise.all([1, 2, 3, 4].map(() => publishEvent("v828.dem", {}, { dedupeKey: khoa })));
    expect(new Set(kq.map((e) => e?.id)).size).toBe(1);
    const khoa2 = `v828-pub-tx-${Date.now()}`;
    await db.$transaction(async (tx) => { await publishEvent("v828.dem", {}, { tx, dedupeKey: khoa2 }); await publishEvent("v828.dem", {}, { tx, dedupeKey: khoa2 }); });
    expect(await db.domainEvent.count({ where: { dedupeKey: { in: [khoa, khoa2] } } })).toBe(2);
    await dispatchPendingEvents(LON);
  });

  it("[DSP-07] DISPATCHER_ENABLED=false ⇒ bỏ qua, không claim", async () => {
    const ev = (await publishEvent("v828.dem", {}, { dedupeKey: `v828-tat-${Date.now()}` }))!;
    process.env.DISPATCHER_ENABLED = "false";
    try {
      expect(await dispatchPendingEvents(LON)).toMatchObject({ skipped: true, claimed: 0 });
    } finally { delete process.env.DISPATCHER_ENABLED; }
    expect((await db.domainEvent.findUnique({ where: { id: ev.id } }))?.status).toBe("PENDING");
    await dispatchPendingEvents(LON);
  });

  it("[DSP-09] lease: sự kiện tồn lâu mà đang được giữ KHÔNG bị thu hồi; lease quá hạn ⇒ thu hồi + tính một lần thử; hàng cũ rơi về createdAt", async () => {
    const phut = (n: number) => new Date(Date.now() - n * 60_000);
    const tao = (k: string, d: Record<string, unknown>) => db.domainEvent.create({ data: { type: "v828.dem", payloadJson: {}, status: "PROCESSING", dedupeKey: `v828-lease-${k}-${Date.now()}`, ...d } as never });
    const tonLauVuaNhan = await tao("a", { createdAt: phut(30), claimedAt: new Date(), claimedBy: "w1", heartbeatAt: new Date() }); // PENDING 30 phút rồi mới được nhận
    const nhipConTuoi = await tao("c", { claimedAt: phut(10), claimedBy: "w1", heartbeatAt: phut(1) });
    const hetHan = await tao("b", { claimedAt: phut(10), claimedBy: "w1" });
    const cuHetHan = await tao("d", { createdAt: phut(10) }); // hàng cũ: chưa có cột lease
    const cuMoi = await tao("e", {});
    const gioiHan = await tao("f", { attempts: 4, claimedAt: phut(10), claimedBy: "w1" }); // maxAttempts mặc định 5
    const n = await reapStuckEvents();
    expect(n).toBeGreaterThanOrEqual(3);
    const doc = async (e: { id: string }) => (await db.domainEvent.findUnique({ where: { id: e.id } }))!;
    expect((await doc(tonLauVuaNhan)).status).toBe("PROCESSING"); // LỖ HỔNG CŨ: reaper theo createdAt sẽ nhặt nó ngay
    expect((await doc(nhipConTuoi)).status).toBe("PROCESSING");
    const h = await doc(hetHan);
    expect([h.status, h.attempts, h.claimedBy, h.claimedAt]).toEqual(["PENDING", 1, null, null]);
    expect(h.lastError).toContain("lease");
    expect([(await doc(cuHetHan)).status, (await doc(cuHetHan)).attempts]).toEqual(["PENDING", 1]);
    expect((await doc(cuMoi)).status).toBe("PROCESSING");
    const g = await doc(gioiHan);
    expect([g.status, g.attempts]).toEqual(["FAILED", 5]);
    expect(g.lastError).toContain("lease");
    await db.domainEvent.updateMany({ where: { id: { in: [tonLauVuaNhan.id, nhipConTuoi.id, cuMoi.id] } }, data: { status: "DONE" } });
    await dispatchPendingEvents(LON);
  });

  it("[DSP-10] handler chạy lâu gấp 3 lần lease + reaper chạy liên tục ở worker khác ⇒ nhịp tim giữ lease: chạy ĐÚNG MỘT lần, DONE", async () => {
    const ev = (await publishEvent("v828.cham", {}, { dedupeKey: `v828-cham-${Date.now()}` }))!;
    const LEASE = 600;
    let dung = false;
    const reaper = (async () => { while (!dung) { await reapStuckEvents(new Date(), LEASE); await new Promise((ok) => setTimeout(ok, 120)); } })();
    const [a, b] = await Promise.all([dispatchPendingEvents({ ...LON, leaseMs: LEASE }), dispatchPendingEvents({ ...LON, leaseMs: LEASE })]);
    dung = true; await reaper;
    expect(dem(ev.id)).toBe(1);
    const r = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect([r.status, r.attempts]).toEqual(["DONE", 1]);
    expect(a.claimed + b.claimed).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it("[DSP-11] hàng rào: mất lease giữa chừng ⇒ worker cũ KHÔNG ghi đè; matLease đếm", async () => {
    const ev = (await publishEvent("v828.mat-lease", {}, { dedupeKey: `v828-matlease-${Date.now()}` }))!;
    const kq = await dispatchPendingEvents(LON);
    const r = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect([r.status, r.claimedBy]).toEqual(["PROCESSING", "worker-khac"]); // worker cũ không đổi thành DONE
    expect(kq.matLease).toBe(1);
    expect(kq.done).toBe(0);
    await db.domainEvent.update({ where: { id: ev.id }, data: { status: "DONE" } });
  });

  it("[DSP-12] đo được thời gian xử lý (processedAt ≥ claimedAt) và lỗi ĐỒNG BỘ của handler thành retry (không kẹt PROCESSING)", async () => {
    const ev = (await publishEvent("v828.dem", {}, { dedupeKey: `v828-do-${Date.now()}` }))!;
    await dispatchPendingEvents(LON);
    const r = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect(r.status).toBe("DONE");
    expect(r.claimedBy).toBeTruthy();
    expect(r.claimedAt && r.processedAt && r.processedAt.getTime() >= r.claimedAt.getTime()).toBe(true);
    const dbo = (await publishEvent("v828.dong-bo", {}, { dedupeKey: `v828-dongbo-${Date.now()}`, maxAttempts: 2 }))!;
    await dispatchPendingEvents(LON);
    const d1 = (await db.domainEvent.findUnique({ where: { id: dbo.id } }))!;
    expect([d1.status, d1.attempts]).toEqual(["PENDING", 1]);
    expect(d1.lastError).toContain("lỗi đồng bộ");
    await dispatchPendingEvents(LON);
    expect((await db.domainEvent.findUnique({ where: { id: dbo.id } }))!.status).toBe("FAILED");
  });

  it("[DSP-08] AT-LEAST-ONCE: một handler lỗi ⇒ lượt retry chạy lại CẢ handler đã thành công (handler bắt buộc idempotent)", async () => {
    const ev = (await publishEvent("v828.nua-nua", {}, { dedupeKey: `v828-nua-${Date.now()}` }))!;
    await dispatchPendingEvents(LON);
    expect((await db.domainEvent.findUnique({ where: { id: ev.id } }))?.status).toBe("PENDING");
    await dispatchPendingEvents(LON);
    expect((await db.domainEvent.findUnique({ where: { id: ev.id } }))?.status).toBe("DONE");
    expect(dem(`tot:${ev.id}`)).toBe(2); // handler tốt bị chạy HAI lần — không phải exactly-once
    expect(soLanLoi).toBe(0);
  });
});
