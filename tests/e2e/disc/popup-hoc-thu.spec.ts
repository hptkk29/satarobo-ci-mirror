/**
 * [DISC-E2E-POP-01] Popup mời học thử 1-1 (modal z-110, bật sau 20s) từng chặn bấm giữa bài làm DISC
 * (đo 02/11/2026: `popup-hoc-thu-title intercepts pointer events` ở nút "Tiếp"/"Lưu"). Nay loại trừ /disc, /portal, /kich-hoat.
 * Ghim cũ test.fail() đã GỠ (không skip). Có đối chứng dương: trang chủ/public vẫn bật popup.
 * [DISC-E2E-CK-01] Banner cookie (fixed, z-70) không được che nút cuối /kich-hoat?disc=1 (320x640, 390x844).
 * [DISC-E2E-CK-02] CTA cuối drawer menu mobile không bị banner che (4 khung mobile).
 * Đồng hồ giả (page.clock) nên không phải chờ 20s thật.
 */
import { expect, test, type Page } from "@playwright/test";
import { CO_DISC } from "./_khung";

test.skip(CO_DISC !== "on", "Cần DISC_E2E_FLAG=on (cờ BẬT)");

const POPUP = '[aria-labelledby="popup-hoc-thu-title"]';

async function daCookie(context: import("@playwright/test").BrowserContext) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("satarobo:consent:v1", JSON.stringify({ version: "2026-05-17", acceptedAt: new Date().toISOString(), categories: { necessary: true, analytics: false, marketing: false } }));
    } catch {
      /* bỏ qua */
    }
  });
}

async function chayDongHo(page: Page) {
  await page.waitForTimeout(300);
  await page.clock.runFor(21_000);
  await page.waitForTimeout(500);
}

test("[DISC-E2E-POP-01] popup học thử KHÔNG hiện trên trang làm bài DISC", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.77" });
  await daCookie(context);
  await page.clock.install({ time: new Date("2026-11-02T03:00:00Z") }); // trong cửa sổ chương trình
  await page.goto("/disc/bat-dau");
  await expect(page.getByTestId("disc-ho-so")).toBeVisible();
  await chayDongHo(page);
  await expect(page.locator(POPUP)).toHaveCount(0);
});

test("[DISC-E2E-POP-02] đối chứng dương: popup vẫn hiện ở trang public khác", async ({ page, context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.78" });
  await daCookie(context);
  await page.clock.install({ time: new Date("2026-11-02T03:00:00Z") });
  await page.goto("/chinh-sach-bao-mat");
  await chayDongHo(page);
  await expect(page.locator(POPUP)).toHaveCount(1);
});

for (const v of [{ w: 320, h: 640 }, { w: 390, h: 844 }]) {
  test(`[DISC-E2E-CK-01] banner cookie không che nút 'Gửi mã xác minh' ${v.w}x${v.h}`, async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${80 + (v.w % 7)}` });
    await page.setViewportSize({ width: v.w, height: v.h });
    await page.goto("/kich-hoat?disc=1");
    const banner = page.getByTestId("cookie-consent");
    await expect(banner).toBeVisible({ timeout: 5000 }); // đối chứng dương: banner THẬT đang hiện
    const nut = page.getByRole("button", { name: /gửi mã/i }).first();
    // Người dùng kéo hết cỡ xuống đáy: nút phải LỘ ra trên banner (scrollIntoViewIfNeeded không đủ — nút "đã trong viewport" dù bị banner phủ).
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    const b = await nut.boundingBox();
    const k = await banner.boundingBox();
    expect(b && k).toBeTruthy();
    expect(b!.y + b!.height, "đáy nút phải nằm trên đỉnh banner").toBeLessThanOrEqual(k!.y + 1);
    await nut.click({ trial: true }); // Playwright ném nếu bị phần tử khác chặn
  });
}

for (const v of [{ w: 320, h: 640 }, { w: 375, h: 812 }, { w: 390, h: 844 }, { w: 414, h: 896 }]) {
  test(`[DISC-E2E-CK-02] CTA cuối drawer menu không bị banner che ${v.w}x${v.h}`, async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${90 + (v.w % 7)}` });
    await page.setViewportSize({ width: v.w, height: v.h });
    await page.goto("/chinh-sach-bao-mat");
    await expect(page.getByTestId("cookie-consent")).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: /mở menu|menu/i }).first().click();
    const drawer = page.getByRole("dialog", { name: "Menu điều hướng" });
    await expect(drawer).toBeVisible();
    const cta = drawer.locator("a,button").last();
    await cta.scrollIntoViewIfNeeded();
    await cta.click({ trial: true }); // ném nếu banner (hoặc thứ gì) chặn
  });
}
