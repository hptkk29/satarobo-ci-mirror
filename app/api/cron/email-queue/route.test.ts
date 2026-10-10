// @vitest-environment node
/**
 * Ca [EQR-*] — cron `email-queue` đọc cờ hoá đơn MỘT lần cho cả nhịp và truyền đúng giá trị cho CẢ
 * HAI việc (đối soát lượt gửi hoá đơn + worker hàng đợi) — GĐ 8, quyết định (3) 27/09.
 *
 *  • Cờ TẮT ⇒ cả hai nhận `false`: thư hoá đơn nằm lại (lượt CHO / dòng PENDING), email thường vẫn đi.
 *  • Đọc cờ HỎNG ⇒ coi như TẮT, route vẫn 200 — không được làm chết hàng đợi chung vì một cờ.
 *  • `maxDuration = 60` — nhịp nay có hai việc nối đuôi; mất dòng khai là về trần mặc định.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  doiSoat: vi.fn(async (_now: Date, _opts: { hoaDonBat: boolean }) => 0),
  process: vi.fn(async (_limit: number, _opts: { guiHoaDon: boolean }) => ({ processed: 0, sent: 0, failed: 0 })),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: vi.fn(async () => false) }));
vi.mock("@/lib/email/queue", () => ({ processEmailQueue: h.process }));
vi.mock("@/lib/finance/hoa-don/gui-email", () => ({ doiSoatGuiHoaDon: h.doiSoat }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: h.bat }));

import { NextRequest } from "next/server";
import * as route from "./route";

const BI_MAT = "bi-mat-cron-test-eqr";
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

const goi = () =>
  route.GET(new NextRequest("http://localhost/api/cron/email-queue", { headers: { authorization: `Bearer ${BI_MAT}` } }));

describe("[EQR-01] cờ hoá đơn đi vào CẢ HAI việc của nhịp", () => {
  it("TẮT ⇒ đối soát + worker cùng nhận false; JSON nói cờ đang tắt", async () => {
    h.bat.mockResolvedValue(false);
    const res = await goi();
    expect(res.status).toBe(200);
    expect(h.doiSoat).toHaveBeenCalledWith(expect.any(Date), { hoaDonBat: false });
    expect(h.process).toHaveBeenCalledWith(25, { guiHoaDon: false });
    expect(await res.json()).toMatchObject({ hoaDonBat: false });
  });

  it("đọc cờ NÉM ⇒ coi như tắt, route vẫn 200 và email thường vẫn chạy", async () => {
    h.bat.mockRejectedValue(new Error("DB chập chờn"));
    const res = await goi();
    expect(res.status).toBe(200);
    expect(h.doiSoat).toHaveBeenCalledWith(expect.any(Date), { hoaDonBat: false });
    expect(h.process).toHaveBeenCalledWith(25, { guiHoaDon: false });
  });

  it("đối chứng: BẬT ⇒ cả hai nhận true; cờ đọc đúng MỘT lần", async () => {
    h.bat.mockResolvedValue(true);
    await goi();
    expect(h.bat).toHaveBeenCalledTimes(1);
    expect(h.doiSoat).toHaveBeenCalledWith(expect.any(Date), { hoaDonBat: true });
    expect(h.process).toHaveBeenCalledWith(25, { guiHoaDon: true });
  });
});

describe("[EQR-02] trần thời gian", () => {
  it("maxDuration = 60", () => {
    expect(route.maxDuration).toBe(60);
  });
});
