/**
 * Chẩn đoán đường ĐỌC ảnh: mở lại luồng đã có ảnh và ghi lại mọi lượt gọi
 * `/api/chat/attachment-url` cùng mọi lượt GET lên R2.
 */
import { test } from "@playwright/test";
import { readSeed } from "./_fixtures";
import { contextFor, openPortalThread } from "./_helpers";

const seed = readSeed();

test("chẩn đoán · đường xin URL đọc ảnh", async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const ctx = await contextFor(browser, "ph1");
  const page = await ctx.newPage();

  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes("/api/chat/attachment-url")) {
      const body = await r.text().catch(() => "(không đọc được)");
      console.log(`[attachment-url] HTTP ${r.status()} · ${body.slice(0, 300)}`);
    } else if (u.includes("r2.cloudflarestorage.com")) {
      console.log(`[r2] ${r.request().method()} HTTP ${r.status()} · ${u.slice(0, 100)}`);
    }
  });
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[console] …${m.text().slice(-200)}`);
  });

  await openPortalThread(page, seed.conversations.lopA);
  await page.waitForTimeout(20_000);

  const imgs = await page.locator("img").evaluateAll((els) =>
    els.map((e) => ({
      src: (e as HTMLImageElement).src.slice(0, 80),
      w: (e as HTMLImageElement).naturalWidth,
      alt: (e as HTMLImageElement).alt,
    })),
  );
  console.log(`[thẻ img trên trang] ${JSON.stringify(imgs).slice(0, 700)}`);

  await ctx.close();
});
