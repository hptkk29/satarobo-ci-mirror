/**
 * [DISC-E2E-NAV-*] Điều hướng "Khám phá DISC" khi cờ BẬT (chạy với DISC_E2E_FLAG=on):
 * header desktop, drawer mobile, nút nổi, landing /disc — ở 11 khung nhìn từ 320 tới 3840.
 *
 * Kiểm bằng thứ người dùng thấy: phần tử HIỆN, bấm tới được, không tràn ngang, nút nổi không che
 * Zalo/học thử/thanh dính mobile. Chưa chạy ở đợt 1 (cần dev server + Chromium) — xem 09-uat-evidence.md.
 */
import { expect, test } from "@playwright/test";
import { CO_DISC, KHUNG_NHIN, LA_DESKTOP, TRANG_NHE, giaoNhau, hop, moDrawer, tranNgangPx } from "./_khung";

test.skip(CO_DISC !== "on", "Cần DISC_E2E_FLAG=on (cờ BẬT)");

for (const kn of KHUNG_NHIN) {
  test.describe(`[DISC-E2E-NAV] ${kn.w}x${kn.h}`, () => {
    test.use({ viewport: { width: kn.w, height: kn.h } });

    test("lối vào DISC có mặt đúng chỗ theo bố cục và dẫn tới /disc", async ({ page }) => {
      await page.goto(TRANG_NHE);
      // Từ 10/11/2026 DISC đứng trong nhóm «Góc gia đình» (cùng Tủ sách · Sức khỏe) khi có ≥ 2 mục bật; chỉ MỘT mục bật (môi trường
      // e2e thường chỉ bật DISC) thì nó hiện thẳng như liên kết thường. Ca này chấp nhận cả hai hình — thứ cần chứng minh là
      // «lối vào DISC có mặt, đúng đích, đứng ngay trước Liên hệ».
      if (LA_DESKTOP(kn.w)) {
        const nutNhom = page.getByTestId("goc-header");
        const coNhom = (await nutNhom.count()) > 0;
        const nhan = await page.locator(".nav-links > a, .nav-links > .nav-goc > button").allInnerTexts();
        const i = nhan.findIndex((t) => (coNhom ? /Góc gia đình/ : /Khám phá DISC/).test(t));
        expect(i, "không thấy lối vào DISC trên thanh trên").toBeGreaterThanOrEqual(0);
        expect(nhan[i + 1]).toMatch(/Liên hệ/); // ngay TRƯỚC "Liên hệ" (PRD v2.0)
        if (coNhom) {
          await nutNhom.click();
          const muc = page.getByTestId("goc-header-disc");
          await expect(muc).toBeVisible();
          await expect(muc).toHaveAttribute("href", "/disc");
        } else {
          const muc = page.locator("header nav a", { hasText: "Khám phá DISC" });
          await expect(muc).toBeVisible();
          await expect(muc).toHaveAttribute("href", "/disc");
        }
      } else {
        const mucDrawer = (await moDrawer(page)).getByRole("link", { name: /Khám phá DISC/ });
        await expect(mucDrawer).toBeVisible();
        await expect(mucDrawer).toHaveAttribute("href", "/disc");
      }
    });

    test("nút nổi: một nút «Góc gia đình» cho mọi bố cục, nhãn không có 'miễn phí', không che Zalo / học thử / thanh dính", async ({ page }) => {
      await page.goto(TRANG_NHE);
      await page.evaluate(() => window.scrollTo(0, 600)); // thanh đáy .mbar (điện thoại) luôn hiện từ 02/11/2026
      const dang = page.getByTestId("goc-floating");
      await expect(dang).toBeVisible();
      await expect(page.locator('a[href="https://m.me/satarobo"]')).toHaveCount(0); // Messenger đã gỡ 10/11/2026
      // Hai hình: ≥ 2 mục bật ⇒ nút «Góc gia đình» (bấm ra bảng); đúng 1 mục (chỉ DISC) ⇒ viên thuốc liên kết thẳng «Khám phá DISC».
      const laNhom = (await dang.evaluate((e) => e.tagName)) === "BUTTON";
      await expect(dang).toContainText(laNhom ? "Góc gia đình" : "Khám phá DISC");
      await expect(dang).not.toContainText(/miễn phí/i);

      const bDisc = await hop(dang);
      expect(bDisc).not.toBeNull();
      // Nằm gọn trong khung nhìn (không bị cắt mép) — kể cả 320px.
      expect(bDisc!.x).toBeGreaterThanOrEqual(0);
      expect(bDisc!.x + bDisc!.w).toBeLessThanOrEqual(kn.w);
      expect(bDisc!.y).toBeGreaterThanOrEqual(0);
      expect(bDisc!.y + bDisc!.h).toBeLessThanOrEqual(kn.h);

      // Không che các nút khác đang hiện. Chỉ đích danh nút NỔI của Zalo (aria-label) — chân trang cũng có link "Chat Zalo (…)" —
      // và duyệt MỌI phần tử khớp, không chỉ phần tử đầu (đo `.first()` có thể rơi vào bản không phải nút nổi).
      const cacNutKhac = [
        page.locator('a[aria-label="Chat Zalo Sata Robo"]'),
        page.getByRole("link", { name: /đặt học thử miễn phí/i }),
        page.locator("div.mbar"), // thanh đáy điện thoại (thay StickyMobileCta)
      ];
      let soNutDoDuoc = 0;
      for (const l of cacNutKhac) {
        for (const e of await l.all()) {
          if (!(await e.isVisible())) continue;
          const b = await hop(e);
          if (!b) continue;
          soNutDoDuoc += 1;
          expect(giaoNhau(bDisc!, b), `DISC chồng lên ${await e.innerText().catch(() => "?")}`).toBe(false);
        }
      }
      // Đối chứng: ít nhất MỘT nút khác (Zalo nổi ở desktop / thanh dính mobile) thật sự được đo — không đo được gì thì ca xanh vì rỗng.
      expect(soNutDoDuoc).toBeGreaterThan(0);

      // Bảng mở ra cũng phải nằm gọn trong khung nhìn (kể cả 320px) và không che các nút bên dưới nút «Góc gia đình»… ngoài việc che chính nó.
      if (laNhom) {
        await dang.click();
        const bang = page.getByTestId("goc-floating-panel");
        await expect(bang).toBeVisible();
        const bBang = await hop(bang);
        expect(bBang).not.toBeNull();
        expect(bBang!.x).toBeGreaterThanOrEqual(0);
        expect(bBang!.x + bBang!.w).toBeLessThanOrEqual(kn.w);
        expect(bBang!.y).toBeGreaterThanOrEqual(0);
        expect(bBang!.y + bBang!.h).toBeLessThanOrEqual(bDisc!.y + 1); // mở LÊN TRÊN nút, không đè Zalo/học thử bên dưới
        const muc = page.getByTestId("goc-floating-disc");
        await expect(muc).toHaveText("Khám phá DISC");
        await expect(muc).toHaveAttribute("href", "/disc");
        await page.keyboard.press("Escape");
        await expect(bang).toHaveCount(0);
      }
    });

    test("không tràn ngang ở trang có header + nút nổi", async ({ page }) => {
      await page.goto(TRANG_NHE);
      expect(await tranNgangPx(page)).toBe(0);
    });

    test("landing /disc: hiện đủ nội dung chính, nút bắt đầu ở đúng một trạng thái rõ ràng, không tràn ngang", async ({ page }) => {
      const res = await page.goto("/disc");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: /Ba bước/ })).toBeVisible();
      await expect(page.getByText(/không phải chẩn đoán tâm lý/i)).toBeVisible();
      // Engine chưa sẵn sàng ⇒ nút khoá + câu giải thích; engine sẵn ⇒ liên kết /disc/bat-dau. Không được ở giữa.
      const khoa = page.getByRole("button", { name: /Bắt đầu khám phá/ });
      const lienKet = page.getByRole("link", { name: /Bắt đầu khám phá/ });
      const nKhoa = await khoa.count();
      const nLink = await lienKet.count();
      expect(nKhoa + nLink).toBe(1);
      if (nKhoa) {
        await expect(khoa).toBeDisabled();
        await expect(page.getByText(/đang được hoàn thiện/)).toBeVisible();
      } else {
        await expect(lienKet).toHaveAttribute("href", "/disc/bat-dau");
      }
      expect(await tranNgangPx(page)).toBe(0);
    });

    test("/disc: cụm nút nổi ẩn (trang làm bài cần toàn màn hình, nút không tự chỉ vào chính trang), nhưng mục menu vẫn có", async ({ page }) => {
      await page.goto("/disc");
      await expect(page.getByTestId("goc-floating")).toHaveCount(0);
    });
  });
}

