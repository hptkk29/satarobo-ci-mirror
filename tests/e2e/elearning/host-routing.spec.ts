/**
 * EL-01 PR2 · AC1–AC4 — định tuyến host thứ 6 ở tầng CHẠY THẬT.
 *
 * Khác `route-policy.test.ts` (thuần, không server): bài này kiểm cả chuỗi
 * middleware → layout RSC → render, tức bắt được những thứ đơn vị test không thấy:
 * rewrite có ra đúng route group không, layout gate có chặn không, và cờ có thật sự
 * được đọc ở tiến trình server không.
 *
 * Cấu hình bơm `ELEARNING_ENABLED=true` cho webServer (playwright.elearning.config.ts).
 * Trên localhost không có subdomain nên đi path thật `/elearning/*` — nhánh BRANCH 3
 * của proxy.ts, đối xứng với site giáo viên.
 */
import { test, expect } from "@playwright/test";

test.describe("[EL-01] khu đào tạo nội bộ — định tuyến và cổng vào", () => {
  test("chưa đăng nhập → đá về /login kèm callbackUrl", async ({ page }) => {
    await page.goto("/elearning");
    await expect(page).toHaveURL(/\/login/);
    expect(page.url()).toContain("callbackUrl");
  });

  test("trang /login vẫn phục vụ bình thường (không bị rewrite nuốt)", async ({ page }) => {
    const res = await page.goto("/login");
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator("form")).toBeVisible();
  });

  test("khách vãng lai KHÔNG nhận được một byte nội dung nào của khu nội bộ", async ({
    page,
  }) => {
    const res = await page.goto("/elearning");
    // `page.goto` ĐI THEO redirect, nên `res` ở đây là trang `/login` chứ không phải
    // trang e-learning. Bản đầu của bài này quên điều đó và đi đòi `noindex` trên
    // chính trang login — đỏ vì lý do sai, và tệ hơn: nó KHÔNG kiểm gì về e-learning.
    //
    // Điều kiểm được (và đáng kiểm) khi chưa đăng nhập là: chặng cuối là `/login`, và
    // HTML trả về không mang theo mẩu nội dung nào của khu nội bộ.
    expect(page.url()).toContain("/login");
    const html = await page.content();
    expect(html).not.toContain("Học tập nội bộ");

    // `noindex` của khu nội bộ khai ở `app/(elearning)/elearning/layout.tsx`
    // (`metadata.robots`) nên chỉ thấy được khi ĐÃ đăng nhập — kiểm ở
    // `employee-gate.spec.ts` cùng nhóm case cần phiên thật.
  });
});
