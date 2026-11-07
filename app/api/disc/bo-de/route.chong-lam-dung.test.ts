import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dữ liệu GIẢ. S-11 (đọc luồng) và S-04 (IPv6 /64) cho /api/disc/bo-de.
const m = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/disc/engine-dang-ky", () => ({ ensureDiscEngine: () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));

import { POST } from "./route";

const env0 = { ...process.env };
beforeEach(() => {
  process.env.DISC_ENABLED = "true";
  m.rateLimit.mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
});
afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...env0 };
});

describe("[DISC-API-BODE-S11/S04]", () => {
  it("body chunked không Content-Length vượt trần ⇒ 413, luồng bị huỷ", async () => {
    let i = 0;
    let daHuy = false;
    const chunk = new Uint8Array(1024).fill(0x61);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (i++ < 5000) c.enqueue(chunk);
        else c.close();
      },
      cancel() {
        daHuy = true;
      },
    });
    const r = await POST(new Request("http://localhost/api/disc/bo-de", { method: "POST", body: stream, duplex: "half" } as RequestInit));
    expect(r.status).toBe(413);
    expect(daHuy).toBe(true);
    expect(i).toBeLessThan(50);
  });
  it("hai IPv6 cùng /64 ⇒ cùng khoá IP", async () => {
    const goi = (ip: string) => POST(new Request("http://localhost/api/disc/bo-de", { method: "POST", body: "{", headers: { "x-forwarded-for": ip } }));
    await goi("2001:db8:5:5:1::1");
    await goi("2001:db8:5:5:2::2");
    const k = m.rateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(k[0]).toBe(k[1]);
    expect(k[0]).toContain("v6/64:2001:db8:5:5");
  });
});
