/**
 * [PUB2-KH-*] Trang Khoá học (public V2): linh vật 3D chạy THẬT ở /khoa-hoc + hộp đăng ký học thử gửi lead THẬT.
 * Chạy: BASE_URL=http://localhost:3000 pnpm exec playwright test -c playwright.pub3d.config.ts tests/e2e/pub/khoa-hoc.spec.ts
 * (dev server đang chạy, DB local nháp — ca gửi lead GHI một lead thử vào DB đó).
 */
import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const { PNG } = createRequire(`${process.cwd()}/`)("pngjs") as {
  PNG: { sync: { read: (b: Buffer) => { width: number; height: number; data: Uint8Array } } };
};

function soDiemKhac(a: Buffer, b: Buffer): { khac: number; tong: number } {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  expect(A.width).toBe(B.width);
  expect(A.height).toBe(B.height);
  let khac = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    if (Math.abs(A.data[i]! - B.data[i]!) > 24 || Math.abs(A.data[i + 1]! - B.data[i + 1]!) > 24 || Math.abs(A.data[i + 2]! - B.data[i + 2]!) > 24) khac++;
  }
  return { khac, tong: A.width * A.height };
}

test.describe("[PUB2-KH] trang khoá học", () => {
  test("[PUB2-KH-01] /khoa-hoc: linh vật 3D vẽ thật (canvas WebGL, poster gỡ, khung hình đổi)", async ({ page }) => {
    const loi: string[] = [];
    page.on("pageerror", (e) => loi.push(String(e)));
    await page.goto("/khoa-hoc", { waitUntil: "load" });
    const m3w = page.locator(".m3w");
    await expect(m3w).toHaveCount(1);
    await m3w.scrollIntoViewIfNeeded();
    await expect(m3w).toHaveAttribute("data-linh3d", "3d", { timeout: 120_000 });

    const canvas = m3w.locator("canvas");
    const gl = await canvas.evaluate((el) => {
      const cv = el as HTMLCanvasElement;
      const g = (cv.getContext("webgl2") || cv.getContext("webgl")) as WebGLRenderingContext | null;
      return { co: !!g, w: cv.width, h: cv.height };
    });
    expect(gl.co, "canvas phải giữ ngữ cảnh WebGL").toBe(true);
    expect(gl.w * gl.h).toBeGreaterThan(10_000);
    await expect(m3w.locator("img")).toHaveCount(0);

    await page.waitForTimeout(1500);
    const box = (await canvas.boundingBox())!;
    const clip = { x: box.x, y: box.y, width: Math.min(box.width, 800), height: Math.min(box.height, 600) };
    const co1 = await page.screenshot({ clip });
    await page.waitForTimeout(900);
    const co2 = await page.screenshot({ clip });
    await canvas.evaluate((el) => ((el as HTMLElement).style.visibility = "hidden"));
    await page.waitForTimeout(200);
    const an = await page.screenshot({ clip });
    await canvas.evaluate((el) => ((el as HTMLElement).style.visibility = ""));
    const vsAn = soDiemKhac(co1, an);
    expect(vsAn.khac / vsAn.tong, "canvas không được trống").toBeGreaterThan(0.02);
    expect(soDiemKhac(co1, co2).khac, "khung hình phải đổi theo thời gian").toBeGreaterThan(50);
    expect(loi, `lỗi trang: ${loi.join(" | ")}`).toEqual([]);
  });

  test("[PUB2-KH-02] /khoa-hoc: giảm chuyển động ⇒ chỉ poster", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/khoa-hoc", { waitUntil: "load" });
    await page.waitForTimeout(4000);
    await expect(page.locator(".m3w")).toHaveAttribute("data-linh3d", "poster");
    await expect(page.locator(".m3w img")).toHaveCount(1);
    await ctx.close();
  });

  test("[PUB2-KH-03] hộp đăng ký học thử gửi lead thật tới /api/leads (có ô «Họ và tên ba/mẹ»)", async ({ page }) => {
    await page.goto("/khoa-hoc/sata3", { waitUntil: "load" });
    await page.addStyleTag({ content: '[data-testid="cookie-consent"]{display:none!important}' });
    await page.getByRole("link", { name: "Đặt buổi học thử 1-1" }).first().click();
    const hop = page.getByRole("dialog");
    await expect(hop).toBeVisible();
    await hop.getByLabel(/Họ và tên con/).fill("Bé Thử Nghiệm");
    await hop.getByLabel(/Họ và tên ba\/mẹ/).fill("Phụ huynh thử e2e");
    await hop.getByLabel(/ĐT di động phụ huynh/).fill("0912345678");
    await hop.getByLabel(/Tôi đã đọc và đồng ý/).check();
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/leads") && r.request().method() === "POST", { timeout: 60_000 }),
      hop.getByRole("button", { name: /ĐẶT BUỔI HỌC THỬ/ }).click(),
    ]);
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    expect(res.status(), JSON.stringify(body)).toBeLessThan(300);
    expect(body.ok).toBe(true);
    const gui = JSON.parse(res.request().postData() ?? "{}") as Record<string, unknown>;
    expect(gui.parentName).toBe("Phụ huynh thử e2e");
    expect(gui.childName).toBe("Bé Thử Nghiệm");
    expect(gui.source).toBe("sata3");
    expect(gui.dongYChinhSachBaoMat).toBe(true);
    await expect(hop.getByText("Cảm ơn ba mẹ!")).toBeVisible();
  });
});
