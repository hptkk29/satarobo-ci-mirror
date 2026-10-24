/** Chụp 3 bề mặt của F5 để soi giao diện (không assert gì — đây là công cụ nhìn). */
import { test } from "@playwright/test";
import { readSeed } from "./_fixtures";
import { contextFor, openPortalThread } from "./_helpers";

const seed = readSeed();
const OUT = "test-results/acceptance/anh-f5";

test("chụp màn F5", async ({ browser }) => {
  test.setTimeout(4 * 60_000);

  const saleCtx = await contextFor(browser, "sale");
  const sale = await saleCtx.newPage();
  await sale.setViewportSize({ width: 1440, height: 900 });

  await sale.goto("/admin/enrollments");
  await sale.waitForTimeout(4000);
  await sale.screenshot({ path: `${OUT}/1-bang-ghi-danh.png`, fullPage: false });

  await sale.goto("/admin/tin-nhan");
  await sale.waitForTimeout(5000);
  await sale.screenshot({ path: `${OUT}/2-danh-sach-cua-sale.png`, fullPage: false });

  const nut = sale.getByRole("button", { name: "Nhắn riêng" });
  if (await nut.first().isVisible().catch(() => false)) {
    await sale.goto("/admin/enrollments");
    await nut.first().click();
    await sale.waitForTimeout(6000);
  }
  await sale.screenshot({ path: `${OUT}/3-luong-chat-cua-sale.png`, fullPage: false });
  console.log(`[chụp] sale ở ${sale.url()}`);

  const phCtx = await contextFor(browser, "ph1");
  const ph = await phCtx.newPage();
  await ph.setViewportSize({ width: 390, height: 844 }); // điện thoại — PH dùng mobile
  await ph.goto("/portal/tin-nhan");
  await ph.waitForTimeout(4000);
  await ph.screenshot({ path: `${OUT}/4-portal-danh-sach-mobile.png`, fullPage: false });

  const convs = seed.conversations.lopA;
  await openPortalThread(ph, convs).catch(() => undefined);
  await ph.screenshot({ path: `${OUT}/5-portal-luong-mobile.png`, fullPage: false });

  await saleCtx.close();
  await phCtx.close();
});
