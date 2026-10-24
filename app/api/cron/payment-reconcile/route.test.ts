// @vitest-environment node
/**
 * Ca [PRC-HD-*] — cron `payment-reconcile` gọi chuông nhắc kế toán hoá đơn (PLAN Q-mở 7) SAU đối soát,
 * với MỐC GIỜ của lượt, và lỗi của chuông không làm hỏng lượt đối soát. Luật cổng cờ / đếm / người nhận
 * canh ở `lib/finance/hoa-don/nhac-ke-toan{,-db}.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  nhac: vi.fn(async (_now: Date) => ({ boQua: null, choXuat: 4, coSo: 1, thongBao: 2, notified: 2 }) as unknown),
  notify: vi.fn(async () => 1),
}));
vi.mock("@/lib/finance/hoa-don/nhac-ke-toan-db", () => ({ nhacKeToanHoaDon: h.nhac }));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));
vi.mock("@/lib/finance/bao-luu-tien", () => ({ locDotCuaConDangBaoLuu: async () => new Set<string>() }));
vi.mock("@/lib/db", () => ({
  db: {
    bankTransaction: { findMany: async () => [] },
    paymentRequest: { findMany: async () => [] },
  },
}));

import { NextRequest } from "next/server";
import * as route from "./route";

const BI_MAT = "bi-mat-cron-test-prc";
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
    new NextRequest("http://localhost/api/cron/payment-reconcile", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("[PRC-HD-01] chuông hoá đơn đi ké lượt đối soát hằng ngày", () => {
  it("sai bearer ⇒ 401, KHÔNG chạy chuông", async () => {
    expect((await goi("Bearer sai")).status).toBe(401);
    expect(h.nhac).not.toHaveBeenCalled();
  });

  it("đúng bearer ⇒ chạy chuông MỘT lần với mốc giờ là Date, kết quả nằm ở data.hoaDon", async () => {
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(res.status).toBe(200);
    expect(h.nhac).toHaveBeenCalledTimes(1);
    expect(h.nhac.mock.calls[0]![0]).toBeInstanceOf(Date);
    expect(await res.json()).toMatchObject({ ok: true, data: { unmatchedTxns: 0, hoaDon: { choXuat: 4 } } });
  });

  it("chuông NÉM ⇒ lượt đối soát vẫn 200, lỗi ghi ở data.hoaDon.loi", async () => {
    h.nhac.mockRejectedValueOnce(new Error("hàng chờ hỏng"));
    const loiGoc = console.error;
    console.error = () => {};
    try {
      const res = await goi(`Bearer ${BI_MAT}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, data: { hoaDon: { loi: "hàng chờ hỏng" } } });
    } finally {
      console.error = loiGoc;
    }
  });
});
