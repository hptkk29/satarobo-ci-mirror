/**
 * [NGD-*] Nền giao diện khu e-learning (P0) — HÀNH VI THẬT trong trình duyệt.
 *
 * Chạy ở ba project: `elearning` (không dùng — spec này loại khỏi nó), `elearning-mobile` (375×800) và `elearning-dark`
 * (`colorScheme: "dark"` ⇒ kiểm chế độ "Hệ thống"). Ba điều jsdom không đo được:
 *   1. Tràn ngang (`scrollWidth > clientWidth`) ở 375 / 768 / 1280 trên các màn nhân viên.
 *   2. Token kem/tím thật sự ĂN (không bị `.admin-scope` đè) và `.dark` chỉ nằm trên `.elearning-root`, KHÔNG lên <html>/<body>.
 *   3. Hộp nổi qua portal (menu tài khoản, menu Sáng/Tối) mang token tối — popup sáng giữa nền tối là lỗi thật.
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG: "không tràn ngang" luôn đạt nếu trang trắng.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

let d: BoDuLieu;
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await login(p, { email: d.hocVienEmail, callbackUrl: "/elearning" });
  await expect(p).toHaveURL(/\/elearning/);
  cookies = await ctx.cookies();
  await ctx.close();
});

async function vao(page: Page, duongDan: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookies);
  await page.goto(duongDan);
  await expect(page.locator("[data-elearning-theme]")).toBeVisible();
}

/** Màu nền tính toán của một phần tử, dạng "rgb(r, g, b)". */
const nen = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);

const MAN_NHAN_VIEN = ["/elearning", "/elearning/khoa-cua-toi", "/elearning/thong-bao", "/elearning/du-lieu-cua-toi"];
const DO_RONG = [375, 768, 1280];

test.describe("[NGD-1] không tràn ngang ở 375 / 768 / 1280", () => {
  for (const duongDan of MAN_NHAN_VIEN) {
    for (const w of DO_RONG) {
      test(`${duongDan} @${w}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 800 });
        await vao(page, duongDan);
        // ĐỐI CHỨNG DƯƠNG: trang có nội dung thật (không phải trang lỗi/trắng) — "không tràn" trên trang trắng là vô nghĩa.
        await expect(page.locator("main, #noi-dung").first()).toContainText(/\S/);
        const r = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
        }));
        expect(r.sw, `${duongDan} @${w}: scrollWidth ${r.sw} > clientWidth ${r.cw}`).toBeLessThanOrEqual(r.cw);
      });
    }
  }
});

test.describe("[NGD-2] token và phạm vi tối", () => {
  test("token ăn thật: nền khung là kem (sáng) hoặc đen ấm (tối), KHÔNG phải xám trung tính cũ", async ({ page }, info) => {
    await vao(page, "/elearning");
    const mau = await nen(page, "[data-elearning-theme]");
    const toi = info.project.name === "elearning-dark";
    // --background: #f6f4f0 = rgb(246, 244, 240) · tối #161513 = rgb(22, 21, 19)
    expect(mau).toBe(toi ? "rgb(22, 21, 19)" : "rgb(246, 244, 240)");
  });

  test("`.dark` chỉ nằm trên .elearning-root khi tối; KHÔNG BAO GIỜ trên <html>/<body>", async ({ page }, info) => {
    await vao(page, "/elearning");
    const toi = info.project.name === "elearning-dark";
    await expect(page.locator("[data-elearning-theme]")).toHaveClass(toi ? /\bdark\b/ : /^(?!.*\bdark\b)/);
    const rac = await page.evaluate(() => ({
      html: document.documentElement.classList.contains("dark"),
      body: document.body.classList.contains("dark"),
    }));
    expect(rac).toEqual({ html: false, body: false });
  });

  test("đổi sang Tối bằng nút ⇒ gốc tối, được nhớ sau khi tải lại; đổi lại Sáng ⇒ hết tối", async ({ page }, info) => {
    test.skip(info.project.name === "elearning-dark", "project tối đã có sẵn colorScheme dark");
    await vao(page, "/elearning");
    // Thiết kế: công tắc giao diện nằm TRONG menu tài khoản (một dòng "Giao diện tối").
    await page.getByRole("button", { name: "Menu tài khoản" }).click();
    await page.getByRole("menuitem", { name: "Giao diện tối" }).click();
    await expect(page.locator("[data-elearning-theme]")).toHaveClass(/\bdark\b/);
    expect(await nen(page, "[data-elearning-theme]")).toBe("rgb(22, 21, 19)");
    await page.reload();
    await expect(page.locator("[data-elearning-theme]")).toHaveClass(/\bdark\b/);
    await page.getByRole("button", { name: "Menu tài khoản" }).click();
    await page.getByRole("menuitem", { name: "Giao diện sáng" }).click();
    await expect(page.locator("[data-elearning-theme]")).not.toHaveClass(/\bdark\b/);
  });

  test("hộp nổi qua portal mang token cùng chế độ với trang (menu tài khoản)", async ({ page }, info) => {
    await vao(page, "/elearning");
    await page.getByRole("button", { name: "Menu tài khoản" }).click();
    const popup = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(popup).toBeVisible();
    const toi = info.project.name === "elearning-dark";
    // --popover: #fffefc = rgb(255, 254, 252) · tối #1c1a18 = rgb(28, 26, 24)
    expect(await nen(page, '[data-slot="dropdown-menu-content"]')).toBe(toi ? "rgb(28, 26, 24)" : "rgb(255, 254, 252)");
  });
});
