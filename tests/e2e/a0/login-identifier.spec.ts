/**
 * AUTH-SĐT P3 — login nhận CẢ SĐT lẫn email (DoD P3).
 *
 * Đi qua form /login THẬT (Credentials provider) như mọi spec a0 — không mở
 * backdoor. Case tag [P3-Cx] để grep đối chiếu kế hoạch AUTH-SĐT §4 P3.
 *
 * CHẠY: cần Postgres LOCAL (pnpm db:test:up) — không chạy trên Supabase.
 */
import { test, expect } from "@playwright/test";
import { resetDb, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { testEmail, TEST_PASSWORD } from "../_helpers/fixtures";

const PHONE = "84905000111"; // canonical — cột User.phone LUÔN lưu dạng này

test.describe("[P3] Login bằng SĐT hoặc email", () => {
  test.beforeEach(async () => {
    await resetDb();
    await seedUser({
      email: testEmail("p3-admin"),
      role: "SUPER_ADMIN",
      phone: PHONE,
    });
  });

  test("[P3-C1] tài khoản cũ đăng nhập bằng EMAIL vẫn vào y hệt (hồi quy)", async ({ page }) => {
    await login(page, { email: testEmail("p3-admin") });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("[P3-C2] đăng nhập bằng SĐT dạng canonical 84905…", async ({ page }) => {
    await login(page, { email: PHONE });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("[P3-C3] đăng nhập bằng SĐT dạng nội địa 0905… (khác dạng lưu DB)", async ({ page }) => {
    await login(page, { email: "0905 000 111" });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("[P3-C4] SĐT đúng + mật khẩu SAI → ở lại /login, báo lỗi chung", async ({ page }) => {
    await page.goto("/login");
    const field = page.getByLabel("Số điện thoại hoặc Email");
    await expect(async () => {
      await field.fill(PHONE);
      await page.getByLabel("Mật khẩu").fill("SaiMatKhau@1");
      await expect(field).toHaveValue(PHONE, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(
      page.getByText("Thông tin đăng nhập hoặc mật khẩu không đúng", { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("[P3-C5] SĐT không tồn tại + password hợp lệ → không vào được", async ({ page }) => {
    await page.goto("/login");
    const field = page.getByLabel("Số điện thoại hoặc Email");
    await expect(async () => {
      await field.fill("0905999888");
      await page.getByLabel("Mật khẩu").fill(TEST_PASSWORD);
      await expect(field).toHaveValue("0905999888", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
