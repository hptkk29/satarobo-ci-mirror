import { test, expect } from "@playwright/test";

/**
 * Smoke tests — kiểm tra các trang chính render được + form lead submit OK.
 * Mục tiêu: phát hiện regression nghiêm trọng (build hỏng, route 500, JS crash).
 * Không test logic chi tiết — đó là việc của unit tests.
 */

test.describe("Public site", () => {
  test("homepage renders với header + footer", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Sata Robo/i);
    // Header có logo
    await expect(page.getByRole("banner")).toBeVisible();
    // Footer có thông tin công ty
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });

  test("trang khoá học load không lỗi", async ({ page }) => {
    await page.goto("/khoa-hoc");
    // Không 404
    await expect(page).not.toHaveURL(/404/);
    await expect(page.locator("main")).toBeVisible();
  });

  test("trang vinh danh load", async ({ page }) => {
    await page.goto("/vinh-danh");
    await expect(page.locator("main")).toBeVisible();
  });

  test("trang tin tức load", async ({ page }) => {
    await page.goto("/tin-tuc");
    await expect(page.locator("main")).toBeVisible();
  });

  test("trang liên hệ có form", async ({ page }) => {
    await page.goto("/lien-he");
    await expect(page.locator("form")).toBeVisible();
  });

  test("trang quyền riêng tư load", async ({ page }) => {
    await page.goto("/quyen-rieng-tu");
    await expect(page.getByRole("heading", { name: /quyền riêng tư/i })).toBeVisible();
  });
});

test.describe("Auth gate", () => {
  test("/admin/* redirect to /login khi chưa đăng nhập", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("/login page load với form", async ({ page }) => {
    await page.goto("/login");
    // P3: ô định danh nhận cả SĐT lẫn email (type="text", id="identifier").
    await expect(page.getByLabel("Số điện thoại hoặc Email")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});

test.describe("Cookie consent", () => {
  test("banner xuất hiện cho new visitor", async ({ page, context }) => {
    // Clear storage to simulate first visit
    await context.clearCookies();
    await page.goto("/");
    // Banner có delay 800ms — đợi
    await page.waitForTimeout(1500);
    // Banner có text "Sata Robo sử dụng cookie"
    await expect(page.getByText(/Sata Robo sử dụng cookie/i)).toBeVisible();
  });

  test("chấp nhận tất cả ẩn banner", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/");
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /Chấp nhận tất cả/i }).click();
    // Banner phải biến mất
    await expect(page.getByText(/Sata Robo sử dụng cookie/i)).not.toBeVisible();
  });
});

test.describe("API health", () => {
  test("/api/leads POST rate limit", async ({ request }) => {
    // Payload phải pass leadCreateSchema để vượt qua validation gate
    // (parentName ≥2, phone match VN regex, source ≥1, eventId ≥8,
    // timeOnPage ≥3, dongYChinhSachBaoMat === true). Spam 7 requests — RATE_LIMIT_MAX = 5/phút →
    // ít nhất 1 request trả 429.
    //
    // Lưu ý: ~5 request đầu sẽ tạo lead thật trong DB với source
    // "e2e-smoke-rate-limit" — query DELETE nếu cần dọn dẹp.
    const payload = {
      parentName: "E2E Test",
      phone: "0912345678",
      source: "e2e-smoke-rate-limit",
      eventId: "e2e-smoke-event-id",
      consentMarketing: false,
      // Hồ sơ BCT mục 3 — cổng server là `z.literal(true)`; thiếu trường này thì mọi
      // request trả 400 và ca rate-limit không bao giờ chạm tới nhánh 429.
      dongYChinhSachBaoMat: true,
      timeOnPage: 10,
    };
    const responses = await Promise.all(
      Array.from({ length: 7 }).map(() =>
        request.post("/api/leads", { data: payload }),
      ),
    );
    const statuses = responses.map((r) => r.status());
    const tooMany = statuses.filter((s) => s === 429);
    // Ít nhất 1 request bị 429
    expect(tooMany.length).toBeGreaterThan(0);
  });
});
