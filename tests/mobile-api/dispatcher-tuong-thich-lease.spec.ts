import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { dispatchPendingEvents, reapStuckEvents } from "@/lib/events/dispatcher";
import { publishEvent } from "@/lib/events/publish";
import { on } from "@/lib/events/registry";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

import { dispatchPendingEvents as dispatchCu, reapStuckEvents as reapCu } from "./_fixtures/dispatcher-v1";

/**
 * [DSP-16..19] LEASE — mất lease thật, tương thích mã CŨ trên schema MỚI, trộn worker cũ/mới (V8.30). Postgres thật (DB nháp). Loại sự kiện `v830.` — dọn theo loại.
 *   [DSP-16] worker A đang chạy handler thì lease HẾT HẠN (reaper thu hồi) ⇒ worker B nhận lại; A xong TRƯỚC khi B xong ⇒ A KHÔNG lật dòng của B sang DONE (hàng rào `claimedBy`), `matLease`; B xong ⇒ DONE; handler chạy 2 lần (at-least-once)
 *   [DSP-17] MÃ CŨ (trước lease) chạy trên schema MỚI: xử lý bình thường, không ghi cột lease, retry/FAILED như cũ ⇒ triển khai «migration TRƯỚC, mã SAU» an toàn
 *   [DSP-18] trộn: worker CŨ giữ sự kiện (không có lease) — reaper MỚI rơi về createdAt: sự kiện mới tạo KHÔNG bị thu hồi; sự kiện tồn lâu bị thu hồi (khoảng hở giai đoạn chuyển tiếp, ghi rõ) và worker cũ ghi kết quả vẫn không làm hỏng (idempotent)
 *   [DSP-19] reaper MỚI trên hàng PROCESSING chưa có lease nào + attempts đủ ⇒ FAILED (không quay vòng mãi)
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));
const LON = { batchSize: 100_000 };
const lan = new Map<string, number>();
const tang = (k: string) => lan.set(k, (lan.get(k) ?? 0) + 1);
const dem = (k: string) => lan.get(k) ?? 0;
const don = () => db.domainEvent.deleteMany({ where: { type: { startsWith: "v830." } } });
const phut = (n: number) => new Date(Date.now() - n * 60_000);
const cho = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

describe.skipIf(!RUN)("[DSP-16..19] lease: mất lease, tương thích mã cũ, trộn worker", () => {
  beforeAll(async () => {
    await don();
    on("v830.cham-lan-dau", async (e) => { tang(e.id); await cho(1500); }); // CẢ HAI lượt đều chậm: A xong TRƯỚC khi B xong
    on("v830.dem", async (e) => { tang(e.id); });
    on("v830.loi-cu", async () => { throw new Error("lỗi thử mã cũ"); });
  });
  afterAll(don);

  it("[DSP-16] mất lease giữa handler: B nhận lại và xong; A xong sau KHÔNG ghi đè; handler chạy 2 lần", async () => {
    const ev = (await publishEvent("v830.cham-lan-dau", {}, { dedupeKey: `v830-mat-${Date.now()}` }))!;
    const A = dispatchPendingEvents({ ...LON, leaseMs: 600_000 }); // lease dài ⇒ A không tự nhịp tim trong 1,5 s
    await cho(400);
    const dangA = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect([dangA.status, dem(ev.id)]).toEqual(["PROCESSING", 1]);
    const claimA = dangA.claimedBy;
    // lease của A hết hạn (nhịp tim quá cũ) ⇒ reaper (ở worker khác) thu hồi, tính một lần thử
    await db.domainEvent.update({ where: { id: ev.id }, data: { heartbeatAt: phut(10), claimedAt: phut(10) } });
    expect(await reapStuckEvents(new Date(), 60_000)).toBeGreaterThanOrEqual(1);
    const saiThuHoi = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect([saiThuHoi.status, saiThuHoi.attempts, saiThuHoi.claimedBy]).toEqual(["PENDING", 1, null]);
    const Bp = dispatchPendingEvents(LON); // worker B nhận lại (handler cũng chậm 1,5 s)
    await cho(400);
    const dangB = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect([dangB.status, dangB.attempts]).toEqual(["PROCESSING", 1]);
    expect(dangB.claimedBy).not.toBe(claimA);
    const claimB = dangB.claimedBy;
    const kqA = await A; // A xong handler TRƯỚC B (B còn đang xử lý)
    expect(kqA.matLease).toBe(1);
    expect(kqA.done).toBe(0);
    const giua = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect([giua.status, giua.claimedBy]).toEqual(["PROCESSING", claimB]); // HÀNG RÀO: A không lật dòng của B sang DONE
    const B = await Bp;
    expect(B.done).toBeGreaterThanOrEqual(1);
    const cuoi = (await db.domainEvent.findUnique({ where: { id: ev.id } }))!;
    expect([cuoi.status, cuoi.attempts, cuoi.claimedBy]).toEqual(["DONE", 2, claimB]);
    expect(dem(ev.id)).toBe(2); // at-least-once
  }, 30_000);

  it("[DSP-17] mã CŨ (trước lease) chạy trên schema MỚI: xử lý bình thường, không ghi cột lease; lỗi ⇒ retry/FAILED như cũ", async () => {
    const ok = (await publishEvent("v830.dem", {}, { dedupeKey: `v830-cu-ok-${Date.now()}` }))!;
    const hong = (await publishEvent("v830.loi-cu", {}, { dedupeKey: `v830-cu-hong-${Date.now()}`, maxAttempts: 2 }))!;
    const kq = await dispatchCu(LON);
    expect(kq.claimed).toBeGreaterThanOrEqual(2);
    const a = (await db.domainEvent.findUnique({ where: { id: ok.id } }))!;
    expect([a.status, a.attempts, a.claimedAt, a.claimedBy, a.heartbeatAt]).toEqual(["DONE", 1, null, null, null]);
    expect((await db.domainEvent.findUnique({ where: { id: hong.id } }))!.status).toBe("PENDING");
    await dispatchCu(LON);
    const f = (await db.domainEvent.findUnique({ where: { id: hong.id } }))!;
    expect([f.status, f.attempts]).toEqual(["FAILED", 2]);
    expect(await reapCu()).toBeGreaterThanOrEqual(0); // reaper cũ vẫn chạy được trên schema mới
  });

  it("[DSP-18] trộn worker cũ/mới: reaper MỚI rơi về createdAt cho hàng không có lease (mới ⇒ giữ; tồn lâu ⇒ thu hồi — khoảng hở chuyển tiếp)", async () => {
    const tao = (k: string, d: Record<string, unknown>) => db.domainEvent.create({ data: { type: "v830.dem", payloadJson: {}, status: "PROCESSING", dedupeKey: `v830-mix-${k}-${Date.now()}`, ...d } as never });
    const moi = await tao("moi", {}); // worker cũ vừa nhận: không lease, createdAt mới
    const tonLau = await tao("lau", { createdAt: phut(30) }); // worker cũ nhận sự kiện tồn lâu: không lease
    await reapStuckEvents();
    expect((await db.domainEvent.findUnique({ where: { id: moi.id } }))!.status).toBe("PROCESSING");
    const t = (await db.domainEvent.findUnique({ where: { id: tonLau.id } }))!;
    expect([t.status, t.attempts]).toEqual(["PENDING", 1]); // = hành vi của reaper CŨ (không tệ hơn hôm nay)
    await db.domainEvent.update({ where: { id: moi.id }, data: { status: "DONE" } });
    await dispatchPendingEvents(LON);
    expect((await db.domainEvent.findUnique({ where: { id: tonLau.id } }))!.status).toBe("DONE");
  });

  it("[DSP-19] PROCESSING chưa có lease + đủ lượt thử ⇒ reaper MỚI đưa về FAILED (không quay vòng mãi)", async () => {
    const e = await db.domainEvent.create({ data: { type: "v830.dem", payloadJson: {}, status: "PROCESSING", attempts: 4, dedupeKey: `v830-poison-${Date.now()}`, createdAt: phut(30) } });
    await reapStuckEvents();
    const r = (await db.domainEvent.findUnique({ where: { id: e.id } }))!;
    expect([r.status, r.attempts]).toEqual(["FAILED", 5]);
    expect(r.lastError).toContain("lease");
  });
});
