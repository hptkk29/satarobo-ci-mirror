// @vitest-environment node
/**
 * [PTS-API-*] Hai route Tủ sách của CỔNG PHỤ HUYNH (phiên, kho R2, lưu phường/xã được giả).
 *   [PTS-API-01] /tai: cờ tắt ⇒ 404 rỗng TRƯỚC khi đụng phiên; chưa đăng nhập / không phải PARENT ⇒ 401; hồ sơ chưa có phường/xã ⇒ 401 CHUA_DE_LAI_THONG_TIN (không chạm kho);
 *                      đủ điều kiện + có tệp ⇒ 200 link ký, no-store; chạm trần ⇒ 429
 *   [PTS-API-02] /phuong: cờ tắt ⇒ 404; chưa đăng nhập ⇒ 401; body hỏng / thiếu ⇒ 400 và KHÔNG gọi lưu; hợp lệ ⇒ 200 và `userId` là của PHIÊN (không từ body)
 *   [PTS-API-03] mã lỗi của lưu: thiếu thông tin tài khoản / phường sai ⇒ 400; lỗi hệ thống ⇒ 503
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  rateLimit: vi.fn(),
  duocTai: vi.fn(),
  luuPhuong: vi.fn(),
  daCauHinh: vi.fn(),
  tonTai: vi.fn(),
  ky: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));
vi.mock("@/lib/portal/tu-sach", () => ({ phuHuynhDuocTai: m.duocTai, luuPhuongPhuHuynh: m.luuPhuong }));
vi.mock("@/lib/tu-sach/kho-r2", () => ({ khoTepR2: { daCauHinh: m.daCauHinh, tonTai: m.tonTai, kyLinkTai: m.ky } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); }, redirect: () => { throw new Error("redirect"); } }));

import { GET as TAI } from "./tai/[so]/route";
import { POST as PHUONG } from "./phuong/route";

const env0 = { ...process.env };
const ctx = (so: string) => ({ params: Promise.resolve({ so }) });
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const PH = { user: { id: "u-ph", role: "PARENT" } };

beforeEach(() => {
  process.env.TU_SACH_ENABLED = "true";
  m.auth.mockReset().mockResolvedValue(PH);
  m.rateLimit.mockReset().mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
  m.duocTai.mockReset().mockResolvedValue(true);
  m.luuPhuong.mockReset().mockResolvedValue({ ok: true });
  m.daCauHinh.mockReset().mockReturnValue(true);
  m.tonTai.mockReset().mockResolvedValue(true);
  m.ky.mockReset().mockResolvedValue("https://r2.example/sach.pdf?sig=abc");
});
afterEach(() => {
  process.env = { ...env0 };
});

describe("[PTS-API-01] /api/portal/tu-sach/tai/<so>", () => {
  it("cờ tắt ⇒ 404 rỗng, không đụng phiên", async () => {
    delete process.env.TU_SACH_ENABLED;
    const r = await TAI(new Request("http://localhost/x"), ctx("1"));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
    expect(m.auth).not.toHaveBeenCalled();
  });
  it("chưa đăng nhập / không phải PARENT ⇒ 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await TAI(new Request("http://localhost/x"), ctx("1"))).status).toBe(401);
    m.auth.mockResolvedValue({ user: { id: "u-nv", role: "SALES_CSM" } });
    expect((await TAI(new Request("http://localhost/x"), ctx("1"))).status).toBe(401);
    expect(m.tonTai).not.toHaveBeenCalled();
  });
  it("hồ sơ chưa có phường/xã ⇒ 401 CHUA_DE_LAI_THONG_TIN, KHÔNG HEAD/ký", async () => {
    m.duocTai.mockResolvedValue(false);
    const r = await TAI(new Request("http://localhost/x"), ctx("1"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, loi: "CHUA_DE_LAI_THONG_TIN" });
    expect(m.tonTai).not.toHaveBeenCalled();
    expect(m.ky).not.toHaveBeenCalled();
  });
  it("đủ điều kiện + có tệp ⇒ 200 link, no-store; hỏi điều kiện theo userId của PHIÊN", async () => {
    const r = await TAI(new Request("http://localhost/x"), ctx("7"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, url: "https://r2.example/sach.pdf?sig=abc" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(m.duocTai).toHaveBeenCalledWith("u-ph");
  });
  it("chạm trần ⇒ 429; chưa nhập tệp ⇒ 404 CHUA_CO_TEP", async () => {
    m.tonTai.mockResolvedValue(false);
    expect((await (await TAI(new Request("http://localhost/x"), ctx("7"))).json()).loi).toBe("CHUA_CO_TEP");
    m.rateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: 0 });
    expect((await TAI(new Request("http://localhost/x"), ctx("7"))).status).toBe(429);
  });
});

describe("[PTS-API-02] /api/portal/tu-sach/phuong", () => {
  it("cờ tắt ⇒ 404; chưa đăng nhập ⇒ 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await PHUONG(post({ phuong: "Phường Hải Châu" }))).status).toBe(401);
    delete process.env.TU_SACH_ENABLED;
    expect((await PHUONG(post({ phuong: "Phường Hải Châu" }))).status).toBe(404);
    expect(m.luuPhuong).not.toHaveBeenCalled();
  });
  it("body hỏng / thiếu ô ⇒ 400 và KHÔNG gọi lưu", async () => {
    expect((await PHUONG(post("{không phải json"))).status).toBe(400);
    expect((await PHUONG(post({}))).status).toBe(400);
    expect((await PHUONG(post({ phuong: "" }))).status).toBe(400);
    expect(m.luuPhuong).not.toHaveBeenCalled();
  });
  it("hợp lệ ⇒ 200; userId là của PHIÊN, body có gắn thêm userId cũng bị bỏ qua", async () => {
    const r = await PHUONG(post({ phuong: "Phường Hải Châu", userId: "nguoi-khac" }));
    expect(r.status).toBe(200);
    expect(m.luuPhuong).toHaveBeenCalledWith("u-ph", "Phường Hải Châu");
  });
});

describe("[PTS-API-03] mã lỗi của lưu phường/xã", () => {
  it("thiếu thông tin tài khoản ⇒ 400; phường sai ⇒ 400; lỗi hệ thống ⇒ 503", async () => {
    m.luuPhuong.mockResolvedValue({ ok: false, ma: "THIEU_THONG_TIN_TAI_KHOAN" });
    const a = await PHUONG(post({ phuong: "Phường Hải Châu" }));
    expect(a.status).toBe(400);
    expect((await a.json()).loi).toBe("THIEU_THONG_TIN_TAI_KHOAN");
    m.luuPhuong.mockResolvedValue({ ok: false, ma: "PHUONG_KHONG_HOP_LE" });
    expect((await PHUONG(post({ phuong: "Nơi nào đó" }))).status).toBe(400);
    m.luuPhuong.mockResolvedValue({ ok: false, ma: "LOI_HE_THONG" });
    expect((await PHUONG(post({ phuong: "Phường Hải Châu" }))).status).toBe(503);
  });
});
