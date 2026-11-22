import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mọi dữ liệu là GIẢ.
const m = vi.hoisted(() => ({ timTheoHashToken: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/disc/store-prisma", () => ({ taiStore: { timTheoHashToken: m.timTheoHashToken } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));

import { bam } from "@/lib/disc/luu";
import * as route from "./route";
const { POST } = route;

const TOKEN = "token-gia-0123456789abcdef";
const diem = { D: 40, I: 30, S: 20, C: 10 };
const ban = (o: Record<string, unknown> = {}) => ({
  downloadTokenHash: bam(TOKEN),
  downloadTokenExpires: new Date(Date.now() + 10 * 60_000), // route dùng giờ thật; hạn đặt xa để không phụ thuộc đồng hồ
  claimStatus: "PENDING_CLAIM",
  deletedAt: null,
  createdAt: new Date("2026-11-01T02:40:00Z"),
  engineVersion: "engine-GIA-1",
  subjects: [
    { role: "PARENT", fullName: "Mai Giả", birthYear: 1988, grade: null, observedByAdult: false, result: { diem, maBoDe: "PH-GIA", phienBanBoDe: "g1" } },
    { role: "STUDENT", fullName: "Minh Giả", birthYear: 2016, grade: "4", observedByAdult: false, result: { diem, maBoDe: "HS-GIA", phienBanBoDe: "g1" } },
  ],
  ...o,
});
const post = (body: unknown, url = "http://localhost/api/disc/tai") => new Request(url, { method: "POST", body: JSON.stringify(body) });
const get = (b: Record<string, unknown>) => post(b);

const env0 = { ...process.env };
beforeEach(() => {
  process.env.DISC_ENABLED = "true";
  m.timTheoHashToken.mockReset();
  m.rateLimit.mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
  m.timTheoHashToken.mockResolvedValue(ban());
});
afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...env0 };
});

describe("[DISC-API-TAI-01] tải báo cáo bằng token (chỉ POST, token ở thân)", () => {
  it("cờ tắt ⇒ 404 trước mọi việc", async () => {
    delete process.env.DISC_ENABLED;
    expect((await POST(get({ token: TOKEN }))).status).toBe(404);
    expect(m.timTheoHashToken).not.toHaveBeenCalled();
    expect(m.rateLimit).not.toHaveBeenCalled();
  });
  it("[F-11] route KHÔNG còn export GET (token không được đi trong URL)", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
    expect(typeof route.POST).toBe("function");
  });
  it("[F-11] `?token=` trên URL bị BỎ QUA: POST thân rỗng + token ở query ⇒ 404, store không bị tra", async () => {
    const r = await POST(post({}, `http://localhost/api/disc/tai?token=${TOKEN}`));
    expect(r.status).toBe(404);
    expect(m.timTheoHashToken).not.toHaveBeenCalled();
  });
  it("token đúng ⇒ 200 JSON, tiêu đề an toàn, tra bằng HASH", async () => {
    const r = await POST(get({ token: TOKEN }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-robots-tag")).toMatch(/noindex/);
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await r.json()).baoCao.nguoi).toHaveLength(2);
    expect(m.timTheoHashToken).toHaveBeenCalledWith(bam(TOKEN));
  });
  it("dinhDang=html ⇒ text/html + CSP chặn script/tài nguyên ngoài", async () => {
    const r = await POST(get({ token: TOKEN, dinhDang: "html" }));
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await r.text()).toContain("Kết quả DISC");
  });
  it("mọi lỗi token (thiếu/sai/hết hạn/đã xoá/đã nhận) ⇒ CÙNG 404 và cùng thân", async () => {
    const thanh: string[] = [];
    for (const [b, kq] of [
      [{}, ban()],
      [{ token: "abc" }, ban()],
      [{ token: TOKEN }, null],
      [{ token: TOKEN }, ban({ downloadTokenExpires: new Date(Date.now() - 1000) })],
      [{ token: TOKEN }, ban({ deletedAt: new Date() })],
      [{ token: TOKEN }, ban({ claimStatus: "CLAIMED" })],
    ] as Array<[Record<string, unknown>, unknown]>) {
      m.timTheoHashToken.mockResolvedValue(kq);
      const r = await POST(get(b));
      expect(r.status).toBe(404);
      thanh.push(JSON.stringify(await r.json()));
    }
    expect(new Set(thanh).size).toBe(1);
  });
  it("vượt giới hạn IP ⇒ 429, không tra store", async () => {
    m.rateLimit.mockResolvedValueOnce({ success: false, remaining: 0, resetAt: 0 });
    expect((await POST(get({ token: TOKEN }))).status).toBe(429);
    expect(m.timTheoHashToken).not.toHaveBeenCalled();
  });
  it("POST body hỏng hoặc quá lớn ⇒ không crash, token coi như thiếu ⇒ 404 / 413", async () => {
    expect((await POST(new Request("http://localhost/api/disc/tai", { method: "POST", body: "{hong" }))).status).toBe(404);
    expect((await POST(new Request("http://localhost/api/disc/tai", { method: "POST", body: "{}", headers: { "content-length": "999999" } }))).status).toBe(413);
  });
  it("store ném ⇒ 503 chung, không lộ lỗi gốc", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.timTheoHashToken.mockRejectedValueOnce(new Error("secret-db-detail"));
    const r = await POST(get({ token: TOKEN }));
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toMatch(/secret-db-detail/);
    spy.mockRestore();
  });
});
