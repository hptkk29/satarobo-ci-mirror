/**
 * [DCR-*] GET /api/disc/dia-chi — danh mục địa chỉ công khai cho bước «Lưu» của DISC.
 *   [DCR-01] cờ DISC_ENABLED tắt ⇒ 404 rỗng, không lộ danh mục
 *   [DCR-02] mặc định = Tp Đà Nẵng; trả đủ thành phố + phường của thành phố đó; cho phép đệm công khai
 *   [DCR-03] thành phố khác ⇒ phường của NÓ; thành phố lạ ⇒ 400, không đoán, không đệm
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const env0 = { ...process.env };
beforeEach(() => {
  process.env.DISC_ENABLED = "true";
});
afterEach(() => {
  process.env = { ...env0 };
});
const goi = (q = "") => GET(new Request(`http://localhost/api/disc/dia-chi${q}`));

describe("[DCR-01] cờ tắt", () => {
  it("404 không thân", async () => {
    process.env.DISC_ENABLED = "false";
    const r = await goi();
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
  });
});

describe("[DCR-02] mặc định", () => {
  it("Tp Đà Nẵng, có Phường Hải Châu, có đệm công khai", async () => {
    const r = await goi();
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.ok).toBe(true);
    expect(b.macDinh).toBe("Tp Đà Nẵng");
    expect(b.thanhPho).toContain("Tp Đà Nẵng");
    expect(b.thanhPho.length).toBeGreaterThanOrEqual(30);
    expect(b.phuong).toContain("Phường Hải Châu");
    expect(r.headers.get("cache-control")).toMatch(/public/);
  });
  it("thanhPho rỗng ⇒ như mặc định", async () => {
    expect((await (await goi("?thanhPho=")).json()).phuong).toContain("Phường Hải Châu");
  });
});

describe("[DCR-03] thành phố khác / lạ", () => {
  it("Huế ⇒ phường của Huế, KHÔNG lẫn phường Đà Nẵng", async () => {
    const b = await (await goi("?thanhPho=" + encodeURIComponent("Huế"))).json();
    expect(b.ok).toBe(true);
    expect(b.phuong.length).toBeGreaterThan(0);
    expect(b.phuong).not.toContain("Phường Hải Châu");
  });
  it("lạ ⇒ 400 + no-store", async () => {
    const r = await goi("?thanhPho=" + encodeURIComponent("Tp Không Có"));
    expect(r.status).toBe(400);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ ok: false, loi: "THANH_PHO_KHONG_HOP_LE" });
  });
});
