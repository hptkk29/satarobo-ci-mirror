/**
 * Manual smoke — nhập liệu THẬT vào dev server (satarobo_dev) qua UI.
 * Đăng nhập admin SUPER_ADMIN rồi tạo: tài khoản (đa vai trò), nhân sự, khóa học
 * (course-package), phòng, ngày nghỉ, lead. Mỗi test chụp screenshot làm bằng chứng.
 *
 * Chạy (server dev đã chạy ở :3000):
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PW = process.env.ADMIN_PW ?? process.env.SEED_ADMIN_PASSWORD ?? "";
const STAMP = Date.now().toString().slice(-7);

async function login(page: Page) {
  await sharedLogin(page, { email: ADMIN_EMAIL, password: ADMIN_PW, timeout: 120_000 });
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

// ── 1. Tài khoản đăng nhập — ĐA VAI TRÒ (tính năng vừa sửa) ──────────────────
test("tạo Tài khoản với NHIỀU vai trò", async ({ page }) => {
  const email = `qa.multirole.${STAMP}@satarobo.vn`;
  await page.goto("/users/new");
  await expect(page.getByRole("heading", { name: "Tạo tài khoản mới" })).toBeVisible();

  await page.getByLabel("Tên hiển thị *").fill(`QA Multi ${STAMP}`);
  await page.getByLabel("Email *").fill(email);
  await page.getByLabel("Mật khẩu *").fill("QaPassw0rd!");

  // Chọn thêm 2 vai trò (mặc định đã có "Tư vấn & Chăm sóc").
  await page.getByLabel("Nhân sự (HR)").check();
  await page.getByLabel("Kế toán").check();

  await page.getByRole("button", { name: "Tạo tài khoản" }).click();

  // Thành công → quay lại danh sách /users và thấy email mới.
  await expect(page).toHaveURL(/\/users(\?|$)/, { timeout: 120_000 });
  const row = page.getByRole("row", { name: new RegExp(email) });
  await expect(row).toBeVisible();
  // FE đồng bộ BE: hiển thị NHIỀU badge vai trò trong cùng 1 hàng.
  const badges = row.locator("span").filter({ hasText: /Tư vấn|Nhân sự|Kế toán/ });
  expect(await badges.count()).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: `test-results/manual-01-user-multirole.png`, fullPage: true });
});

// ── 2. Nhân sự ───────────────────────────────────────────────────────────────
test("tạo Nhân sự mới", async ({ page }) => {
  await page.goto("/nhan-su/new");
  await page.getByPlaceholder("SR.NV.001").fill(`SR.QA.${STAMP}`);
  // employee-form: label không gắn htmlFor → lấy input/select kế sau nhãn.
  await page.getByText("Họ tên", { exact: false }).locator("xpath=following::input[1]").fill(`QA Nhân Sự ${STAMP}`);
  await page.getByText("Chức danh", { exact: false }).locator("xpath=following::input[1]").fill("Nhân viên QA");
  await page.getByText("Phòng ban", { exact: false }).locator("xpath=following::select[1]").selectOption({ index: 0 });

  await page.getByRole("button", { name: "Tạo nhân sự" }).click();
  await expect(page).toHaveURL(/\/nhan-su(\?|$)/, { timeout: 120_000 });
  await page.screenshot({ path: `test-results/manual-02-nhan-su.png`, fullPage: true });
});

// ── 3. Khóa học (course-package) ─────────────────────────────────────────────
test("tạo Khóa học (course-package)", async ({ page }) => {
  await page.goto("/course-packages/new");
  await page.getByLabel(/^Code/).fill(`QA${STAMP}`);
  await page.getByLabel("Tên", { exact: true }).fill(`QA Khóa học ${STAMP}`);

  await page.getByRole("button", { name: "Tạo mới" }).click();
  // Thành công → rời /new (createPackage redirect) và không có banner lỗi.
  await expect(page).not.toHaveURL(/\/course-packages\/new/, { timeout: 120_000 });
  await page.screenshot({ path: `test-results/manual-03-course-package.png`, fullPage: true });
});

// ── 4. Phòng học ─────────────────────────────────────────────────────────────
test("tạo Phòng học", async ({ page }) => {
  await page.goto("/rooms/new");
  await page.getByLabel("Tên phòng").fill(`QA Phòng ${STAMP}`);
  await page.getByLabel("Mã phòng").fill(`QA-${STAMP}`);
  await page.getByLabel("Cơ sở").selectOption({ index: 0 });

  await page.getByRole("button", { name: "Tạo phòng" }).click();
  await expect(page).toHaveURL(/\/rooms(\?|$)/, { timeout: 120_000 });
  await page.screenshot({ path: `test-results/manual-04-room.png`, fullPage: true });
});

// ── 5. Ngày nghỉ ─────────────────────────────────────────────────────────────
test("tạo Ngày nghỉ", async ({ page }) => {
  await page.goto("/holidays/new");
  await page.getByLabel("Tên ngày nghỉ").fill(`QA Nghỉ ${STAMP}`);
  await page.getByLabel("Ngày bắt đầu").fill("2026-12-25");

  await page.getByRole("button", { name: "Tạo ngày nghỉ" }).click();
  await expect(page).toHaveURL(/\/holidays(\?|$)/, { timeout: 120_000 });
  await page.screenshot({ path: `test-results/manual-05-holiday.png`, fullPage: true });
});

// ── 6. Lead ──────────────────────────────────────────────────────────────────
test("tạo Lead", async ({ page }) => {
  // 03/09/2026 — `/leads/new` ĐÃ GỠ (chỉ còn `redirect()` sang đây). Biểu mẫu
  // thật là `/nhap-khach-hang`: nó đi qua đường nhận lead chung nên có chống
  // trùng SĐT + tự chia, hai thứ màn cũ không có.
  await page.goto("/nhap-khach-hang");
  await page.getByLabel("Tên phụ huynh").fill(`QA Phụ Huynh ${STAMP}`);
  await page.getByLabel("SĐT phụ huynh").fill(`09${STAMP}0`);
  await page.getByLabel("Tên bé thứ 1").fill(`QA Bé ${STAMP}`);

  // Biểu mẫu này Ở LẠI TRANG sau khi lưu (gõ phiếu tiếp) — KHÔNG điều hướng.
  // Dấu hiệu thành công là thông báo + phiếu hiện trong danh sách "vừa nhập".
  await page.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ }).click();
  await expect(page.getByText(`QA Phụ Huynh ${STAMP}`).first()).toBeVisible({
    timeout: 120_000,
  });
  await page.screenshot({ path: `test-results/manual-06-lead.png`, fullPage: true });
});
