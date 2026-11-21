// tests/uat-nguon/_lib/audit.ts — đọc ADMIN › Audit Log bằng BỘ LỌC THẬT của màn hình (ô «Hành động» + «Tìm trong lý do» + nút «Áp dụng»).
// ⚠️ Tham số trên URL (`?action=…`) KHÔNG lọc ở màn này — bản đầu của SRC-22 tin nó và «PASS» trên danh sách chưa lọc. Phải điền ô rồi bấm «Áp dụng».
import { expect, type Page } from "@playwright/test";
import { coThay, di } from "./thao-tac";

/** Chữ chuẩn hoá của từng dòng audit khớp bộ lọc. `[]` nếu không có dòng nào (hoặc màn không mở được). */
export async function locAuditLog(page: Page, o: { hanhDong: string; lyDo?: string }): Promise<string[]> {
  await di(page, "/audit-log");
  const oHanhDong = page.locator("#action");
  if (!(await coThay(oHanhDong, 90_000))) return [];
  await expect(page.getByRole("button", { name: "Áp dụng" })).toBeVisible({ timeout: 30_000 });
  await oHanhDong.fill(o.hanhDong);
  if (o.lyDo) await page.locator("#freeText").fill(o.lyDo);
  await page.getByRole("button", { name: "Áp dụng" }).click();
  // Bảng vẽ lại sau khi áp dụng: đợi số dòng đứng yên 2 lần liên tiếp rồi mới đọc (không đọc lúc đang chuyển).
  let truoc = -1;
  await expect.poll(async () => {
    await page.waitForTimeout(1_500);
    const n = await page.locator("tbody tr").count();
    const on = n === truoc;
    truoc = n;
    return on;
  }, { timeout: 60_000, intervals: [500] }).toBe(true);
  const ra = await page.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).innerText.replace(/\s+/g, " ").trim()));
  return ra.filter((t) => t.includes(o.hanhDong));
}
