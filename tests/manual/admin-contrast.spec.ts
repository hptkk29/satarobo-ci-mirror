/**
 * Đo tương phản chữ (WCAG AA) trên site QUẢN TRỊ.
 *   corepack pnpm@11 exec playwright test -c playwright.manual.config.ts admin-contrast
 *
 * Admin KHÔNG có chế độ Tối (0 lớp `dark:` trong app/(admin)) nên chỉ một lượt đo.
 * Tài khoản: seed cục bộ prisma/seed-test-admin.ts.
 */
import { test } from "@playwright/test";
import { login as sharedLogin } from "../e2e/_helpers/auth";
import { AUDIT, type ChoTruot } from "./_contrast";

const ROUTES = [
  "/admin/dashboard",
  "/admin/leads",
  "/admin/students",
  "/admin/classes",
  "/admin/to-chuc",
  "/admin/enrollments",
  "/admin/chuyen-lop",
  "/admin/media",
  "/admin/courses",
  "/admin/hoc-ba",
  "/admin/audit-log",
  "/admin/user-groups",
  "/admin/nhan-su",
  "/admin/cau-hinh-van-hanh",
  "/admin/trials",
  "/admin/parent-requests",
  // trang mới theo nhánh test (P2 · US-08/09) — chưa từng qua máy đo
  "/admin/nhan-su/vi-tri",
];

test("tuong phan site quan tri", async ({ page }) => {
  test.setTimeout(25 * 60_000);
  await sharedLogin(page, {
    email: process.env.ADMIN_EMAIL ?? "admin.local@satarobo.vn",
    password: process.env.ADMIN_PW ?? "Test@1234",
    timeout: 120_000,
  });
  let total = 0;
  for (const r of ROUTES) {
    await page.goto(r, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const bad = (await page.evaluate(`(${AUDIT})()`)) as ChoTruot[];
    if (bad.length) {
      console.log("== " + r);
      for (const b of bad)
        console.log(
          `   ${b.ty}:1 (can ${b.can}) ${b.co}px  "${b.chu}"  ${b.mau} tren ${b.nen}  [${b.cls}]`,
        );
      total += bad.length;
    }
  }
  console.log("TONG CHO TRUOT AA (admin):", total);
});
