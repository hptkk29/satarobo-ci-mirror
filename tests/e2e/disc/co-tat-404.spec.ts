/**
 * [DISC-E2E-OFF-*] Cờ TẮT (chạy với DISC_E2E_FLAG=off): không lối vào nào hiện ra, mọi route DISC trả 404.
 * Đây là ca "sự vắng mặt" — nên mỗi ca có ĐỐI CHỨNG DƯƠNG ở spec dieu-huong.spec.ts (cùng selector, cờ BẬT ⇒ thấy)
 * để không xanh giả khi tính năng hỏng hoàn toàn (CLAUDE.md luật 11).
 */
import { expect, test } from "@playwright/test";
import { CO_DISC, KHUNG_NHIN, LA_DESKTOP, TRANG_NHE, moDrawer } from "./_khung";

test.skip(CO_DISC !== "off", "Cần DISC_E2E_FLAG=off (cờ TẮT)");

const TRANG_DISC = ["/disc", "/disc/bat-dau"];

test.describe("[DISC-E2E-OFF-404] route trang", () => {
  for (const duong of TRANG_DISC) {
    test(`GET ${duong} ⇒ 404`, async ({ page }) => {
      const res = await page.goto(duong);
      expect(res?.status()).toBe(404);
    });
  }
});

test.describe("[DISC-E2E-OFF-API] route API (không DB, không OTP, không email: cổng cờ đứng trước mọi việc)", () => {
  test("POST /api/disc/luu ⇒ 404, thân rỗng, kể cả khi body hợp lệ lẫn rác", async ({ request }) => {
    for (const data of [{}, { idempotencyKey: "x".repeat(20), soDienThoai: "0900000000" }]) {
      const r = await request.post("/api/disc/luu", { data });
      expect(r.status()).toBe(404);
      expect((await r.text()).length).toBeLessThan(400); // không lộ cấu trúc API / lỗi nội bộ
    }
  });
  test("POST /api/disc/tai ⇒ 404; GET ⇒ 405 (F-11: route không còn export GET — token không đi trong URL)", async ({ request }) => {
    // GET ra 405 của Next VÌ KHÔNG CÓ handler, giống hệt khi cờ BẬT ⇒ không phải oracle về trạng thái cờ. Nếu ai thêm lại GET, ca này đỏ.
    expect((await request.get("/api/disc/tai?token=khong-co")).status()).toBe(405);
    expect((await request.post("/api/disc/tai", { data: { token: "khong-co" } })).status()).toBe(404);
  });
  test("không rate-limit/đếm nào bị chạm: 15 lượt liên tiếp vẫn 404 (không chuyển sang 429)", async ({ request }) => {
    for (let i = 0; i < 15; i++) expect((await request.post("/api/disc/luu", { data: {} })).status()).toBe(404);
  });
});

for (const kn of [KHUNG_NHIN[0], KHUNG_NHIN[1], KHUNG_NHIN[6], KHUNG_NHIN[10], KHUNG_NHIN[11]]) {
  test.describe(`[DISC-E2E-OFF-NAV] ${kn.w}x${kn.h}`, () => {
    test.use({ viewport: { width: kn.w, height: kn.h } });
    test("không có mục menu / nút nổi / liên kết /disc nào trên trang public", async ({ page }) => {
      await page.goto(TRANG_NHE);
      if (!LA_DESKTOP(kn.w)) {
        await moDrawer(page); // đối chứng: drawer MỞ được (nếu không mở được thì ca "không có mục DISC" xanh vì drawer chưa từng hiện)
      }
      await expect(page.getByText("Khám phá DISC")).toHaveCount(0);
      await expect(page.getByTestId("disc-floating")).toHaveCount(0);
      await expect(page.getByTestId("disc-floating-mobile")).toHaveCount(0);
      await expect(page.locator('a[href="/disc"]')).toHaveCount(0);
      // Đối chứng dương: trang vẫn có nút nổi cũ (cờ tắt không được làm mất Zalo).
      if (LA_DESKTOP(kn.w)) await expect(page.getByRole("link", { name: "Chat Zalo Sata Robo" })).toBeVisible(); // nút nổi (chân trang cũng có link "Chat Zalo (…)" ⇒ phải chỉ đúng nút nổi, tránh strict-mode)
    });
  });
}

test("[DISC-E2E-OFF-SEO] /disc không nằm trong sitemap khi cờ tắt", async ({ request }) => {
  const r = await request.get("/sitemap.xml");
  if (r.status() !== 200) test.skip(true, "Không có /sitemap.xml ở môi trường này");
  expect(await r.text()).not.toMatch(/\/disc\b/);
});
