/**
 * [KH2-*] Hai khung của e-learning (P1): nhân viên (thanh trên một hàng + thanh dưới điện thoại) và quản trị (thanh bên).
 * HÀNH VI THẬT trong trình duyệt — bố cục co giãn và cổng "người học không thấy lối vào quản trị" không đo được bằng jsdom.
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG: "không thấy X" luôn đạt nếu khung hỏng hẳn.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

let d: BoDuLieu;
const cookieCua = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  for (const email of [d.hocVienEmail, d.daoTaoEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    await expect(p).toHaveURL(/\/elearning/);
    cookieCua.set(email, await ctx.cookies());
    await ctx.close();
  }
});

async function vaoVoi(page: Page, email: string, duongDan: string) {
  const ck = cookieCua.get(email);
  if (!ck) throw new Error(`chưa có phiên cho ${email}`);
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(ck);
  await page.goto(duongDan);
}

const thanhTren = (page: Page) => page.locator("header").first();

test.describe("[KH2-1] khung NHÂN VIÊN — thanh trên luôn MỘT hàng ở mọi độ rộng", () => {
  for (const w of [375, 720, 721, 900, 1180, 1280]) {
    test(`@${w}: mọi phần tử của thanh trên nằm trên cùng một hàng và không tràn ngang`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await vaoVoi(page, d.hocVienEmail, "/elearning");
      const hd = thanhTren(page);
      await expect(hd).toBeVisible(); // đối chứng dương: thanh trên có mặt
      const kq = await hd.evaluate((el) => {
        const cao = el.getBoundingClientRect().height;
        const tren = Array.from(el.querySelectorAll<HTMLElement>("a, button, input, form"))
          .filter((e) => e.offsetParent !== null) // chỉ phần tử đang hiện
          .map((e) => Math.round(e.getBoundingClientRect().top));
        return { cao, lech: Math.max(...tren) - Math.min(...tren), tran: document.documentElement.scrollWidth - innerWidth };
      });
      expect(kq.cao, "thanh trên cao hơn một hàng").toBeLessThanOrEqual(65);
      expect(kq.lech, "có phần tử xuống hàng thứ hai").toBeLessThanOrEqual(24);
      expect(kq.tran, "trang tràn ngang").toBeLessThanOrEqual(1);
    });
  }

  test("tên người dùng ẩn ≤1180px, hiện ở 1280px; chữ thương hiệu ẩn ≤900px, hiện ở 1280px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await vaoVoi(page, d.hocVienEmail, "/elearning");
    await expect(page.getByText("Cổng Elearning", { exact: true })).toBeVisible();
    const ten = page.getByRole("button", { name: "Menu tài khoản" }).locator("span.truncate").first();
    await expect(ten).toBeVisible();
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(ten).toBeHidden();
    await expect(page.getByText("Cổng Elearning", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 850, height: 800 });
    await expect(page.getByText("Cổng Elearning", { exact: true })).toBeHidden();
  });
});

test.describe("[KH2-2] điều hướng: thanh trên ≥721px, thanh dưới ≤720px", () => {
  test("≤720px: có thanh dưới với các mục có chữ, thanh điều hướng trên ẩn", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await vaoVoi(page, d.hocVienEmail, "/elearning");
    const duoi = page.getByRole("navigation", { name: "Điều hướng chính (điện thoại)" });
    await expect(duoi).toBeVisible();
    await expect(duoi.getByRole("link")).toHaveCount(3);
    await expect(duoi.getByRole("link", { name: "Tổng quan" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Điều hướng chính", exact: true })).toBeHidden();
  });

  test("≥721px: thanh điều hướng trên hiện, thanh dưới ẩn", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await vaoVoi(page, d.hocVienEmail, "/elearning");
    await expect(page.getByRole("navigation", { name: "Điều hướng chính", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Điều hướng chính (điện thoại)" })).toBeHidden();
  });

  test("bấm 'Khoá' trên thanh dưới đi tới Khoá của tôi và mục đó sáng", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await vaoVoi(page, d.hocVienEmail, "/elearning");
    await page.getByRole("navigation", { name: "Điều hướng chính (điện thoại)" }).getByRole("link", { name: "Khoá" }).click();
    await expect(page).toHaveURL(/\/elearning\/khoa-cua-toi/);
    await expect(
      page.getByRole("navigation", { name: "Điều hướng chính (điện thoại)" }).getByRole("link", { name: "Khoá" }),
    ).toHaveAttribute("aria-current", "page");
  });
});

test.describe("[KH2-3] người học KHÔNG thấy lối vào quản trị (kèm đối chứng dương)", () => {
  test("người học: không có thanh bên, không có 'Sang khu Quản trị'", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await vaoVoi(page, d.hocVienEmail, "/elearning");
    await page.getByRole("button", { name: "Menu tài khoản" }).click();
    await expect(page.getByRole("menuitem", { name: "Dữ liệu của tôi" })).toBeVisible(); // đối chứng dương: menu mở được
    await expect(page.getByRole("menuitem", { name: "Sang khu Quản trị" })).toHaveCount(0);
    await expect(page.locator("aside.fixed")).toHaveCount(0);
  });

  test("người học gõ thẳng URL quản trị ⇒ vẫn khung nhân viên (không thanh bên quản trị) và trang từ chối", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await vaoVoi(page, d.hocVienEmail, "/elearning/dao-tao");
    await expect(page.getByText("Bạn không có quyền xem tổng quan Đào tạo")).toBeVisible();
    await expect(page.locator("aside.fixed")).toHaveCount(0);
  });

  test("ĐỐI CHỨNG DƯƠNG: Đào tạo thấy 'Sang khu Quản trị'; bấm vào ⇒ thanh bên quản trị; có 'Sang khu Học tập' để quay lại", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await vaoVoi(page, d.daoTaoEmail, "/elearning");
    await page.getByRole("button", { name: "Menu tài khoản" }).click();
    await page.getByRole("menuitem", { name: "Sang khu Quản trị" }).click();
    await expect(page.locator("aside.fixed")).toBeVisible();
    await expect(page.locator("aside.fixed").getByRole("link", { name: "Khoá học" })).toBeVisible();
    await page.getByRole("button", { name: "Menu tài khoản" }).click();
    await page.getByRole("menuitem", { name: "Sang khu Học tập" }).click();
    await expect(page).toHaveURL(/\/elearning\/?$/);
    await expect(page.locator("aside.fixed")).toHaveCount(0);
  });

  test("khung quản trị KHÔNG chứa mục của khu Học tập (hai khung không dùng chung menu)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await vaoVoi(page, d.daoTaoEmail, "/elearning/dao-tao");
    await expect(page.locator("aside.fixed")).toBeVisible();
    await expect(page.locator("aside.fixed").getByRole("link", { name: "Khoá của tôi" })).toHaveCount(0);
  });
});
