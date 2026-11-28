/**
 * Manual — render smoke sau batch fix cách ly: test-admin load các trang đã đụng,
 * bắt 500/crash (do edit scopedDb). 404 (notFound) = chấp nhận.
 *   ADMIN_EMAIL=test-admin@example.com ADMIN_PW='Test@1234!' \
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts admin-render-smoke
 */
import { test, expect, type Page } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "test-admin@example.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Test@1234!";

const CLASS = "cmqkkdp5a00fzr3o71w460hob";
const LEAD = "cmqkflvjj003yr3o7gwyndp1o";
const ENR = "cmqkn73gr003o1pmct0iinmr2";
const SESSION = "cmqksqaz600hk1pmciuolk6u4";
const STUDENT = "cmqkn73ax003m1pmcrbn81kvn";
const CLASSGROUP = "cmpxsuoq20009124lrdqrjjlc";
const EMPLOYEE = "cmpjsrm5z00018ke0f0v6z6xd";

const ROUTES = [
  "/admin/assignments", "/admin/assignments/new",
  "/admin/bao-cao/dao-tao", "/admin/bao-cao/lead", "/admin/bao-cao/trial-sale", "/admin/bao-cao/trung-tam",
  "/admin/canh-bao-rui-ro", "/admin/cham-cong/lich-ca", "/admin/class-groups",
  "/admin/classes/new", "/admin/crm", "/admin/enrollments/new", "/admin/exams", "/admin/exams/new",
  "/admin/hoan-thanh-khoa", "/admin/hoc-ba", "/admin/holidays", "/admin/leads/bao-cao-chuyen",
  "/admin/marketing", "/admin/parent-requests", "/admin/report-cards", "/admin/rooms",
  "/admin/sessions/new", "/admin/trial-classes/new",
  `/admin/class-groups/${CLASSGROUP}`, `/admin/class-groups/${CLASSGROUP}/edit`,
  `/admin/classes/${CLASS}/edit`, `/admin/classes/${CLASS}/progress`, `/admin/classes/${CLASS}/students`,
  `/admin/enrollments/${ENR}/edit`,
  `/admin/leads/${LEAD}`, `/admin/leads/${LEAD}/edit`, `/admin/leads/${LEAD}/convert`,
  `/admin/nhan-su/${EMPLOYEE}/schedule`,
  `/admin/sessions/${SESSION}`, `/admin/sessions/${SESSION}/edit`,
  `/admin/students/${STUDENT}/edit`,
];

async function login(page: Page) {
  await sharedLogin(page, { email: ADMIN_EMAIL, password: ADMIN_PW, timeout: 120_000 });
}

test("render smoke admin pages (no 500/crash)", async ({ page }) => {
  test.setTimeout(25 * 60_000);
  await login(page);
  const bad: string[] = [];
  for (const r of ROUTES) {
    // `no-useless-assignment`: mọi nhánh dưới đều gán lại, giá trị mồi là vô dụng.
    let status: string;
    try {
      const resp = await page.goto(r, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const http = resp?.status() ?? 0;
      const body = (await page.locator("body").innerText().catch(() => "")) || "";
      const err = /Application error|Unhandled Runtime Error|Internal Server Error/i.test(body);
      if (http >= 500 || err) { status = `BAD http=${http} err=${err}`; bad.push(`${r} :: ${status}`); }
      else status = `http=${http}`;
    } catch (e) { status = `THROW ${String(e).slice(0, 80)}`; bad.push(`${r} :: ${status}`); }
    // eslint-disable-next-line no-console
    console.log(`[smoke] ${r} :: ${status}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\n[smoke] BAD=${bad.length}${bad.length ? "\n" + bad.join("\n") : ""}`);
  expect(bad, `trang lỗi render: ${bad.join(", ")}`).toHaveLength(0);
});
