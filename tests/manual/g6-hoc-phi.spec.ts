/**
 * G.6 verify — /portal/hoc-phi hiện khoản CONFIRMED + phiếu thu + số dư.
 *   PARENT_EMAIL=test-convert@example.com PARENT_PW='Test@1234!' \
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts g6-hoc-phi
 */
import { test, expect, type Page } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";

const PARENT_EMAIL = process.env.PARENT_EMAIL ?? "test-convert@example.com";
const PARENT_PW = process.env.PARENT_PW ?? "Test@1234!";

async function login(page: Page, email: string, pw: string) {
  await sharedLogin(page, { email, password: pw, timeout: 120_000 });
}

test("G.6 hoc-phi hiện khoản CONFIRMED + receipt + số dư", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  await login(page, PARENT_EMAIL, PARENT_PW);
  await page.goto("/portal/hoc-phi", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  // eslint-disable-next-line no-console
  console.log("[G.6] body:\n", body);
  await page.screenshot({ path: testInfo.outputPath("g6-hoc-phi.png"), fullPage: true });

  // Kỳ vọng: khoản 1.485.000 đã xác nhận + phiếu thu RCP-SR-26-0001 + thẻ số dư.
  await expect(page.getByText("Khoản đã thanh toán")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("RCP-SR-26-0001")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/1\.485\.000/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Đã thanh toán").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Còn lại")).toBeVisible({ timeout: 15_000 });
  // eslint-disable-next-line no-console
  console.log("[G.6] PASS — khoản CONFIRMED + receipt + số dư hiển thị.");
});
