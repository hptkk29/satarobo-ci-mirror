/**
 * Manual LMS deep flows — F.2 (payment confirm→receipt) + G (portal phụ huynh).
 * Đi qua UI thật (auth + server action). Tiếp nối R7-LMS-test-session-record.
 *
 *   ADMIN_EMAIL=test-admin@example.com ADMIN_PW='Test@1234!' \
 *   PARENT_EMAIL=test-convert@example.com PARENT_PW='Test@1234!' \
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts lms-r7-flows
 */
import { test, expect, type Page } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "test-admin@example.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Test@1234!";
const PARENT_EMAIL = process.env.PARENT_EMAIL ?? "test-convert@example.com";
const PARENT_PW = process.env.PARENT_PW ?? "Test@1234!";

async function login(page: Page, email: string, pw: string) {
  await sharedLogin(page, { email, password: pw, timeout: 120_000 });
}

// ─── F.2 — Kế toán xác nhận khoản PENDING → sinh phiếu thu ──────────────────
test("F.2 confirm payment → receipt", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  await login(page, ADMIN_EMAIL, ADMIN_PW);
  await page.goto("/admin/payments", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.screenshot({ path: testInfo.outputPath("f2-before.png"), fullPage: true });

  // Tìm hàng: số tiền 1.485.000 + badge "Chờ kế toán" → bấm nút Xác nhận (Check).
  const row = page
    .locator("tr")
    .filter({ hasText: "1.485.000" })
    .filter({ hasText: "Chờ kế toán" })
    .first();
  await expect(row, "phải có ≥1 khoản 1.485.000 đang Chờ kế toán").toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "Xác nhận" }).click();

  // Toast xác nhận — kỳ vọng "đã sinh phiếu thu".
  const toast = page.getByText(/Đã xác nhận/i).first();
  await expect(toast).toBeVisible({ timeout: 30_000 });
  const toastText = await toast.innerText().catch(() => "");
  // eslint-disable-next-line no-console
  console.log("[F.2] toast:", toastText);
  await page.screenshot({ path: testInfo.outputPath("f2-after-toast.png"), fullPage: true });

  // Reload → hàng phải hiện "Đã xác nhận" + có mã phiếu thu (cột Phiếu thu).
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await expect(page.getByText("Đã xác nhận").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath("f2-after-reload.png"), fullPage: true });
  // eslint-disable-next-line no-console
  console.log("[F.2] confirm flow done — kiểm receipt qua screenshot + DB.");
});

// ─── G.6 — Portal phụ huynh: học phí CHỈ hiện khoản CONFIRMED ───────────────
test("G portal phụ huynh: ho-so, hoc-phi(CONFIRMED), hoc-ba", async ({ page }, testInfo) => {
  test.setTimeout(8 * 60_000);
  await login(page, PARENT_EMAIL, PARENT_PW);

  const portalRoutes = ["/portal", "/portal/ho-so", "/portal/ho-so-con", "/portal/lich-hoc", "/portal/hoc-phi", "/portal/hoc-ba", "/portal/thong-bao"];
  for (const r of portalRoutes) {
    const resp = await page.goto(r, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    const http = resp?.status() ?? 0;
    const onLogin = /\/login(\?|$)/.test(page.url());
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    const err = /Application error|Unhandled Runtime Error|something went wrong/i.test(body);
    // eslint-disable-next-line no-console
    console.log(`[G] ${r} :: http=${http} onLogin=${onLogin} err=${err}`);
    const safe = r.replace(/\//g, "_");
    await page.screenshot({ path: testInfo.outputPath(`portal${safe}.png`), fullPage: true }).catch(() => {});
    expect(onLogin, `${r} không được redirect login`).toBeFalsy();
    expect(err, `${r} không có error boundary`).toBeFalsy();
  }

  // G.6 — hoc-phi: KHÔNG được lộ studentId trên URL; chỉ hiện CONFIRMED.
  await page.goto("/portal/hoc-phi", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const feeBody = (await page.locator("body").innerText().catch(() => "")) || "";
  // eslint-disable-next-line no-console
  console.log("[G.6] hoc-phi body (first 600):\n", feeBody.slice(0, 600));
});
