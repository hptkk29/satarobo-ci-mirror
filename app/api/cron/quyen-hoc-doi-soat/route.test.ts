// @vitest-environment node
/**
 * Ca [HD-CRON-*] — route cron `quyen-hoc-doi-soat`: cổng CRON_SECRET như mọi cron khác, rồi gọi dịch vụ đối soát với đồng hồ của lượt + trần đơn TƯỜNG MINH.
 * Luật đối soát (không cấp / không trùng / cờ tắt) canh ở `tests/finance/hang-doi-quyen-hoc.test.ts` ([HD-DB-*]) và `lib/entitlements/hang-doi/*.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  doiSoat: vi.fn(async (_i: { now: Date; gioiHanDonMoiCoSo: number }) => ({
    chayLuc: "2026-10-12T00:00:00.000Z",
    soCoSoQuet: 1,
    soCoSoBoQua: 1,
    soDonQuet: 3,
    soDonLoi: 0,
    moiTheoLoai: { THIEU_QUYEN_HOC: 1 },
    quaHan: { tong: 0 },
  })),
}));
vi.mock("@/lib/entitlements/hang-doi/doi-soat", () => ({ chayDoiSoatQuyenHoc: h.doiSoat, GIOI_HAN_DON_MOI_CO_SO: 300 }));

import { NextRequest } from "next/server";
import * as route from "./route";

const BI_MAT = "bi-mat-cron-test-hd-doi-soat";
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
  route.GET(new NextRequest("http://localhost/api/cron/quyen-hoc-doi-soat", { headers: authorization ? { authorization } : {} }));

describe("[HD-CRON-01] cổng CRON_SECRET", () => {
  it("thiếu / sai bearer ⇒ 401, KHÔNG đối soát gì", async () => {
    expect((await goi()).status).toBe(401);
    expect((await goi("Bearer sai")).status).toBe(401);
    expect((await goi(`Basic ${BI_MAT}`)).status).toBe(401);
    expect(h.doiSoat).not.toHaveBeenCalled();
  });

  it("đối chứng dương: đúng bearer ⇒ 200, đối soát MỘT lần với mốc giờ Date + trần đơn 300 truyền tường minh; báo cáo trả trong `data`", async () => {
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(res.status).toBe(200);
    expect(h.doiSoat).toHaveBeenCalledTimes(1);
    expect(h.doiSoat.mock.calls[0]![0].now).toBeInstanceOf(Date);
    expect(h.doiSoat.mock.calls[0]![0].gioiHanDonMoiCoSo).toBe(300);
    expect(await res.json()).toMatchObject({ ok: true, data: { soCoSoQuet: 1, soCoSoBoQua: 1, moiTheoLoai: { THIEU_QUYEN_HOC: 1 } } });
  });

  it("[HD-CRON-02] dịch vụ ném lỗi ⇒ 500 JSON có cấu trúc (withCron), không lọt HTML", async () => {
    h.doiSoat.mockRejectedValueOnce(new Error("boom"));
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "boom" });
  });
});
