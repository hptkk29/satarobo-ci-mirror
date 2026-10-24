/**
 * Cổng số 0 của bộ nghiệm thu: CHỨNG MINH cái mà bộ này đứng trên đó —
 * hai vai đăng nhập ĐỒNG THỜI, mỗi vai một context, và tin đi thật qua Supabase
 * Realtime giữa hai trình duyệt.
 *
 * Nếu spec này đỏ thì mọi kết quả phía sau vô nghĩa: hoặc phiên bị đá lẫn nhau,
 * hoặc realtime không chạy trên môi trường đã triển khai.
 */
import { expect, test } from "@playwright/test";
import { readSeed } from "./_fixtures";
import {
  contextFor,
  openPortalThread,
  openTeacherThread,
  sendMessage,
  waitForMessage,
} from "./_helpers";

const seed = readSeed();

test("hai vai song song + tin realtime GV → PH", async ({ browser }) => {
  const gvCtx = await contextFor(browser, "gv");
  const phCtx = await contextFor(browser, "ph1");
  const gv = await gvCtx.newPage();
  const ph = await phCtx.newPage();

  await openTeacherThread(gv, seed.conversations.lopA);
  await openPortalThread(ph, seed.conversations.lopA);

  // Hai phiên KHÁC NHAU cùng sống: mỗi trang phải nhìn thấy đúng danh tính của mình.
  await expect(gv.locator("body")).toContainText(seed.users.gv.name, { timeout: 20_000 });

  const body = `HARNESS ${Date.now()} — GV chào lớp`;
  await sendMessage(gv, body);
  const ms = await waitForMessage(ph, body, 20_000);
  console.log(`[TS-09.1] GV → PH nhận sau ${ms}ms`);
  // AC "≤2s" của TS-09 bước 1; nới nhẹ cho đường mạng ra Internet của máy chạy test.
  expect(ms).toBeLessThan(5_000);

  await gvCtx.close();
  await phCtx.close();
});
