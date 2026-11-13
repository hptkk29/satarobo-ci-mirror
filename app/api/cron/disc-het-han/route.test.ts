// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chay: vi.fn(async () => ({ daXuLy: 3, soLo: 1 })),
  claimed: vi.fn(async (_p: { hanNgay: number | null }) => ({ batHan: false, daXuLy: 0, soLo: 0 })),
  han: vi.fn((): number | null => null),
}));
vi.mock("@/lib/disc/store-prisma", () => ({ vongDoiStore: { marker: "store-gia" }, vongDoiClaimedStore: { marker: "store-claimed-gia" } }));
vi.mock("@/lib/disc/vong-doi", () => ({ chayHetHan: h.chay, chayHetHanClaimed: h.claimed, hanLuuClaimedNgay: h.han }));

import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import * as route from "./route";

const BI_MAT = "bi-mat-cron-test-disc";
let cu: string | undefined;
let cuCo: string | undefined;
beforeAll(() => {
  cu = process.env.CRON_SECRET;
  cuCo = process.env.DISC_ENABLED;
  process.env.CRON_SECRET = BI_MAT;
});
afterAll(() => {
  if (cu === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = cu;
  if (cuCo === undefined) delete process.env.DISC_ENABLED;
  else process.env.DISC_ENABLED = cuCo;
});
beforeEach(() => {
  vi.clearAllMocks();
  h.han.mockReturnValue(null);
});

const goi = (auth?: string) =>
  route.GET(new NextRequest("http://localhost/api/cron/disc-het-han", { headers: auth ? { authorization: auth } : {} }));

describe("[DISC-CRON-01] /api/cron/disc-het-han", () => {
  it("không có / sai CRON_SECRET ⇒ 401 và KHÔNG chạy gì", async () => {
    expect((await goi()).status).toBe(401);
    expect((await goi("Bearer sai")).status).toBe(401);
    expect(h.chay).not.toHaveBeenCalled();
  });
  it("đúng bí mật ⇒ 200, gọi chayHetHan với store thật của DISC và chỉ trả SỐ ĐẾM", async () => {
    const r = await goi(`Bearer ${BI_MAT}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, data: { daXuLy: 3, soLo: 1, claimed: { batHan: false, daXuLy: 0, soLo: 0 } } });
    const arg = (h.chay.mock.calls[0] as unknown as [{ store: unknown; now: Date }])[0];
    expect(arg.store).toEqual({ marker: "store-gia" });
    expect(arg.now).toBeInstanceOf(Date);
  });
  it("[S-01] hạn lưu CLAIMED: truyền đúng hạn cấu hình (null = tắt) và store của bài đã nhận; chỉ trả SỐ ĐẾM", async () => {
    await goi(`Bearer ${BI_MAT}`);
    expect(h.claimed.mock.calls[0]![0]).toMatchObject({ hanNgay: null, store: { marker: "store-claimed-gia" } });
    h.han.mockReturnValue(365);
    h.claimed.mockResolvedValueOnce({ batHan: true, daXuLy: 2, soLo: 1 });
    const r = await goi(`Bearer ${BI_MAT}`);
    expect(h.claimed.mock.calls[1]![0].hanNgay).toBe(365);
    expect((await r.json()).data.claimed).toEqual({ batHan: true, daXuLy: 2, soLo: 1 });
  });
  it("vẫn CHẠY khi cờ DISC_ENABLED tắt (tắt tính năng không được làm dừng việc xoá dữ liệu trẻ hết hạn)", async () => {
    delete process.env.DISC_ENABLED;
    expect((await goi(`Bearer ${BI_MAT}`)).status).toBe(200);
    expect(h.chay).toHaveBeenCalledTimes(1);
  });
  it("chayHetHan ném ⇒ 500, không rò chi tiết", async () => {
    h.chay.mockRejectedValueOnce(new Error("password authentication failed for user minh-gia"));
    const r = await goi(`Bearer ${BI_MAT}`);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(/password|minh-gia/);
  });
  // P3: PROD chưa chạy tay migration 20261114* mà crontab đã gọi route này mỗi ngày — "bảng chưa có" không được thành 500 hằng ngày.
  it("[P3] bảng Disc* chưa tồn tại (Prisma P2021) ⇒ 200 {skipped:'CHUA_MIGRATE'}, không 500", async () => {
    h.chay.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("The table `public.DiscSubmission` does not exist in the current database.", { code: "P2021", clientVersion: "x", meta: { table: "public.DiscSubmission" } }));
    const r = await goi(`Bearer ${BI_MAT}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, data: { skipped: "CHUA_MIGRATE" } });
  });
  it("[P3] P2010 'relation \"DiscSubmission\" does not exist' (SQL thô, 42P01) ⇒ cũng bỏ qua", async () => {
    h.chay.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Raw query failed. Code: `42P01`. Message: `relation \"DiscSubmission\" does not exist`", { code: "P2010", clientVersion: "x", meta: { code: "42P01", message: 'relation "DiscSubmission" does not exist' } }));
    expect((await goi(`Bearer ${BI_MAT}`)).status).toBe(200);
  });
  it("[P3] CHỈ nuốt đúng lỗi đó: P2021 của bảng KHÁC, P1001 (không nối được DB), lỗi thường ⇒ vẫn 500", async () => {
    for (const e of [
      new Prisma.PrismaClientKnownRequestError("The table `public.Order` does not exist", { code: "P2021", clientVersion: "x", meta: { table: "public.Order" } }),
      new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "x" }),
      new Error("relation \"DiscSubmission\" does not exist"),
    ]) {
      h.chay.mockRejectedValueOnce(e);
      expect((await goi(`Bearer ${BI_MAT}`)).status).toBe(500);
    }
  });
});
