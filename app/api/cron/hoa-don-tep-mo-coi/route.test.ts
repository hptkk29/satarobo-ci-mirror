// @vitest-environment node
/**
 * Ca [HTMC-*] — route cron `hoa-don-tep-mo-coi`: cổng CRON_SECRET như mọi cron khác, rồi gọi người chạy
 * với MỐC GIỜ của lượt. Luật chọn/xoá canh ở `lib/finance/hoa-don/{tep-mo-coi,don-tep-mo-coi}.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  don: vi.fn(async (_now: Date) => ({
    boQua: null,
    daXet: 3,
    moCoi: 1,
    daXoa: 1,
    loiXoa: 0,
    conLai: 0,
    catNgang: false,
  })),
}));
vi.mock("@/lib/finance/hoa-don/don-tep-mo-coi", () => ({ donTepHoaDonMoCoi: h.don }));

import { NextRequest } from "next/server";
import * as route from "./route";

const BI_MAT = "bi-mat-cron-test-htmc";
let cu: string | undefined;
beforeAll(() => {
  cu = process.env.CRON_SECRET;
  process.env.CRON_SECRET = BI_MAT;
});
afterAll(() => {
  if (cu === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = cu;
});
beforeEach(() => vi.clearAllMocks());

const goi = (authorization?: string) =>
  route.GET(
    new NextRequest("http://localhost/api/cron/hoa-don-tep-mo-coi", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("[HTMC-01] cổng CRON_SECRET", () => {
  it("thiếu / sai bearer ⇒ 401, KHÔNG dọn gì", async () => {
    expect((await goi()).status).toBe(401);
    expect((await goi("Bearer sai")).status).toBe(401);
    expect(h.don).not.toHaveBeenCalled();
  });

  it("đối chứng: đúng bearer ⇒ 200, dọn MỘT lần với mốc giờ là Date, trả số đếm", async () => {
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(res.status).toBe(200);
    expect(h.don).toHaveBeenCalledTimes(1);
    expect(h.don.mock.calls[0]![0]).toBeInstanceOf(Date);
    expect(await res.json()).toMatchObject({ ok: true, data: { daXet: 3, daXoa: 1 } });
  });
});

describe("[HTMC-02] trần thời gian", () => {
  it("maxDuration = 60 — liệt kê nhiều trang + một lệnh xoá lô", () => {
    expect(route.maxDuration).toBe(60);
  });
});
