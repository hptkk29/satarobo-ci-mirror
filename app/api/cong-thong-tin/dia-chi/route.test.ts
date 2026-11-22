// @vitest-environment node
/**
 * [CTT-DC-*] GET /api/cong-thong-tin/dia-chi — danh mục công khai cho hộp «để lại thông tin».
 *   [CTT-DC-01] cả hai cờ tắt ⇒ 404 rỗng; MỘT cờ bật ⇒ 200 (không phụ thuộc cờ DISC)
 *   [CTT-DC-02] mặc định Tp Đà Nẵng + đệm công khai; thành phố khác ⇒ phường của NÓ; lạ ⇒ 400 không đệm
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const env0 = { ...process.env };
beforeEach(() => {
  delete process.env.TU_SACH_ENABLED;
  delete process.env.SUC_KHOE_ENABLED;
  delete process.env.DISC_ENABLED;
});
afterEach(() => {
  process.env = { ...env0 };
});
const goi = (q = "") => GET(new Request(`http://localhost/api/cong-thong-tin/dia-chi${q}`));

describe("[CTT-DC-01] cờ", () => {
  it("cả hai tắt (kể cả DISC bật) ⇒ 404 không thân", async () => {
    process.env.DISC_ENABLED = "true";
    const r = await goi();
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
  });
  it.each([["TU_SACH_ENABLED"], ["SUC_KHOE_ENABLED"]])("%s bật ⇒ 200", async (co) => {
    process.env[co] = "true";
    expect((await goi()).status).toBe(200);
  });
});

describe("[CTT-DC-02] nội dung", () => {
  beforeEach(() => {
    process.env.TU_SACH_ENABLED = "true";
  });
  it("mặc định Tp Đà Nẵng, có Phường Hải Châu, đệm công khai", async () => {
    const r = await goi();
    const b = await r.json();
    expect(b).toMatchObject({ ok: true, macDinh: "Tp Đà Nẵng" });
    expect(b.phuong).toContain("Phường Hải Châu");
    expect(b.thanhPho.length).toBeGreaterThanOrEqual(30);
    expect(r.headers.get("cache-control")).toMatch(/public/);
  });
  it("Huế ⇒ phường của Huế, KHÔNG lẫn phường Đà Nẵng", async () => {
    const b = await (await goi("?thanhPho=" + encodeURIComponent("Huế"))).json();
    expect(b.ok).toBe(true);
    expect(b.phuong).not.toContain("Phường Hải Châu");
  });
  it("lạ ⇒ 400 + no-store", async () => {
    const r = await goi("?thanhPho=" + encodeURIComponent("Tp Không Có"));
    expect(r.status).toBe(400);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
