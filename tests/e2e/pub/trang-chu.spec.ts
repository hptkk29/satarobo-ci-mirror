/**
 * [PUB-HOME-E2E-*] Trang chủ `/`: hero 3D CHẠY THẬT (spacelab.js), poster gỡ/mờ, tiêu đề hero đứng trước khối 3D
 * trên điện thoại, mọi `.sv` hiện đủ sau khi cuộn hết, không tràn ngang.
 * Chạy: BASE_URL=http://localhost:3000 pnpm exec playwright test -c playwright.pub3d.config.ts tests/e2e/pub/trang-chu.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";

async function cuonHet(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  // Hàng vuốt ngang (.swipe ở điện thoại): thẻ ngoài khung chỉ hiện khi vuốt tới — vuốt hết rồi về đầu.
  await page.evaluate(async () => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(".swipe"))) {
      el.scrollIntoView({ block: "center" });
      for (let x = 0; x <= el.scrollWidth; x += 200) {
        el.scrollLeft = x;
        await new Promise((r) => setTimeout(r, 120));
      }
      el.scrollLeft = 0;
    }
  });
  await page.waitForTimeout(1200);
}

test.describe("[PUB-HOME-E2E] trang chủ", () => {
  test("[PUB-HOME-E2E-01] hero: canvas WebGL vẽ thật, poster mờ đi (gone), có hình robot", async ({ page }) => {
    const loi: string[] = [];
    page.on("pageerror", (e) => loi.push(String(e)));
    await page.goto("/", { waitUntil: "load" });
    const canvas = page.locator("canvas.space-cv");
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveAttribute("data-linh3d", "3d", { timeout: 120_000 });
    const gl = await canvas.evaluate((el) => {
      const cv = el as HTMLCanvasElement;
      const g = (cv.getContext("webgl2") || cv.getContext("webgl")) as WebGLRenderingContext | null;
      return { co: !!g, tong: cv.width * cv.height };
    });
    expect(gl.co, "canvas phải giữ ngữ cảnh WebGL").toBe(true);
    expect(gl.tong).toBeGreaterThan(10_000);
    await expect(page.locator(".space-poster")).toHaveClass(/gone/);
    // Có hình thật: ảnh vùng hero khi hiện canvas KHÁC khi ẩn canvas.
    const box = (await page.locator(".hero-mid").boundingBox())!;
    const clip = { x: box.x, y: box.y, width: Math.min(box.width, 700), height: Math.min(box.height, 600) };
    const co = await page.screenshot({ clip });
    await canvas.evaluate((el) => ((el as HTMLElement).style.visibility = "hidden"));
    await page.waitForTimeout(250);
    const an = await page.screenshot({ clip });
    await canvas.evaluate((el) => ((el as HTMLElement).style.visibility = ""));
    expect(Buffer.compare(co, an), "canvas không được trống").not.toBe(0);
    expect(loi, "không có lỗi JS trang").toEqual([]);
  });

  test("[PUB-HOME-E2E-02] điện thoại 390px: tiêu đề hero đứng TRƯỚC khối 3D, không tràn ngang", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "load" });
    const h1 = (await page.locator("h1.hero-h").boundingBox())!;
    const mid = (await page.locator(".hero-mid").boundingBox())!;
    expect(h1.y, "h1 phải nằm trên khối 3D").toBeLessThan(mid.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await ctx.close();
  });

  test("[PUB-HOME-E2E-03] cuộn hết: không `.sv` nào kẹt trong suốt, không tràn ngang (1440 và 390)", async ({ browser }) => {
    for (const w of [1440, 390]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: w > 800 ? 900 : 844 } });
      const page = await ctx.newPage();
      await page.goto("/", { waitUntil: "load" });
      await cuonHet(page);
      const ket = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".sv")).filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.98).map((e) => e.className),
      );
      expect(ket, `.sv kẹt ở ${w}px`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await ctx.close();
    }
  });
});
