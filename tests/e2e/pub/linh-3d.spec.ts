/**
 * [PUB2-3D-*] Cảnh 3D linh vật CHẠY THẬT (không phải poster tĩnh): hero `spacelab.js` + trang con `viewer2.js`.
 * Chạy: BASE_URL=http://localhost:3000 pnpm exec playwright test -c playwright.pub3d.config.ts
 *
 * Bằng chứng "vẽ thật": (1) có <canvas> với ngữ cảnh WebGL, (2) data-linh3d chuyển "cho" → "3d" (onLoad của cảnh đã gọi ⇒ khung đầu vẽ xong),
 * (3) poster đã GỠ/ẩn, (4) ảnh chụp của vùng canvas KHÁC ảnh chụp khi ẩn canvas (có hình robot) và khung hình THAY ĐỔI theo thời gian
 * (lơ lửng/xoay), (5) chế độ giảm chuyển động ⇒ chỉ poster, không có canvas WebGL được tạo.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createRequire } from "node:module";

// pngjs không có kiểu đi kèm trong repo ⇒ nạp qua require và khai kiểu tối thiểu tại chỗ.
const { PNG } = createRequire(`${process.cwd()}/`)("pngjs") as {
  PNG: { sync: { read: (b: Buffer) => { width: number; height: number; data: Uint8Array } } };
};

const TRANG = "/test-ui/pub-3d";

/** Số điểm ảnh khác nhau giữa hai ảnh PNG cùng kích thước (so thô, ngưỡng 24/255 mỗi kênh). */
function soDiemKhac(a: Buffer, b: Buffer): { khac: number; tong: number } {
  const A = PNG.sync.read(a);
  const B = PNG.sync.read(b);
  expect(A.width, "hai ảnh phải cùng kích thước").toBe(B.width);
  expect(A.height).toBe(B.height);
  let khac = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    if (Math.abs(A.data[i]! - B.data[i]!) > 24 || Math.abs(A.data[i + 1]! - B.data[i + 1]!) > 24 || Math.abs(A.data[i + 2]! - B.data[i + 2]!) > 24) khac++;
  }
  return { khac, tong: A.width * A.height };
}

async function cho3D(page: Page, canvas: Locator) {
  await expect(canvas).toHaveAttribute("data-linh3d", "3d", { timeout: 120_000 });
}

