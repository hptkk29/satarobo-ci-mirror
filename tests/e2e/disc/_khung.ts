/** Dùng chung cho spec DISC: danh sách khung nhìn, cờ lượt chạy, đo hình học. Không chạm DB. */
import { expect, type Locator, type Page } from "@playwright/test";

/** 320 (điện thoại nhỏ) … 7680 (8K). `lg` của Tailwind = 1024: dưới đó là bố cục mobile (drawer + viên thuốc DISC). */
export const KHUNG_NHIN = [
  { w: 320, h: 640 },
  { w: 375, h: 812 },
  { w: 414, h: 896 },
  { w: 768, h: 1024 },
  { w: 1023, h: 768 },
  { w: 1024, h: 768 },
  { w: 1280, h: 800 },
  { w: 1536, h: 864 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 },
  { w: 3840, h: 2160 },
  { w: 7680, h: 4320 }, // 8K
] as const;

export const LA_DESKTOP = (w: number) => w >= 1024;

export const CO_DISC: "on" | "off" = process.env.DISC_E2E_FLAG === "on" ? "on" : "off";

/** Trang public nhẹ, không đọc DB: có Header + FloatingCta + StickyMobileCta. */
export const TRANG_NHE = "/chinh-sach-bao-mat";

export type Hop = { x: number; y: number; w: number; h: number };

export async function hop(l: Locator): Promise<Hop | null> {
  if ((await l.count()) === 0) return null;
  const b = await l.first().boundingBox();
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
}

export const giaoNhau = (a: Hop, b: Hop) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Tràn ngang THẬT: không vùng cuộn chính nào kéo ngang được (scrollWidth <= innerWidth). */
export async function tranNgangPx(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
}

/**
 * Mở drawer menu mobile một cách BỀN: bản dev biên dịch theo yêu cầu nên lượt bấm đầu có thể tới TRƯỚC khi React gắn handler
 * (đo 02/11: 375/414/1023 lúc đỏ, 320/768 xanh — cùng mã). Chỉ bấm khi drawer CHƯA mở (bấm lại sẽ ĐÓNG nó), thử lại tới khi mở.
 */
export async function moDrawer(page: Page): Promise<Locator> {
  const drawer = page.getByRole("dialog", { name: "Menu điều hướng" });
  const nut = page.getByRole("button", { name: "Mở menu" });
  await expect(async () => {
    if (!(await drawer.isVisible())) await nut.click();
    await expect(drawer).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  return drawer;
}
