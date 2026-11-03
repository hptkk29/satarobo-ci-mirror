/**
 * Manual — batch 2 cách ly: CS1 manager mở record CS2 theo id (IDOR) phải bị chặn,
 * và trang list không lộ data CS2. SUPER_ADMIN guard vẫn xem được.
 *   CS1_EMAIL=test-cs1@example.com CS1_PW='Test@1234!' \
 *   ADMIN_EMAIL=test-admin@example.com ADMIN_PW='Test@1234!' \
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts i3-batch2
 */
import { test, type Page } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";

const CS1_EMAIL = process.env.CS1_EMAIL ?? "test-cs1@example.com";
const CS1_PW = process.env.CS1_PW ?? "Test@1234!";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "test-admin@example.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Test@1234!";

const CLASS = "cmqkkdp5a00fzr3o71w460hob";
const LEAD = "cmqkflvjj003yr3o7gwyndp1o";
const SESSION = "cmqksqaz600hk1pmciuolk6u4";
const STUDENT = "cmqkn73ax003m1pmcrbn81kvn";

// route CS2 + marker data CS2 phải KHÔNG xuất hiện với CS1.
const CHECKS = [
  { route: `/admin/leads/${LEAD}`, marker: "__TEST__ PH Convert", kind: "IDOR lead" },
  { route: `/admin/classes/${CLASS}/progress`, marker: "__TEST__ Lớp Convert CS2", kind: "IDOR class" },
  { route: `/admin/sessions/${SESSION}/edit`, marker: "__TEST__ Buổi 1", kind: "IDOR session" },
  { route: `/admin/students/${STUDENT}/edit`, marker: "__TEST__ Bé A", kind: "IDOR student" },
  { route: `/admin/hoc-ba`, marker: "__TEST__ Bé A", kind: "list hoc-ba" },
];

async function login(page: Page, email: string, pw: string) {
  await sharedLogin(page, { email, password: pw, timeout: 120_000 });
}

test("CS1 KHÔNG truy cập record/list CS2 (batch 2)", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await login(page, CS1_EMAIL, CS1_PW);
  for (const { route, marker, kind } of CHECKS) {
    const resp = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const http = resp?.status() ?? 0;
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    const leak = body.includes(marker);
    // eslint-disable-next-line no-console
    console.log(`[CS1] ${kind} ${route} :: http=${http} leak=${leak} ${leak ? "<<< LEAK CS2" : "OK(chặn)"}`);
  }
});

test("SUPER_ADMIN guard batch2 vẫn xem được", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await login(page, ADMIN_EMAIL, ADMIN_PW);
  for (const { route, marker, kind } of CHECKS) {
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    // eslint-disable-next-line no-console
    console.log(`[ADMIN] ${kind} ${route} :: thấy='${body.includes(marker)}' ${body.includes(marker) ? "OK" : "<<< ẩn nhầm?"}`);
  }
});