test.describe("[DISC-E2E-NAV-REF] mục DISC không phá luồng cũ", () => {
  test("Zalo và 'Đặt buổi học thử' vẫn còn ở desktop khi cờ bật", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(TRANG_NHE);
    await expect(page.getByRole("link", { name: "Chat Zalo Sata Robo" })).toBeVisible();
    await expect(page.getByRole("link", { name: /đặt buổi học thử/i }).first()).toBeVisible();
  });
});

// [DISC-E2E-NAV-CK] Banner cookie (z-70) phủ nút nổi (z-40): trước khi người dùng chọn, viên thuốc DISC mobile nằm DƯỚI banner và không bấm được.
// Đo 01/11/2026 (chưa sửa): 320x640 / 375x812 / 414x896 / 768x1024 — banner phủ tâm viên thuốc ở cả bốn. Sửa ở floating-cta.tsx (nâng nút lên trên mép banner).
for (const kn of [
  { w: 320, h: 640 },
  { w: 375, h: 812 },
  { w: 414, h: 896 },
  { w: 768, h: 1024 },
]) {
  test(`[DISC-E2E-NAV-CK] ${kn.w}x${kn.h}: banner cookie đang hiện ⇒ viên thuốc DISC vẫn là phần tử trên cùng tại tâm nó (bấm được)`, async ({ page }) => {
    await page.setViewportSize({ width: kn.w, height: kn.h });
    await page.goto(TRANG_NHE); // KHÔNG đặt quyết định cookie ⇒ banner hiện sau ~800ms
    const banner = page.locator('[aria-labelledby="cookie-consent-title"]');
    await expect(banner).toBeVisible({ timeout: 8_000 });
    const vien = page.getByTestId("goc-floating"); // nút «Góc gia đình» (hoặc viên thuốc DISC khi chỉ một mục bật)
    await expect(vien).toBeVisible();
    // chờ ResizeObserver/MutationObserver áp vị trí mới
    await expect
      .poll(async () =>
        vien.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !!t && (el === t || el.contains(t));
        }),
      )
      .toBe(true);
    const b = await hop(banner);
    const v = await hop(vien);
    expect(v!.y + v!.h).toBeLessThanOrEqual(b!.y + 1); // nằm TRÊN mép banner
    // quyết định cookie xong ⇒ về chỗ cũ (đối chứng: nút không bị đẩy mãi)
    await page.getByRole("button", { name: /Chỉ cần thiết/ }).click();
    await expect(banner).toHaveCount(0);
    await expect.poll(async () => (await hop(vien))!.y + (await hop(vien))!.h).toBeGreaterThan(kn.h - 140);
  });
}
