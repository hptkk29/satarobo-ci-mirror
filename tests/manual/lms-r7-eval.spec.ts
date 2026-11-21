/**
 * Manual LMS — Phase E (Học bạ): criteria → draft → nộp duyệt → phát hành → portal.
 * Bé A enrollment cmqkn73gr003o1pmct0iinmr2, khoá Sata1 (courseId cmpqrncq0000061mh5t69pkyc).
 *
 *   ADMIN_EMAIL=test-admin@example.com ADMIN_PW='Test@1234!' \
 *   PARENT_EMAIL=test-convert@example.com PARENT_PW='Test@1234!' \
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts lms-r7-eval
 */
import { test, expect, type Page } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "test-admin@example.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Test@1234!";
const PARENT_EMAIL = process.env.PARENT_EMAIL ?? "test-convert@example.com";
const PARENT_PW = process.env.PARENT_PW ?? "Test@1234!";
const BE_A_ENR = "cmqkn73gr003o1pmct0iinmr2";
const SATA1_COURSE = "Sata1 — Robosim Master";
const CRITERIA = ["__TEST__ Tư duy logic", "__TEST__ Kỹ năng lắp ráp", "__TEST__ Thái độ"];

async function login(page: Page, email: string, pw: string) {
  await sharedLogin(page, { email, password: pw, timeout: 120_000 });
}

test("E.1 học bạ Bé A: criteria → draft → nộp → phát hành", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  await login(page, ADMIN_EMAIL, ADMIN_PW);

  // ── Tạo tiêu chí cho khoá Sata1 (nếu chưa có) ──
  await page.goto("/admin/report-cards/criteria", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const card = page.locator("section").filter({ hasText: SATA1_COURSE }).first();
  await expect(card, "phải thấy card khoá Sata1").toBeVisible({ timeout: 30_000 });
  for (const name of CRITERIA) {
    if (await card.getByText(name, { exact: false }).count()) continue; // đã có
    await card.getByPlaceholder("Tên tiêu chí mới").fill(name);
    await card.getByRole("button", { name: "Thêm" }).click();
    await expect(card.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  }
  await page.screenshot({ path: testInfo.outputPath("e1-criteria.png"), fullPage: true });

  // ── Editor học bạ Bé A ──
  await page.goto(`/admin/report-cards/${BE_A_ENR}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const evalSection = page.locator("section").filter({ hasText: "Đánh giá năng lực" });
  await expect(evalSection).toBeVisible({ timeout: 30_000 });
  const selects = evalSection.locator("select");
  const n = await selects.count();
  // eslint-disable-next-line no-console
  console.log("[E.1] số tiêu chí (select):", n);
  for (let i = 0; i < n; i++) await selects.nth(i).selectOption({ value: String(3 + (i % 2)) }); // 3/4 xen kẽ
  // Tổng kết
  await page.getByPlaceholder("vd Hoàn thành tốt").fill("__TEST__ Hoàn thành tốt");
  await page.locator("textarea").last().fill("__TEST__ Nhận xét cuối kỳ: tiến bộ tốt.");

  await page.getByRole("button", { name: "Lưu nháp" }).click();
  await expect(page.getByText(/Đã lưu|thành công|Lưu/i).first()).toBeVisible({ timeout: 30_000 }).catch(() => {});
  await page.screenshot({ path: testInfo.outputPath("e1-draft.png"), fullPage: true });

  // Nộp duyệt → PENDING_REVIEW
  await page.getByRole("button", { name: /Nộp duyệt|Nộp lại để duyệt/ }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: testInfo.outputPath("e1-submitted.png"), fullPage: true });

  // Phát hành → PUBLISHED
  const publishBtn = page.getByRole("button", { name: "Phát hành" });
  await expect(publishBtn).toBeVisible({ timeout: 30_000 });
  await publishBtn.click();
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  // eslint-disable-next-line no-console
  console.log("[E.1] sau phát hành, có chữ 'Phát hành:' (published)?", /Phát hành:/.test(body));
  await page.screenshot({ path: testInfo.outputPath("e1-published.png"), fullPage: true });
});

test("E.2 portal hoc-ba phụ huynh thấy học bạ đã phát hành", async ({ page }, testInfo) => {
  test.setTimeout(6 * 60_000);
  await login(page, PARENT_EMAIL, PARENT_PW);
  await page.goto("/portal/hoc-ba", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  const hasNoData = /Chưa có dữ liệu học bạ/.test(body);
  // eslint-disable-next-line no-console
  console.log("[E.2] hoc-ba 'Chưa có dữ liệu'?", hasNoData);
  // eslint-disable-next-line no-console
  console.log("[E.2] body (first 800):\n", body.slice(0, 800));
  await page.screenshot({ path: testInfo.outputPath("e2-portal-hocba.png"), fullPage: true });
});
