/**
 * Khung điều hướng khu học tập — HÀNH VI THẬT trong trình duyệt (hotfix 26/10/2026).
 *
 * Ba thứ jsdom không đo được, nên phải có trình duyệt thật:
 *  1. Thứ tự Tab: ngăn kéo (modal) ở điện thoại không được rò tiêu điểm ra link "Bỏ qua điều hướng".
 *  2. Trang từ chối quyền vẫn là một trang hoàn chỉnh (`<main>` + một `<h1>`).
 *  3. Nhãn ô số KHÔNG bị cắt ở 375px ("Chấm đúng hạn t…").
 *
 * Mỗi ca ÂM có ĐỐI CHỨNG DƯƠNG: "không thấy X" luôn đạt nếu khung hỏng hẳn.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login } from "../_helpers/auth";
import { dungVongHoc, type BoDuLieu } from "./_helpers/seed-elearning";

test.describe.configure({ mode: "serial" });

let d: BoDuLieu;
const cookieCua = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();

test.beforeAll(async ({ browser }) => {
  d = await dungVongHoc();
  for (const email of [d.hocVienEmail, d.daoTaoEmail]) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, { email, callbackUrl: "/elearning" });
    await expect(p).toHaveURL(/\/elearning/);
    cookieCua.set(email, await ctx.cookies());
    await ctx.close();
  }
});

async function vaoVoi(page: Page, email: string, duongDan: string) {
  const ck = cookieCua.get(email);
  if (!ck) throw new Error(`chưa có phiên cho ${email}`);
  await page.context().clearCookies();
  await page.context().addCookies(ck);
  await page.goto(duongDan);
}

const tenTieuDiem = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    if (!e || e === document.body) return { ten: "<body>", trongHop: false, trongNgan: false };
    return {
      ten: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40),
      trongHop: true,
      trongNgan: !!e.closest('[role="dialog"]'),
    };
  });

test.describe("[KD] thứ tự Tab và ngăn kéo ở 375px", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("🔴 ĐỐI CHỨNG DƯƠNG: ngăn kéo ĐÓNG ⇒ phím Tab đầu tiên của trang rơi vào 'Bỏ qua điều hướng'", async ({ page }) => {
    await vaoVoi(page, d.hocVienEmail, "/elearning");
    await expect(page.getByRole("button", { name: "Mở menu điều hướng" })).toBeVisible();
    await page.keyboard.press("Tab");
    expect((await tenTieuDiem(page)).ten).toContain("Bỏ qua điều hướng");
  });

  test("🔴 ngăn kéo MỞ ⇒ 20 lần Tab: tiêu điểm chỉ ở trong ngăn kéo (hoặc rời khỏi tài liệu), KHÔNG BAO GIỜ ở link 'Bỏ qua điều hướng' hay nền", async ({
    page,
  }) => {
    await vaoVoi(page, d.hocVienEmail, "/elearning");
    await page.getByRole("button", { name: "Mở menu điều hướng" }).click();
    // Tiêu điểm vào nút Đóng khi mở.
    await expect.poll(async () => (await tenTieuDiem(page)).ten).toBe("Đóng menu");

    const dau: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press("Tab");
      const t = await tenTieuDiem(page);
      dau.push(t.ten);
      expect(
        t.ten === "<body>" || t.trongNgan,
        `Tab lần ${i + 1} rơi ra NGOÀI ngăn kéo: "${t.ten}" (chuỗi: ${dau.join(" › ")})`,
      ).toBe(true);
      expect(t.ten, `skip link rò vào chu trình Tab lần ${i + 1}`).not.toContain("Bỏ qua điều hướng");
    }
    // Chu trình có THẬT: ít nhất một mục menu được chạm tới (không phải tiêu điểm đứng yên ở một nút).
    expect(new Set(dau).size, `tiêu điểm không đi đâu cả: ${dau.join(" › ")}`).toBeGreaterThan(2);
  });

  test("🔴 Esc đóng ngăn kéo ⇒ skip link nhận Tab lại và tiêu điểm trở về nút mở menu", async ({ page }) => {
    await vaoVoi(page, d.hocVienEmail, "/elearning");
    await page.getByRole("button", { name: "Mở menu điều hướng" }).click();
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await tenTieuDiem(page)).ten).toBe("Mở menu điều hướng");
    await expect(page.getByText("Bỏ qua điều hướng, tới nội dung")).not.toHaveAttribute("inert", /.*/);
  });
});

test.describe("[KD] trang từ chối quyền là một trang hoàn chỉnh", () => {
  test("🔴 ĐỐI CHỨNG DƯƠNG: Đào tạo mở /elearning/dao-tao ⇒ đúng một <main> và một <h1>", async ({ page }) => {
    await vaoVoi(page, d.daoTaoEmail, "/elearning/dao-tao");
    await expect(page.getByRole("heading", { level: 1, name: "Tổng quan Đào tạo" })).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("🔴 người học mở /elearning/dao-tao ⇒ bị từ chối NHƯNG vẫn có đúng một <main>, một <h1>, lối về", async ({ page }) => {
    await vaoVoi(page, d.hocVienEmail, "/elearning/dao-tao");
    await expect(page.getByText("Bạn không có quyền xem tổng quan Đào tạo")).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Về trang tổng quan" })).toBeVisible();
    // Không lộ số liệu cho người không có quyền.
    await expect(page.getByText("Cần xử lý")).toHaveCount(0);
  });
});

test.describe("[KD] nhãn ô số không bị cắt ở 375px", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("🔴 'Chấm đúng hạn tháng này' hiện ĐỦ chữ (không dấu …), trang không tràn ngang", async ({ page }) => {
    await vaoVoi(page, d.daoTaoEmail, "/elearning/bao-cao");
    const nhan = page.getByText("Chấm đúng hạn tháng này", { exact: true });
    // ĐỐI CHỨNG DƯƠNG: ô có mặt — không thì "không bị cắt" đúng vì lý do sai.
    await expect(nhan).toBeVisible();
    const kq = await nhan.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bi_cat: el.scrollWidth > el.clientWidth + 1, ellipsis: cs.textOverflow === "ellipsis" && cs.overflow !== "visible", cao: el.getBoundingClientRect().height };
    });
    expect(kq.bi_cat, "chữ bị cắt ngang").toBe(false);
    expect(kq.ellipsis, "vẫn đang cắt bằng dấu …").toBe(false);
    const tran = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(tran, "trang tràn ngang").toBeLessThanOrEqual(1);
  });
});
