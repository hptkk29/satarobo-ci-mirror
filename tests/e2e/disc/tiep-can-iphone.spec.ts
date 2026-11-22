/**
 * [DISC-E2E-TC-06] iPhone (WebKit): hành trình tới thành công rồi tải PDF ra tệp %PDF thật ở thiết bị di động.
 * Tệp riêng vì `browserName` chỉ đặt được ở cấp tệp (đổi trình duyệt = worker mới).
 */
import fs from "node:fs";
import path from "node:path";
import { devices, expect, test } from "@playwright/test";
import { CO_DISC, tranNgangPx } from "./_khung";
import { ANH, chup, dienHoSo, lamBoDe, sdtMoi } from "./_nhap-lieu";

test.skip(CO_DISC !== "on", "Cần DISC_E2E_FLAG=on (cờ BẬT)");
test.use({ ...devices["iPhone 13"], browserName: "webkit" });

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${200 + Math.floor(Math.random() * 50)}` });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("satarobo:consent:v1", JSON.stringify({ version: "2026-05-17", acceptedAt: new Date().toISOString(), categories: { necessary: true, analytics: false, marketing: false } }));
    } catch {
      /* bỏ qua */
    }
    // Popup mời học thử (z-110, bật sau 20s ở MỌI trang public, kể cả /disc) chặn bấm giữa bài — ghi nhận ở 09-uat-evidence; ở đây đóng sẵn để đo đúng thứ cần đo.
    try {
      localStorage.setItem("satarobo-popup-hoc-thu-da-gui", "1");
    } catch {
      /* bỏ qua */
    }
  });
});

test("[DISC-E2E-TC-06] iPhone WebKit: tới thành công, tải PDF ra tệp %PDF thật", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/disc/bat-dau");
  await dienHoSo(page);
  await page.getByTestId("disc-ho-so-tiep").click();
  await lamBoDe(page);
  await lamBoDe(page);
  await expect(page.getByTestId("disc-hoan-thanh")).toBeVisible();
  await page.getByLabel(/Số điện thoại/).fill(sdtMoi());
  await page.getByRole("checkbox").first().check();
  await page.getByTestId("disc-luu-gui").click();
  await expect(page.getByTestId("disc-thanh-cong")).toBeVisible({ timeout: 25_000 });
  expect(await tranNgangPx(page)).toBeLessThanOrEqual(1);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByTestId("disc-tai-pdf").click()]);
  fs.mkdirSync(ANH, { recursive: true });
  const file = path.join(ANH, "ket-qua-iphone-webkit.pdf");
  await dl.saveAs(file);
  const bytes = fs.readFileSync(file);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(3_000);
  await chup(page, "tc06-iphone-thanh-cong");
});
