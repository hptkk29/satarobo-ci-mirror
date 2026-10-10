// @vitest-environment node
/**
 * Ca [PHM-CRON-*] — route cron `hoa-don-misa-doi-soat`: cổng CRON_SECRET như mọi cron khác, rồi gọi người
 * chạy với cổng lấy qua `layCongHoaDon()` + mốc giờ của lượt. Luật đối soát canh ở
 * `tests/finance/hoa-don-phat-hanh-misa.test.ts` ([PHM-2x]).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  doiSoat: vi.fn(async (_i: { cong: unknown; now: Date }) => ({ quet: 2, daXacNhan: 1, loi: 0, conCho: 1, hong: 0 })),
  cong: { cheDo: "GIA_LAP", moiTruong: "gia-lap" } as unknown,
}));
vi.mock("@/lib/finance/hoa-don/phat-hanh-misa", () => ({ doiSoatPhatHanhTreo: h.doiSoat }));
vi.mock("@/lib/finance/hoa-don/cong-phat-hanh", () => ({ layCongHoaDon: () => h.cong }));

import { NextRequest } from "next/server";
import * as route from "./route";

const BI_MAT = "bi-mat-cron-test-phm";
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
    new NextRequest("http://localhost/api/cron/hoa-don-misa-doi-soat", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("[PHM-CRON-01] cổng CRON_SECRET", () => {
  it("thiếu / sai bearer ⇒ 401, KHÔNG đối soát gì", async () => {
    expect((await goi()).status).toBe(401);
    expect((await goi("Bearer sai")).status).toBe(401);
    expect(h.doiSoat).not.toHaveBeenCalled();
  });

  it("đối chứng: đúng bearer ⇒ 200, đối soát MỘT lần với ĐÚNG cổng của layCongHoaDon + mốc giờ Date", async () => {
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(res.status).toBe(200);
    expect(h.doiSoat).toHaveBeenCalledTimes(1);
    expect(h.doiSoat.mock.calls[0]![0].cong).toBe(h.cong);
    expect(h.doiSoat.mock.calls[0]![0].now).toBeInstanceOf(Date);
    expect(await res.json()).toMatchObject({ ok: true, data: { quet: 2, daXacNhan: 1 } });
  });
});
