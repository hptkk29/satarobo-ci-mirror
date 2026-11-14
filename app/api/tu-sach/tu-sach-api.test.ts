// @vitest-environment node
/**
 * [TS-API-*] Hai route của Tủ sách (kho R2, thẻ mở khoá, giới hạn tần suất được giả).
 *   [TS-API-01] /tai: cờ tắt ⇒ 404 rỗng; chưa mở khoá ⇒ 401 (không chạm kho); đã mở khoá + có tệp ⇒ 200 link ký, no-store; chưa có tệp ⇒ 404 CHUA_CO_TEP; chạm trần ⇒ 429
 *   [TS-API-02] /trang: cờ tắt / sai số / quá số trang / kho chưa cấu hình ⇒ 404; hợp lệ ⇒ 302 tới ảnh CÔNG KHAI ở R2 (đọc miễn phí, không cần thẻ)
 *   [TS-API-03] trang tải kèm cờ động: file page.tsx của Tủ sách phải `force-dynamic` (bài học /kich-hoat 08/11/2026)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  daMoKhoa: vi.fn(),
  daCauHinh: vi.fn(),
  tonTai: vi.fn(),
  ky: vi.fn(),
  r2DaCauHinh: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));
vi.mock("@/lib/cong-thong-tin/doc-the", () => ({ daMoKhoa: m.daMoKhoa }));
vi.mock("@/lib/tu-sach/kho-r2", () => ({ khoTepR2: { daCauHinh: m.daCauHinh, tonTai: m.tonTai, kyLinkTai: m.ky } }));
vi.mock("@/lib/storage/r2-client", () => ({ r2DaCauHinh: m.r2DaCauHinh, getPublicUrl: (k: string) => `https://cdn.example/${k}` }));

import { GET as TAI } from "./tai/[so]/route";
import { GET as TRANG } from "./trang/[so]/[n]/route";
import { EBOOKS, soTrangDocThu } from "@/lib/tu-sach/ebook";

const env0 = { ...process.env };
const ctxTai = (so: string) => ({ params: Promise.resolve({ so }) });
const ctxTrang = (so: string, n: string) => ({ params: Promise.resolve({ so, n }) });
const req = (u = "http://localhost/x") => new Request(u);

beforeEach(() => {
  process.env.TU_SACH_ENABLED = "true";
  m.rateLimit.mockReset().mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
  m.daMoKhoa.mockReset().mockResolvedValue(true);
  m.daCauHinh.mockReset().mockReturnValue(true);
  m.tonTai.mockReset().mockResolvedValue(true);
  m.ky.mockReset().mockResolvedValue("https://r2.example/sach.pdf?sig=abc");
  m.r2DaCauHinh.mockReset().mockReturnValue(true);
});
afterEach(() => {
  process.env = { ...env0 };
});

describe("[TS-API-01] /api/tu-sach/tai/<so>", () => {
  it("cờ tắt ⇒ 404 rỗng, không chạm gì", async () => {
    delete process.env.TU_SACH_ENABLED;
    const r = await TAI(req(), ctxTai("1"));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
    expect(m.rateLimit).not.toHaveBeenCalled();
  });
  it("chưa mở khoá ⇒ 401, KHÔNG HEAD/ký", async () => {
    m.daMoKhoa.mockResolvedValue(false);
    const r = await TAI(req(), ctxTai("1"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, loi: "CHUA_DE_LAI_THONG_TIN" });
    expect(m.tonTai).not.toHaveBeenCalled();
    expect(m.ky).not.toHaveBeenCalled();
  });
  it("đã mở khoá + có tệp ⇒ 200 link, no-store", async () => {
    const r = await TAI(req(), ctxTai("7"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, url: "https://r2.example/sach.pdf?sig=abc" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(m.tonTai).toHaveBeenCalledWith("tu-sach/ebook/7/sach.pdf");
  });
  it("chưa nhập tệp ⇒ 404 CHUA_CO_TEP; số lạ ⇒ 400/404", async () => {
    m.tonTai.mockResolvedValue(false);
    const r = await TAI(req(), ctxTai("7"));
    expect(r.status).toBe(404);
    expect((await r.json()).loi).toBe("CHUA_CO_TEP");
    expect((await TAI(req(), ctxTai("abc"))).status).toBe(400);
    expect((await TAI(req(), ctxTai("99"))).status).toBe(404);
  });
  it("chạm trần tần suất ⇒ 429, không chạm kho; khoá tần suất KHÔNG chứa IP thô", async () => {
    m.rateLimit.mockResolvedValue({ success: false, remaining: 0, resetAt: 0 });
    const r = await TAI(req(), ctxTai("1"));
    expect(r.status).toBe(429);
    expect(m.tonTai).not.toHaveBeenCalled();
    expect((m.rateLimit.mock.calls[0]![0] as { key: string }).key).toMatch(/^tu-sach-tai:[0-9a-f]{24}$/);
  });
});

describe("[TS-API-02b] đọc thử 1/4: trang ngoài phần đọc thử cần thẻ mở khoá", () => {
  const e = EBOOKS.find((x) => x.so === 2)!;
  const g = soTrangDocThu(e.soTrang);
  it("trang CUỐI của phần đọc thử: chưa mở khoá vẫn 302 (đệm công khai); trang kế tiếp: 401, KHÔNG lộ địa chỉ ảnh", async () => {
    m.daMoKhoa.mockResolvedValue(false);
    const trong = await TRANG(req(), ctxTrang("2", String(g)));
    expect(trong.status).toBe(302);
    expect(trong.headers.get("cache-control")).toMatch(/public/);
    const ngoai = await TRANG(req(), ctxTrang("2", String(g + 1)));
    expect(ngoai.status).toBe(401);
    expect(ngoai.headers.get("location")).toBeNull();
    expect(ngoai.headers.get("cache-control")).toBe("no-store");
  });
  it("đã mở khoá: đọc hết, nhưng đệm RIÊNG (private) cho phần ngoài đọc thử", async () => {
    m.daMoKhoa.mockResolvedValue(true);
    const r = await TRANG(req(), ctxTrang("2", String(e.soTrang)));
    expect(r.status).toBe(302);
    expect(r.headers.get("cache-control")).toMatch(/private/);
    expect(r.headers.get("cache-control")).not.toMatch(/public/);
  });
});

describe("[TS-API-02] /api/tu-sach/trang/<so>/<n>", () => {
  it("hợp lệ ⇒ 302 tới ảnh công khai; KHÔNG cần thẻ mở khoá", async () => {
    m.daMoKhoa.mockResolvedValue(false);
    const r = await TRANG(req(), ctxTrang("2", "5"));
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://cdn.example/tu-sach/ebook/2/p5.webp");
    expect(m.daMoKhoa).not.toHaveBeenCalled();
  });
  it.each([
    ["cờ tắt", () => delete process.env.TU_SACH_ENABLED, "2", "1"],
    ["số sách lạ", () => undefined, "99", "1"],
    ["trang 0", () => undefined, "2", "0"],
    ["quá số trang", () => undefined, "2", "999"],
    ["không phải số", () => undefined, "../2", "1"],
    ["kho chưa cấu hình", () => m.r2DaCauHinh.mockReturnValue(false), "2", "1"],
  ])("%s ⇒ 404", async (_ten, chuanBi, so, n) => {
    chuanBi();
    expect((await TRANG(req(), ctxTrang(so, n))).status).toBe(404);
  });
});

describe("[TS-API-03] trang phải động", () => {
  it("app/(public)/tu-sach/page.tsx export dynamic = force-dynamic", () => {
    const ma = readFileSync(resolve(process.cwd(), "app/(public)/tu-sach/page.tsx"), "utf8");
    expect(ma).toMatch(/export const dynamic = "force-dynamic"/);
    expect(ma).toMatch(/isTuSachEnabled\(\)\) notFound\(\)/);
  });
});