test.describe("[PUB2-3D] cảnh 3D chạy thật", () => {
  test("[PUB2-3D-01] hero (spacelab) + trang con (viewer2): canvas WebGL vẽ thật, poster không ở lại", async ({ page }) => {
    const loi: string[] = [];
    page.on("pageerror", (e) => loi.push(String(e)));
    await page.goto(TRANG, { waitUntil: "load" });

    const hero = page.locator("canvas.space-cv");
    const con = page.locator(".m3w canvas");
    await expect(hero).toHaveCount(1);
    await expect(con).toHaveCount(1);
    await cho3D(page, hero);
    await con.scrollIntoViewIfNeeded();
    await cho3D(page, page.locator(".m3w"));

    // (1) ngữ cảnh WebGL thật
    for (const c of [hero, con]) {
      const gl = await c.evaluate((el) => {
        const cv = el as HTMLCanvasElement;
        const g = (cv.getContext("webgl2") || cv.getContext("webgl")) as WebGLRenderingContext | null;
        return { co: !!g, w: cv.width, h: cv.height };
      });
      expect(gl.co, "canvas phải giữ ngữ cảnh WebGL").toBe(true);
      expect(gl.w * gl.h).toBeGreaterThan(10_000);
    }

    // (3) poster đã gỡ (trang con) / mờ đi (hero)
    await expect(page.locator(".m3w img")).toHaveCount(0); // gỡ sau cross-fade .7s (toHaveCount tự chờ)
    await expect(page.locator(".space-poster")).toHaveClass(/gone/);

    // (4) hình thật: ảnh vùng canvas khác ảnh khi ẩn canvas; và khung hình đổi theo thời gian
    for (const c of [hero, con]) {
      await c.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
      const box = (await c.boundingBox())!;
      const clip = { x: box.x, y: box.y, width: Math.min(box.width, 800), height: Math.min(box.height, 600) };
      const co1 = await page.screenshot({ clip });
      await page.waitForTimeout(900);
      const co2 = await page.screenshot({ clip });
      await c.evaluate((el) => ((el as HTMLElement).style.visibility = "hidden"));
      await page.waitForTimeout(200);
      const an = await page.screenshot({ clip });
      await c.evaluate((el) => ((el as HTMLElement).style.visibility = ""));
      const vsAn = soDiemKhac(co1, an);
      expect(vsAn.khac / vsAn.tong, "canvas không được trống: phải có hình robot khác nền").toBeGreaterThan(0.02);
      const doi = soDiemKhac(co1, co2);
      expect(doi.khac, "khung hình phải đổi theo thời gian (lơ lửng/xoay)").toBeGreaterThan(50);
    }
    expect(loi, `lỗi trang: ${loi.join(" | ")}`).toEqual([]);
  });

  test("[PUB2-3D-02] giảm chuyển động ⇒ chỉ poster, không tạo cảnh 3D", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(TRANG, { waitUntil: "load" });
    await page.waitForTimeout(4000);
    await expect(page.locator("canvas.space-cv")).toHaveAttribute("data-linh3d", "poster");
    await expect(page.locator(".m3w")).toHaveAttribute("data-linh3d", "poster");
    await expect(page.locator(".m3w img")).toHaveCount(1);
    await ctx.close();
  });

  test("[PUB2-3D-03] chủ đề: theme khởi tạo lấy từ .page; đổi chủ đề ⇒ setTheme (cảnh đổi bộ vật liệu)", async ({ browser }) => {
    const anh: Record<string, Buffer> = {};
    for (const luu of ["dark", "light"] as const) {
      const ctx = await browser.newContext({ colorScheme: luu === "dark" ? "light" : "dark", viewport: { width: 1440, height: 900 } }); // lưu thắng hệ điều hành
      const page = await ctx.newPage();
      await page.addInitScript((t) => localStorage.setItem("sata-theme", t), luu);
      await page.goto(TRANG, { waitUntil: "load" });
      const cv = page.locator("canvas.space-cv");
      await expect(cv).toHaveAttribute("data-linh3d", "3d", { timeout: 120_000 });
      await expect(cv, "theme truyền cho sataSpaceLab phải là chủ đề của .page").toHaveAttribute("data-theme3d", luu);
      await page.waitForTimeout(1500);
      const hero = (await page.locator(".hero-mid").boundingBox())!;
      anh[luu] = await page.screenshot({ clip: { x: hero.x, y: hero.y, width: hero.width, height: 600 } });
      const doi = luu === "dark" ? "light" : "dark";
      await page.evaluate((t) => {
        const r = document.querySelector(".sr-pub")!;
        r.classList.remove("theme-light", "theme-dark");
        r.classList.add("theme-" + t);
      }, doi);
      await expect(cv, "đổi chủ đề phải gọi setTheme").toHaveAttribute("data-theme3d", doi);
      await ctx.close();
    }
    const d = soDiemKhac(anh.dark!, anh.light!);
    expect(d.khac / d.tong, "bản sáng và bản tối của cảnh phải khác hẳn nhau").toBeGreaterThan(0.1);
  });

  test("[PUB2-3D-04] cross-fade: canvas hiện dần cùng lúc poster mờ đi, không lóe trống; tải sớm (preload mô hình)", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __mau: Array<{ t: number; c: number; p: number }> };
      w.__mau = [];
      const t0 = performance.now();
      const lap = () => {
        const cv = document.querySelector("canvas.space-cv");
        const po = document.querySelector(".space-poster");
        if (cv && po) w.__mau.push({ t: performance.now() - t0, c: +getComputedStyle(cv).opacity, p: +getComputedStyle(po).opacity });
        requestAnimationFrame(lap);
      };
      requestAnimationFrame(lap);
    });
    await page.goto(TRANG, { waitUntil: "load" });
    await expect(page.locator("canvas.space-cv")).toHaveAttribute("data-linh3d", "3d", { timeout: 120_000 });
    await page.waitForTimeout(1500);
    const mau = await page.evaluate(() => (window as unknown as { __mau: Array<{ t: number; c: number; p: number }> }).__mau);
    expect(mau.length).toBeGreaterThan(30);
    // Trước khi canvas hiện: poster rõ nét (không có khung nào poster mờ mà canvas chưa lên).
    const chuyen = mau.filter((m) => m.c > 0.02 && m.c < 0.98);
    expect(chuyen.length, "phải có các khung chuyển (cross-fade thật, không nhảy tức thì)").toBeGreaterThan(3);
    for (const m of mau) expect(m.c + m.p, "tổng độ đục canvas+poster không được tụt (lóe trống) tại t=" + Math.round(m.t)).toBeGreaterThan(0.85);
    const cuoi = mau[mau.length - 1]!;
    expect(cuoi.c).toBeGreaterThan(0.98);
    expect(cuoi.p).toBeLessThan(0.02);
    // Tải sớm: có <link rel=preload as=fetch> tới mô hình.
    const link = await page.evaluate(() => [...document.querySelectorAll('link[rel="preload"][as="fetch"]')].map((l) => l.getAttribute("href")));
    expect(link).toContain("/pub/models/gift.glb");
  });

  test("[PUB2-3D-05] ba khung 0,3s · 1,2s · khi ready: hero không bao giờ trống", async ({ page }) => {
    await page.goto(TRANG, { waitUntil: "commit" });
    const hero = page.locator(".hero-mid");
    await hero.waitFor({ state: "attached" });
    await page.waitForTimeout(300);
    const box = (await hero.boundingBox())!;
    const clip = { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 600) };
    const f1 = await page.screenshot({ clip });
    await page.waitForTimeout(900);
    const f2 = await page.screenshot({ clip });
    await expect(page.locator("canvas.space-cv")).toHaveAttribute("data-linh3d", "3d", { timeout: 120_000 });
    await page.waitForTimeout(900);
    const f3 = await page.screenshot({ clip });
    // "Trống" = giống hệt ảnh khi ẩn cả canvas lẫn poster.
    await page.evaluate(() => {
      (document.querySelector("canvas.space-cv") as HTMLElement).style.visibility = "hidden";
      (document.querySelector(".space-poster") as HTMLElement).style.visibility = "hidden";
    });
    await page.waitForTimeout(200);
    const trong = await page.screenshot({ clip });
    const out = process.env.PUB3D_ANH_DIR;
    if (out) {
      const fs = await import("node:fs");
      for (const [i, f] of [f1, f2, f3].entries()) fs.writeFileSync(`${out}/pub3d-khung-${i + 1}.png`, f);
    }
    for (const [i, f] of [f1, f2, f3].entries()) {
      const d = soDiemKhac(f, trong);
      expect(d.khac / d.tong, "khung " + (i + 1) + " không được trống").toBeGreaterThan(0.01);
    }
  });
});
