// @vitest-environment node
/**
 * Ca [POS2-CRON-03] — route cron `pos-quet-sach`: cổng CRON_SECRET như mọi cron khác (`withCron`), rồi
 * chạy MỘT lượt quét sạch cuối ngày với đồng hồ THẬT dạng hàm (`dongHo`) — không một mốc cố định cho cả lô.
 * Luật quét sạch canh ở `tests/finance/pos-gd2.test.ts` ([POS2-QS-*]).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  chay: vi.fn(async (_i: { dongHo: () => Date }) => ({ daKiem: 3, ghiNhan: [], conMoHomNay: 2, loi: 0, boQuaHetGio: 0, daBao: 0 })),
}));
vi.mock("@/lib/payments/pos/quet-sach", () => ({ quetSachPhieuPos: h.chay }));

import { NextRequest } from "next/server";
import * as route from "./route";

const BI_MAT = "bi-mat-cron-test-pos2";
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
  route.GET(new NextRequest("http://localhost/api/cron/pos-quet-sach", { headers: authorization ? { authorization } : {} }));

describe("[POS2-CRON-03] pos-quet-sach — cổng CRON_SECRET", () => {
  it("thiếu / sai bearer ⇒ 401, KHÔNG quét", async () => {
    expect((await goi()).status).toBe(401);
    expect((await goi("Bearer sai")).status).toBe(401);
    expect(h.chay).not.toHaveBeenCalled();
  });

  it("đối chứng: đúng bearer ⇒ 200, chạy ĐÚNG MỘT lượt; đồng hồ là HÀM trả Date mới mỗi lần gọi", async () => {
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(res.status).toBe(200);
    expect(h.chay).toHaveBeenCalledTimes(1);
    const dongHo = h.chay.mock.calls[0]![0].dongHo;
    expect(typeof dongHo).toBe("function");
    expect(dongHo()).toBeInstanceOf(Date);
    expect(await res.json()).toMatchObject({ ok: true, data: { daKiem: 3, conMoHomNay: 2 } });
  });
});
