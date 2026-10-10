// Thao tác dùng chung cho bộ nghiệm thu. Mỗi hàm ở đây tương ứng một việc NGƯỜI
// DÙNG làm, không phải một lời gọi API — bộ này nghiệm thu bề mặt thật.
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { paths, storageStateFile, type AccountKey } from "./_fixtures";

/** Một context = một vai. KHÔNG dùng chung context cho 2 vai (chung cookie jar). */
export async function contextFor(browser: Browser, key: AccountKey): Promise<BrowserContext> {
  return browser.newContext({ storageState: storageStateFile(key) });
}

/**
 * Mở luồng chat phía phụ huynh. Lần đầu của một PH sẽ gặp cổng chính sách (US-16) —
 * bấm đồng ý là việc của người dùng thật, nên helper làm đúng thao tác đó.
 */
export async function openPortalThread(page: Page, conversationId: string): Promise<void> {
  await page.goto(paths.portalThread(conversationId));
  await acceptPolicyIfShown(page);
  // Chờ ĐÚNG ô nhập, đừng `.or(getByText("Hội thoại"))`: chuỗi "hội thoại" xuất hiện ở
  // nhiều chỗ khác trên trang (liên kết "Về luồng hội thoại", câu báo khoá) ⇒ strict mode
  // violation "resolved to 2 elements", đỏ vì lý do chẳng liên quan tới thứ đang nghiệm thu.
  // Mọi hội thoại dùng trong bộ này đều ACTIVE nên ô nhập PHẢI có.
  await expect(page.getByLabel("Nội dung tin nhắn").first()).toBeVisible({ timeout: 30_000 });
}

export async function acceptPolicyIfShown(page: Page): Promise<boolean> {
  const accept = page.getByRole("button", { name: "Tôi đã đọc và đồng ý" });
  if (await accept.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await accept.click();
    await expect(accept).toBeHidden({ timeout: 30_000 });
    return true;
  }
  return false;
}

/** Mở màn chat phía giáo viên tại đúng hội thoại. */
export async function openTeacherThread(page: Page, conversationId: string): Promise<void> {
  await page.goto(paths.teacherChat(conversationId));
  await expect(page.getByLabel("Nội dung tin nhắn").first()).toBeVisible({ timeout: 30_000 });
}

/** Gõ + gửi một tin. Dùng chung được cho cả 2 bề mặt (nhãn ô nhập giống nhau). */
export async function sendMessage(page: Page, body: string): Promise<void> {
  const box = page.getByLabel("Nội dung tin nhắn").first();
  await box.fill(body);
  const sendBtn = page
    .getByRole("button", { name: "Gửi tin nhắn" })
    .or(page.getByRole("button", { name: "Gửi", exact: true }));
  await sendBtn.first().click();
  await expect(box).toHaveValue("", { timeout: 10_000 });
}

/** Bong bóng tin theo NỘI DUNG — đủ để phân biệt vì mỗi tin có nhãn lần chạy. */
export function bubble(page: Page, body: string) {
  return page.getByText(body, { exact: true });
}

/** Chờ tin hiện ra và trả về số mili-giây đã chờ (số đo để đưa vào báo cáo). */
export async function waitForMessage(page: Page, body: string, timeout = 20_000): Promise<number> {
  const t0 = Date.now();
  await expect(bubble(page, body)).toBeVisible({ timeout });
  return Date.now() - t0;
}

/** Số lần một chuỗi xuất hiện trong luồng — dùng để bắt tin nhân đôi. */
export async function occurrences(page: Page, body: string): Promise<number> {
  return page.getByText(body, { exact: true }).count();
}
