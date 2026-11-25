import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dữ liệu GIẢ. S-11 (đọc luồng) và S-04 (IPv6 /64) cho /api/disc/xoa.
const m = vi.hoisted(() => ({ rateLimit: vi.fn(), verifyAndConsumeOtp: vi.fn(), thuBangMa: vi.fn(), denNguong: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { discSubmission: { count: vi.fn() } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));
vi.mock("@/lib/otp/service", () => ({ verifyAndConsumeOtp: m.verifyAndConsumeOtp }));
vi.mock("@/lib/disc/store-prisma", () => ({ maNhanStore: { thuBangMa: m.thuBangMa } }));
vi.mock("@/lib/security/dong-deu-thoi-gian", () => ({ phuThuocThoiGianThat: () => ({ now: () => new Date("2026-11-01T03:00:00Z") }), denNguongThoiGian: m.denNguong }));

import { POST } from "./route";

const env0 = { ...process.env };
beforeEach(() => {
  process.env.DISC_ENABLED = "true";
  process.env.NEXTAUTH_SECRET = "n".repeat(40);
  m.rateLimit.mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
  m.denNguong.mockResolvedValue(false);
});
afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...env0 };
});

describe("[DISC-API-XOA-S11] đọc body theo luồng", () => {
  it("body chunked không Content-Length vượt trần ⇒ 413, luồng bị huỷ, OTP không bị tiêu", async () => {
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
    const r = await POST(new Request("http://localhost/api/disc/xoa", { method: "POST", body: stream, duplex: "half" } as RequestInit));
    expect(r.status).toBe(413);
    expect(daHuy).toBe(true);
    expect(i).toBeLessThan(50);
    expect(m.verifyAndConsumeOtp).not.toHaveBeenCalled();
  });
});

describe("[DISC-API-XOA-S04] khoá IP gộp IPv6 về /64", () => {
  it("hai IPv6 cùng /64 ⇒ cùng khoá IP", async () => {
    const goi = (ip: string) => POST(new Request("http://localhost/api/disc/xoa", { method: "POST", body: "{", headers: { "x-forwarded-for": ip } }));
    await goi("2001:db8:7:7:1::1");
    await goi("2001:db8:7:7:2::2");
    const k = m.rateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(k[0]).toBe(k[1]);
    expect(k[0]).toContain("v6/64:2001:db8:7:7");
  });
});
