/**
 * Manual — verify cách ly cơ sở sau multi-agent fix các trang admin nghiệp vụ.
 * CS1 manager KHÔNG được thấy data CS2; SUPER_ADMIN VẪN thấy (không over-restrict).
 *   CS1_EMAIL=test-cs1@example.com CS1_PW='Test@1234!' \
 *   ADMIN_EMAIL=test-admin@example.com ADMIN_PW='Test@1234!' \
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts i3-admin-isolation
 */
import { test, type Page } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";

const CS1_EMAIL = process.env.CS1_EMAIL ?? "test-cs1@example.com";
const CS1_PW = process.env.CS1_PW ?? "Test@1234!";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "test-admin@example.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Test@1234!";

async function login(page: Page, email: string, pw: string) {
  await sharedLogin(page, { email, password: pw, timeout: 120_000 });
}

// Trang fixed + marker data CS2 (nếu có) để kiểm rò rỉ.
const ROUTES: { route: string; cs2Marker?: string }[] = [
  { route: "/admin/leads", cs2Marker: "__TEST__ PH Convert" },
  { route: "/admin/students", cs2Marker: "__TEST__ Bé A" },
  { route: "/admin/sessions", cs2Marker: "__TEST__ Buổi 1" },
  { route: "/admin/trials" },
  { route: "/admin/trial-classes" },
  { route: "/admin/cham-soc-hv" },
  { route: "/admin/hoc-bu" },
  { route: "/admin/satacoin" },
  { route: "/admin/notifications" },
  { route: "/admin/khao-sat" },
  { route: "/admin/ban-giao-lead" },
  { route: "/admin/chuyen-lop" },
  { route: "/admin/attendance" },
  { route: "/admin/media" },
];

test("CS1 manager KHÔNG thấy data CS2 + mọi trang render", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await login(page, CS1_EMAIL, CS1_PW);
  for (const { route, cs2Marker } of ROUTES) {
    const resp = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const http = resp?.status() ?? 0;
    const onLogin = /\/login(\?|$)/.test(page.url());
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    const err = /Application error|Unhandled Runtime Error|something went wrong/i.test(body);
    const leak = cs2Marker ? body.includes(cs2Marker) : false;
    // eslint-disable-next-line no-console
    console.log(`[CS1] ${route} :: http=${http} render=${!err && !onLogin} leakCS2=${cs2Marker ? leak : "n/a"} ${leak ? "<<< LEAK" : ""}`);
  }
});

test("SUPER_ADMIN guard VẪN thấy data CS2 (không over-restrict)", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await login(page, ADMIN_EMAIL, ADMIN_PW);
  const guards = [
    { route: "/admin/leads", marker: "__TEST__ PH Convert" },
    { route: "/admin/students", marker: "__TEST__ Bé A" },
    { route: "/admin/sessions", marker: "__TEST__ Buổi 1" },
  ];
  for (const { route, marker } of guards) {
    await page.goto(route, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    // eslint-disable-next-line no-console
    console.log(`[ADMIN] ${route} :: thấy '${marker}'=${body.includes(marker)} ${body.includes(marker) ? "OK" : "<<< bị ẩn nhầm"}`);
  }
});
