// [HDT] Thân của `POST /parent/online-orders/:orderId/cancel` (vá F9 review L5 PR #1284): thân TUỲ CHỌN nhưng phải đọc CÓ TRẦN — không đọc hết vào RAM rồi mới cắt.
import { beforeEach, describe, expect, it, vi } from "vitest";

const huy = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => ({ daHuyTruocDo: false })));
vi.mock("@/lib/mobile-api/dich-vu/online-mua", () => ({ huyDonOnlineMobile: huy }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
// Cổng đăng nhập không phải thứ đo ở đây (có bộ riêng) — chỉ giữ phần đọc thân là mã thật.
vi.mock("@/lib/mobile-api/cong", async (goc) => {
  const that = await goc<typeof import("@/lib/mobile-api/cong")>();
  return { ...that, chayChoPhuHuynh: (_req: Request, h: (n: { userId: string }) => Promise<Response>) => h({ userId: "ph-1" }) };
});

import { POST } from "@/app/api/mobile/v1/parent/online-orders/[orderId]/cancel/route";
import { THAN_TOI_DA_BYTE } from "@/lib/mobile-api/cong";

const ctx = { params: Promise.resolve({ orderId: "don-1" }) };
const goi = (init: RequestInit) => POST(new Request("http://localhost/x", { method: "POST", ...init }), ctx);
const maLoi = async (r: Response) => ((await r.json()) as { error?: { code: string } }).error?.code;

/** Thân dạng luồng (không `Content-Length`): `soKhuc` khúc, mỗi khúc 64 KB toàn dấu cách. `daKeo` = số khúc máy chủ đã thật sự đọc. */
function luongLon(soKhuc: number) {
  const khuc = new TextEncoder().encode(" ".repeat(64 * 1024));
  const dem = { daKeo: 0, daHuy: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (dem.daKeo >= soKhuc) return c.close();
        dem.daKeo++;
        c.enqueue(khuc);
      },
      cancel() {
        dem.daHuy = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, dem };
}

beforeEach(() => huy.mockClear());

describe("[HDT] thân yêu cầu huỷ đơn Online có trần", () => {
  it("[HDT-01] luồng không Content-Length vượt trần ⇒ 413, DỪNG đọc sớm, KHÔNG huỷ đơn", async () => {
    const { body, dem } = luongLon(64); // 4 MB
    const r = await goi({ body, duplex: "half" } as RequestInit);
    expect(r.status).toBe(413);
    expect(await maLoi(r)).toBe("PAYLOAD_TOO_LARGE");
    expect(huy).not.toHaveBeenCalled();
    // Mã đọc tới khúc đầu tiên VƯỢT trần rồi dừng. Chừa biên vì môi trường chạy (phiên bản Node) có thể kéo trước vài khúc; bản đọc hết rồi cắt kéo đủ 64.
    expect(dem.daKeo).toBeGreaterThan(THAN_TOI_DA_BYTE / (64 * 1024));
    expect(dem.daKeo).toBeLessThan(16);
    expect(dem.daHuy).toBe(true);
  });

  it("[HDT-02] Content-Length khai vượt trần ⇒ 413 ngay, không huỷ", async () => {
    const r = await goi({ body: "{}", headers: { "content-length": String(THAN_TOI_DA_BYTE + 1) } });
    expect(r.status).toBe(413);
    expect(huy).not.toHaveBeenCalled();
  });

  it("[HDT-03] tương thích: không gửi thân · thân trắng · `{}` ⇒ huỷ, không khôi phục giỏ", async () => {
    for (const init of [{}, { body: "   " }, { body: "{}" }]) {
      huy.mockClear();
      expect((await goi(init)).status).toBe(200);
      expect(huy).toHaveBeenCalledWith("ph-1", "don-1", false);
    }
  });

  it("[HDT-04] `khoiPhucVaoGio: true` được đọc đúng", async () => {
    expect((await goi({ body: JSON.stringify({ khoiPhucVaoGio: true }) })).status).toBe(200);
    expect(huy).toHaveBeenCalledWith("ph-1", "don-1", true);
  });

  it("[HDT-05] JSON hỏng hoặc khoá lạ ⇒ 400, không huỷ", async () => {
    for (const body of ["{", JSON.stringify({ khoiPhucVaoGio: true, la: 1 })]) {
      const r = await goi({ body });
      expect(r.status).toBe(400);
      expect(await maLoi(r)).toBe("VALIDATION");
    }
    expect(huy).not.toHaveBeenCalled();
  });
});
