/**
 * Manual LMS sweep — tiếp nối phiên R7-LMS-test-session-record.
 * Đăng nhập admin (__TEST__ admin) rồi load từng route P1/P2, assert không bị
 * đẩy về /login, không có error boundary, chụp screenshot làm bằng chứng.
 *
 * Chạy (server dev :3000 đã chạy):
 *   ADMIN_EMAIL=test-admin@example.com ADMIN_PW='Test@1234!' \
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts lms-r7-sweep
 */
import { test, type Page } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "test-admin@example.com";
const ADMIN_PW = process.env.ADMIN_PW ?? "Test@1234!";

async function login(page: Page) {
  await sharedLogin(page, { email: ADMIN_EMAIL, password: ADMIN_PW, timeout: 120_000 });
}

// Các route admin theo Phase trong prompt (P1 + một phần P2).
const ROUTES: string[] = [
  // Phase A — CRM
  "/admin/leads",
  "/admin/trial-classes",
  "/admin/convert-conflicts",
  "/admin/ban-giao-lead",
  "/admin/cham-soc-hv",
  // Phase B — Lớp/khoá
  "/admin/classes",
  "/admin/class-groups",
  "/admin/curriculums",
  "/admin/courses",
  "/admin/course-packages",
  "/admin/course-prerequisites",
  "/admin/rooms",
  "/admin/enrollments",
  "/admin/chuyen-lop",
  // Phase C — Buổi & điểm danh
  "/admin/sessions",
  "/admin/attendance",
  // Phase D — Bài tập & thi
  "/admin/assignments",
  "/admin/exams",
  "/admin/questions",
  // Phase E — Học bạ
  "/admin/report-cards",
  "/admin/report-cards/criteria",
  "/admin/evaluations",
  // Phase F — Tài chính
  "/admin/orders",
  "/admin/payments",
  "/admin/cong-no",
  "/admin/vouchers",
  // Phase H — Báo cáo
  "/admin/bao-cao/lms",
  "/admin/bao-cao/lead",
  "/admin/bao-cao/trial-sale",
  "/admin/bao-cao/dao-tao",
  "/admin/bao-cao/trung-tam",
  "/admin/canh-bao-rui-ro",
  // Phase I — RBAC/Tổ chức
  "/admin/centers",
  "/admin/roles",
  "/admin/users",
  "/admin/audit-log",
  // Phase J — NĐ13
  "/admin/compliance",
];

test("admin sweep P1/P2 routes", async ({ page }, testInfo) => {
  test.setTimeout(20 * 60_000);
  await login(page);

  const results: { route: string; status: string; note: string }[] = [];
  for (const route of ROUTES) {
    // `note` được gán lại ở mọi nhánh — bỏ giá trị mồi vô dụng.
    let status = "PASS";
    let note: string;
    try {
      const resp = await page.goto(route, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      const url = page.url();
      const http = resp?.status() ?? 0;
      if (/\/login(\?|$)/.test(url)) {
        status = "FAIL";
        note = "redirected to /login";
      } else if (http >= 500) {
        status = "FAIL";
        note = `HTTP ${http}`;
      } else {
        // bắt error boundary / next error overlay
        const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
        if (/Application error|Unhandled Runtime Error|Internal Server Error|something went wrong/i.test(bodyText)) {
          status = "FAIL";
          note = "error boundary text";
        } else if (http === 404 || /404|Không tìm thấy trang/i.test(bodyText.slice(0, 400))) {
          status = "FLAG";
          note = `404 (http ${http})`;
        } else {
          note = `http ${http}`;
        }
      }
      const safe = route.replace(/\//g, "_");
      await page.screenshot({ path: testInfo.outputPath(`route${safe}.png`), fullPage: true }).catch(() => {});
    } catch (e) {
      status = "FAIL";
      note = String(e).slice(0, 120);
    }
    results.push({ route, status, note });
    // eslint-disable-next-line no-console
    console.log(`[${status}] ${route} — ${note}`);
  }

  // in bảng tổng kết
  const fails = results.filter((r) => r.status === "FAIL");
  const flags = results.filter((r) => r.status === "FLAG");
  // eslint-disable-next-line no-console
  console.log("\n=== SWEEP SUMMARY ===");
  // eslint-disable-next-line no-console
  console.log(`PASS=${results.length - fails.length - flags.length} FLAG=${flags.length} FAIL=${fails.length}`);
  for (const r of [...fails, ...flags]) console.log(`  ${r.status} ${r.route} :: ${r.note}`);
});
