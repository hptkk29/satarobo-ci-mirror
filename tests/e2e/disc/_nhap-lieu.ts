/** Đồ dùng chung cho spec DISC chạy trên trình duyệt thật: điền hồ sơ GIẢ, làm hết một bộ đề, chụp ảnh bằng chứng. */
import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const ANH = path.join(process.cwd(), "docs", "disc-tich-hop", "ui-evidence", "tiep-can");
export const NAM = new Date().getFullYear();
let seq = 0;
export const sdtMoi = () => `0905${String((Date.now() % 900_000) + 100_000 + (seq += 11)).slice(-6)}`;
export const chup = async (page: Page, ten: string) => {
  fs.mkdirSync(ANH, { recursive: true });
  await page.screenshot({ path: path.join(ANH, `${ten}.png`), timeout: 20_000 }).catch(() => {});
};

/**
 * Điền một ô và XÁC NHẬN giá trị còn dính: ô là controlled input, điền trước khi React hydrate xong thì hydration xoá trắng
 * (đo trên WebKit/iPhone: ô "Họ và tên" rỗng ⇒ "Còn thông tin chưa đúng"). Điền lại tới khi ổn định.
 */
async function dien(page: Page, nhan: string | RegExp, gia: string, exact = false) {
  const o = page.getByLabel(nhan, { exact });
  await expect(async () => {
    await o.fill(gia);
    await expect(o).toHaveValue(gia, { timeout: 800 });
  }).toPass({ timeout: 15_000 });
}

export async function dienHoSo(page: Page) {
  // Điền cả hồ sơ rồi KIỂM LẠI toàn bộ: hydration muộn có thể xoá ô đã điền SAU khi từng ô được xác nhận (WebKit đo được).
  await expect(async () => {
    await dien(page, "Họ và tên", "DISCDB Nguyễn Thị Hạnh");
    await dien(page, "Năm sinh", "1988", true);
    await page.getByText("Mẹ", { exact: true }).first().click();
    await dien(page, "Tên của bé", "Lê Minh Bảo");
    await dien(page, "Năm sinh của bé", String(NAM - 10));
    await page.getByLabel("Lớp / bậc học hiện tại").selectOption("4");
    await expect(page.getByLabel("Họ và tên")).toHaveValue("DISCDB Nguyễn Thị Hạnh", { timeout: 1500 });
    await expect(page.getByLabel("Tên của bé")).toHaveValue("Lê Minh Bảo", { timeout: 1500 });
  }).toPass({ timeout: 30_000 });
}

export async function lamBoDe(page: Page) {
  let i = 0;
  for (let guard = 0; guard < 80; guard++) {
    const vung = page.getByTestId("disc-lam-bai");
    await expect(vung).toBeVisible();
    const nhan = vung.locator("fieldset label");
    const n = await nhan.count();
    await nhan.nth(i % n).click();
    i++;
    const xong = page.getByTestId("disc-cau-xong");
    if ((await xong.isVisible().catch(() => false)) && (await xong.isEnabled())) {
      await xong.click();
      return;
    }
    await page.getByTestId("disc-cau-tiep").click();
  }
  throw new Error("không kết thúc được bộ đề");
}

