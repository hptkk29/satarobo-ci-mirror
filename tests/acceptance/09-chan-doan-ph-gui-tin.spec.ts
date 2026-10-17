/**
 * Tách bạch: PHỤ HUYNH gửi TIN CHỮ (không ảnh) có được không?
 * Nếu cũng PERMISSION_DENIED ⇒ lỗi nằm ở quyền gửi của vai PH, không liên quan ảnh.
 */
import { test } from "@playwright/test";
import { readSeed } from "./_fixtures";
import { contextFor, openPortalThread, sendMessage } from "./_helpers";

const seed = readSeed();

test("chẩn đoán · phụ huynh gửi tin CHỮ", async ({ browser }) => {
  test.setTimeout(3 * 60_000);
  const ctx = await contextFor(browser, "ph1");
  const page = await ctx.newPage();

  page.on("response", async (r) => {
    if (r.request().method() !== "POST" || !r.url().includes("/portal/tin-nhan/")) return;
    const body = await r.text().catch(() => "");
    const m = body.match(/\{"ok":[^\n]{0,300}/)?.[0];
    if (m) console.log(`[ACTION] ${m}`);
  });

  await openPortalThread(page, seed.conversations.lopA);
  await sendMessage(page, `CHAN-DOAN PH gui tin chu ${Date.now()}`);
  await page.waitForTimeout(12_000);

  const toasts = await page.locator("[data-sonner-toast]").allInnerTexts();
  console.log(`[toast] ${JSON.stringify(toasts)}`);
  await ctx.close();
});
