/**
 * [CNM-E2E-*] P8/QtMauCN (phần không phụ thuộc quyết định): trang Mẫu chứng nhận + xem thử PDF thật + đánh giá ảnh hưởng bằng số liệu thật.
 * Ảnh ở `E:\tmp\cnm-shots` để so thiết kế — KHÔNG phải VISUAL_VERIFIED (thiết kế còn nhiều thứ chưa làm vì chờ quyết định: D-45).
 */
import { mkdirSync } from "node:fs";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { capChungNhanThu, dungVongHoc, goChungNhanThu, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

const ANH = "E:/tmp/cnm-shots";
let d: BoDuLieu;
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  await goChungNhanThu(d.enrollmentId);
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
const soAnhHuong = async (page: Page) => Number((await page.getByText(/Tác động tới \d+ chứng nhận/).first().innerText()).match(/Tác động tới (\d+)/)![1]);

test("[CNM-E2E-01] 🔴 trang Mẫu chứng nhận: hai thẻ (nhân viên đang dùng · online chưa có), bảng chữ tự điền, ghi rõ chờ quyết định; KHÔNG có nút thay phôi / đặt vị trí chữ (chưa có backend)", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/chung-nhan/mau");
  await expect(page.getByRole("heading", { name: "Mẫu giấy chứng nhận", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mẫu nhân viên" })).toContainText("Đang dùng");
  await expect(page.getByRole("region", { name: "Mẫu học viên online" })).toContainText("Chưa có");
  await expect(page.getByRole("cell", { name: "Tên người nhận" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Tên khoá học" })).toBeVisible();
  await expect(page.getByText(/Đang chờ Owner quyết định/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Thay phôi|Đặt vị trí chữ/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Thay phôi|Đặt vị trí chữ/ })).toHaveCount(0);
  await page.screenshot({ path: `${ANH}/cnm-mau-${page.viewportSize()?.width ?? 0}.png`, fullPage: true });
  const du = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(du).toBeLessThanOrEqual(1);
});

test("[CNM-E2E-02] 🔴 XEM MẪU PDF thật: liên kết trả PDF (%PDF) bằng người giả, không phải chứng nhận thật; người học thuần bị chặn 403 và không vào được trang", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/chung-nhan/mau");
  const href = await page.getByRole("link", { name: "Xem mẫu PDF" }).getAttribute("href");
  expect(href).toBe("/api/elearning/chung-nhan/mau-xem");
  const r = await page.request.get(href!);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toContain("application/pdf");
  expect((await r.body()).subarray(0, 4).toString()).toBe("%PDF");
  await vao(page, d.hocVienEmail, "/elearning/chung-nhan/mau");
  await expect(page.getByText(/elearning:progress:view-all/).first()).toBeVisible();
  expect((await page.request.get("/api/elearning/chung-nhan/mau-xem")).status()).toBe(403);
});

test("[CNM-E2E-03] 🔴 đánh giá ảnh hưởng dùng SỐ LIỆU THẬT: cấp thêm một chứng nhận ⇒ 'Tác động tới N' tăng đúng 1; lối vào từ danh sách chứng nhận hoạt động", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/chung-nhan/mau");
  const truoc = await soAnhHuong(page);
  await capChungNhanThu(d.enrollmentId);
  await vao(page, d.daoTaoEmail, "/elearning/chung-nhan/mau");
  expect(await soAnhHuong(page)).toBe(truoc + 1);
  await vao(page, d.daoTaoEmail, "/elearning/chung-nhan");
  await page.getByRole("link", { name: "Mẫu chứng nhận", exact: true }).click();
  await expect(page).toHaveURL(/\/elearning\/chung-nhan\/mau$/);
});
