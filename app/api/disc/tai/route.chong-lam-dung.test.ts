import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dữ liệu GIẢ. S-11 (đọc luồng), S-04 (IPv6 /64). (S-09 PDF lỗi ⇒ HTML đã gỡ cùng tính năng tải PDF, 04/11/2026.)
const m = vi.hoisted(() => ({ timTheoHashToken: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/disc/store-prisma", () => ({ taiStore: { timTheoHashToken: m.timTheoHashToken } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));

import { bam } from "@/lib/disc/luu";
import { POST } from "./route";

const TOKEN = "token-gia-0123456789abcdef";
const diem = { D: 40, I: 30, S: 20, C: 10 };
const ban = () => ({
  downloadTokenHash: bam(TOKEN),
  downloadTokenExpires: new Date(Date.now() + 10 * 60_000),
  claimStatus: "PENDING_CLAIM",
  deletedAt: null,
  createdAt: new Date("2026-11-01T02:40:00Z"),
  engineVersion: "engine-GIA-1",
  subjects: [
    { role: "PARENT", fullName: "Mai Giả", birthYear: 1988, grade: null, observedByAdult: false, result: { diem, maBoDe: "PH-GIA", phienBanBoDe: "g1" } },
    { role: "STUDENT", fullName: "Minh \u202E\u200BGiả\n", birthYear: 2016, grade: "4", observedByAdult: false, result: { diem, maBoDe: "HS-GIA", phienBanBoDe: "g1" } },
  ],
});
const post = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost/api/disc/tai", { method: "POST", body: JSON.stringify(body), headers });

const env0 = { ...process.env };
beforeEach(() => {
  process.env.DISC_ENABLED = "true";
  m.rateLimit.mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
  m.timTheoHashToken.mockResolvedValue(ban());
});
afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...env0 };
});

describe("[DISC-API-TAI-S11/S04]", () => {
  it("body chunked vượt trần ⇒ 413, luồng bị huỷ, không tra store", async () => {
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
    const r = await POST(new Request("http://localhost/api/disc/tai", { method: "POST", body: stream, duplex: "half" } as RequestInit));
    expect(r.status).toBe(413);
    expect(daHuy).toBe(true);
    expect(i).toBeLessThan(50);
    expect(m.timTheoHashToken).not.toHaveBeenCalled();
  });
  it("khoá IP gộp IPv6 về /64", async () => {
    await POST(post({ token: TOKEN }, { "x-forwarded-for": "2001:db8:9:9:1::1" }));
    await POST(post({ token: TOKEN }, { "x-forwarded-for": "2001:db8:9:9:2::2" }));
    const k = m.rateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(k[0]).toBe(k[1]);
    expect(k[0]).toContain("v6/64:2001:db8:9:9");
  });
});

describe("[DISC-API-TAI-NOPDF] đã gỡ tải PDF (04/11/2026)", () => {
  it("dinhDang=pdf KHÔNG còn ra application/pdf — rơi về JSON như giá trị lạ; token sai vẫn 404", async () => {
    const r = await POST(post({ token: TOKEN, dinhDang: "pdf" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).not.toContain("pdf");
    expect(r.headers.get("content-type")).toContain("application/json");
    m.timTheoHashToken.mockResolvedValue(null);
    expect((await POST(post({ token: TOKEN, dinhDang: "pdf" }))).status).toBe(404);
  });
});
