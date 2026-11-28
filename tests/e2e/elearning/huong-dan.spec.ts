/**
 * [HD-E2E-*] P8 — Hướng dẫn sử dụng, trình duyệt thật: nhân viên mở từ MENU TÀI KHOẢN, quản trị mở từ biểu tượng trợ giúp; mỗi bài đủ bước + Trước/Tiếp; ranh giới giữa hai khu.
 * Mỗi ca ÂM có đối chứng dương.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

let d: BoDuLieu;
const cookie = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  for (const email of [d.hocVienEmail, d.daoTaoEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    cookie.set(email, await ctx.cookies());
    await ctx.close();
  }
});

/** `khongCoVo`: trang 404 (bản build dựng 404 KHÔNG kèm vỏ e-learning) — chỉ cần chữ, không chờ `[data-elearning-theme]`. */
async function vao(page: Page, email: string, duongDan: string, khongCoVo = false) {
  // Rời trang cũ TRƯỚC khi đổi cookie: yêu cầu nền của trang cũ (làm mới phiên) về muộn sẽ ghi đè cookie mới (D-51).
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(cookie.get(email)!);
  await page.goto(duongDan);
  if (!khongCoVo) await expect(page.locator("[data-elearning-theme]")).toBeVisible();
}

test("[HD-E2E-01] nhân viên: danh sách 4 bài; mở 'Học một khoá được giao' ⇒ 4 bước + Bài tiếp; đi hết tới 'Về danh sách'", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/huong-dan");
  await expect(page.getByRole("heading", { level: 1, name: "Hướng dẫn sử dụng" })).toBeVisible();
  const ds = page.getByRole("list", { name: "Các bài hướng dẫn" });
  await expect(ds.getByRole("listitem")).toHaveCount(4);
  await ds.getByRole("link", { name: /Học một khoá được giao/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Học một khoá được giao" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Các bước" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByText(/4 bước · khoảng 4 phút/)).toBeVisible();
  // Bài đầu: không có "Bài trước"; có "Bài tiếp".
  await expect(page.getByRole("link", { name: /Bài trước/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Bài tiếp: Làm bài kiểm tra/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Làm bài kiểm tra" })).toBeVisible();
  await page.getByRole("link", { name: /Bài tiếp: Nộp bài tập/ }).click();
  await page.getByRole("link", { name: /Bài tiếp: Xem và tải chứng nhận/ }).click();
  // Bài cuối: không có "Bài tiếp", có "Về danh sách hướng dẫn".
  await expect(page.getByRole("link", { name: /Bài tiếp/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Về danh sách hướng dẫn" }).click();
  await expect(page).toHaveURL(/\/elearning\/huong-dan$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test("[HD-E2E-02] nhân viên mở được hướng dẫn từ MENU TÀI KHOẢN (lối vào có thật, không chỉ gõ đường dẫn)", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning");
  // Menu tài khoản: nút avatar mở danh sách; chờ hydration thật bằng toPass (mở menu rồi thấy mục).
  const muc = page.getByRole("menuitem", { name: /Hướng dẫn sử dụng/ });
  await expect(async () => {
    await page.getByRole("button", { name: "Menu tài khoản" }).click();
    await expect(muc).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  await muc.click();
  await expect(page).toHaveURL(/\/elearning\/huong-dan$/);
});

test("[HD-E2E-03] 🔴 ranh giới khu: nhân viên mở bài QUẢN TRỊ bằng đường nhân viên ⇒ 404; nhân viên KHÔNG vào được hướng dẫn quản trị (bị từ chối, không thấy nội dung)", async ({ page }) => {
  await vao(page, d.hocVienEmail, "/elearning/huong-dan/soan-khoa", true);
  await expect(page.getByText(/lạc đường|không tìm thấy/i).first()).toBeVisible();
  await expect(page.getByText("Soạn và gửi duyệt khoá nội bộ")).toHaveCount(0);
  await vao(page, d.hocVienEmail, "/elearning/huong-dan-quan-tri");
  await expect(page.getByText(/không có quyền/i).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Các bài hướng dẫn" })).toHaveCount(0);
});

test("[HD-E2E-04] quản trị: danh sách 5 bài (có 'Giao khoá cho nhân viên'); mở bài ⇒ bước + Trước/Tiếp; đối chứng: bài nhân viên mở bằng đường quản trị ⇒ 404", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/huong-dan-quan-tri");
  const ds = page.getByRole("list", { name: "Các bài hướng dẫn" });
  await expect(ds.getByRole("listitem")).toHaveCount(5);
  await ds.getByRole("link", { name: /Giao khoá cho nhân viên/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Giao khoá cho nhân viên" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Các bước" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("link", { name: /Bài trước: Soạn và gửi duyệt/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Bài tiếp: Chấm bài tập/ })).toBeVisible();
  await vao(page, d.daoTaoEmail, "/elearning/huong-dan-quan-tri/hoc-khoa", true);
  await expect(page.getByText(/lạc đường|không tìm thấy/i).first()).toBeVisible();
});

test("[HD-E2E-05] quản trị mở hướng dẫn từ BIỂU TƯỢNG TRỢ GIÚP trên thanh trên", async ({ page }) => {
  await vao(page, d.daoTaoEmail, "/elearning/dao-tao");
  const trogiup = page.getByRole("link", { name: "Hướng dẫn sử dụng" }).first();
  // Biểu tượng ẩn ≤ 720px (như các biểu tượng phụ khác của thanh trên): điện thoại mở bằng đường dẫn.
  if (await trogiup.isVisible()) {
    await trogiup.click();
    await expect(page).toHaveURL(/\/elearning\/huong-dan-quan-tri$/);
  } else {
    await vao(page, d.daoTaoEmail, "/elearning/huong-dan-quan-tri");
  }
  await expect(page.getByRole("heading", { level: 1, name: "Hướng dẫn sử dụng" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
