/**
 * [CNT-E2E-*] P8 · Màn Chứng nhận có 3 tab (Tất cả · Nhân viên · Học viên online) theo `QtChungNhan`; miền Online đọc bảng + quyền `onl:*` RIÊNG.
 * Ảnh ở `E:\tmp\cnt-shots` — KHÔNG phải VISUAL_VERIFIED.
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { capChungNhanThu, dungVongHoc, goChungNhanThu, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/cnt-shots";
let d: BoDuLieu;
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await goChungNhanThu(d.enrollmentId);
  await capChungNhanThu(d.enrollmentId);
  mkdirSync(ANH, { recursive: true });
  for (const email of [d.daoTaoEmail, d.hocVienEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    await expect(p).toHaveURL(/\/elearning/);
    cookie.set(email, await ctx.cookies());
    await ctx.close();
  }
});
test.afterAll(async () => goChungNhanThu(d.enrollmentId));

async function vao(page: Page, email: string, duongDan: string) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookie.get(email)!);
  await page.goto(duongDan);
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}
const tabs = (page: Page) => page.getByRole("navigation", { name: "Nguồn chứng nhận" });

test("[CNT-E2E-01] 🔴 ba tab: mặc định 'Tất cả' có CẢ phần nhân viên lẫn phần online; tab 'Nhân viên' chỉ nhân viên; tab 'Học viên online' chỉ online (miền tách bạch)", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/chung-nhan");
  await expect(tabs(page).getByRole("link", { name: /Tất cả/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/Chứng nhận nhân viên \(\d+\)/)).toBeVisible();
  await expect(page.getByText(/Chứng nhận học viên online/)).toBeVisible();
  await page.screenshot({ path: `${ANH}/cnt-tat-ca-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
  await tabs(page).getByRole("link", { name: /Nhân viên/ }).click();
  await expect(page).toHaveURL(/tab=nhan-vien/);
  await expect(page.getByText(/Chứng nhận nhân viên \(\d+\)/)).toBeVisible();
  await expect(page.getByText(/Chứng nhận học viên online/)).toHaveCount(0);
  await tabs(page).getByRole("link", { name: /Học viên online/ }).click();
  await expect(page).toHaveURL(/tab=hoc-vien-online/);
  await expect(page.getByText(/Chứng nhận nhân viên/)).toHaveCount(0);
  await expect(page.getByText(/Chứng nhận học viên online/)).toBeVisible();
  const du = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(du).toBeLessThanOrEqual(1);
});

test("[CNT-E2E-02] 🔴 người học thuần: danh sách chứng nhận bị CHẶN cả ba tab (không thấy chứng nhận người khác); lối vào 'Mẫu chứng nhận' không có", async ({ page }) => {
  for (const t of ["tat-ca", "nhan-vien", "hoc-vien-online"]) {
    await vao(page, d.hocVienEmail, `/elearning/chung-nhan?tab=${t}`);
    await expect(page.getByText(/elearning:progress:view-all/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Mẫu chứng nhận", exact: true })).toHaveCount(0);
  }
});
