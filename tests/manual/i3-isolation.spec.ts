/**
 * Manual I.3 — cách ly cơ sở (scopedDb). Login QL CS1 → KHÔNG được thấy data CS2.
 *   CS1_EMAIL=test-cs1@example.com CS1_PW='Test@1234!' \
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts i3-isolation
 */
import { test, type Page } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";

const CS1_EMAIL = process.env.CS1_EMAIL ?? "test-cs1@example.com";
const CS1_PW = process.env.CS1_PW ?? "Test@1234!";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "test-admin@example.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Test@1234!";

// Dấu hiệu data CS2 (KHÔNG được xuất hiện với QL CS1):
const CS2_CLASS = "CS2.SATA1.26.001";
const CS2_CLASS_NAME = "__TEST__ Lớp Convert CS2";
const BE_A = "CS2-26-K9J7X8";
const BE_B = "CS2-26-2F55FQ";

async function login(page: Page, email: string, pw: string) {
  await sharedLogin(page, { email, password: pw, timeout: 120_000 });
}

test("I.3 QL CS1 không thấy data CS2", async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000);
  await login(page, CS1_EMAIL, CS1_PW);
  // eslint-disable-next-line no-console
  console.log("[I.3] sau login URL:", page.url());

  for (const route of ["/admin/classes", "/admin/enrollments", "/admin/payments"]) {
    const resp = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    const http = resp?.status() ?? 0;
    const onLogin = /\/login(\?|$)/.test(page.url());
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    const leak = {
      cs2Class: body.includes(CS2_CLASS) || body.includes(CS2_CLASS_NAME),
      beA: body.includes(BE_A) || body.includes("__TEST__ Bé A"),
      beB: body.includes(BE_B) || body.includes("__TEST__ Bé B"),
    };
    const anyLeak = leak.cs2Class || leak.beA || leak.beB;
    // eslint-disable-next-line no-console
    console.log(`[I.3] ${route} :: http=${http} onLogin=${onLogin} LEAK(CS2)=${JSON.stringify(leak)} => ${anyLeak ? "FAIL(lộ CS2)" : "OK(không lộ)"}`);
    const safe = route.replace(/\//g, "_");
    await page.screenshot({ path: testInfo.outputPath(`i3${safe}.png`), fullPage: true }).catch(() => {});
  }
});

test("I.3-guard SUPER_ADMIN vẫn thấy enrollment CS2 (không over-restrict)", async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await login(page, ADMIN_EMAIL, ADMIN_PW);
  await page.goto("/admin/enrollments?status=all", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  const body = (await page.locator("body").innerText().catch(() => "")) || "";
  const sees = { beA: body.includes("__TEST__ Bé A"), beB: body.includes("__TEST__ Bé B") };
  // eslint-disable-next-line no-console
  console.log(`[I.3-guard] SUPER_ADMIN thấy enrollment CS2: ${JSON.stringify(sees)} => ${sees.beA && sees.beB ? "OK(thấy)" : "FAIL(bị ẩn nhầm)"}`);
});
