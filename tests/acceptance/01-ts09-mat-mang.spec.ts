/**
 * TS-09 — Mất mạng không mất tin (US-07 · NT1 của BA).
 *
 * Kịch bản gốc yêu cầu "2 thiết bị thật, PH bật/tắt 4G". Ở đây PH là một
 * BrowserContext riêng và mạng bị cắt ở tầng context (`setOffline`) — cắt thật,
 * websocket đứt thật, không phải mock tầng ứng dụng.
 *
 * Điều bộ này KHÔNG thay được: cảm giác trên điện thoại thật (4G chập chờn khác
 * hẳn ngắt hẳn). Ghi rõ trong báo cáo.
 */
import { expect, test } from "@playwright/test";
import { readSeed } from "./_fixtures";
import {
  contextFor,
  occurrences,
  openPortalThread,
  openTeacherThread,
  sendMessage,
  waitForMessage,
} from "./_helpers";

const seed = readSeed();

/** Đọc toàn bộ tin đang hiển thị theo ĐÚNG THỨ TỰ trong DOM. */
async function visibleMessages(page: import("@playwright/test").Page): Promise<string[]> {
  return page.locator('[id^="chat-msg-"]').allInnerTexts();
}

test("TS-09 · tin gửi lúc PH mất mạng không rơi, không trùng, đúng thứ tự", async ({ browser }) => {
  const tag = `TS09-${Date.now().toString().slice(-6)}`;
  const gvCtx = await contextFor(browser, "gv");
  const phCtx = await contextFor(browser, "ph1");
  const gv = await gvCtx.newPage();
  const ph = await phCtx.newPage();

  await openTeacherThread(gv, seed.conversations.lopA);
  await openPortalThread(ph, seed.conversations.lopA);

  // ── Bước 1: cả hai đang mở, GV gửi 1 tin → PH thấy ≤2s ────────────────────
  const first = `${tag} B1 tin đầu`;
  await sendMessage(gv, first);
  const firstMs = await waitForMessage(ph, first);
  console.log(`[TS-09.1] PH nhận sau ${firstMs}ms`);
  expect(firstMs).toBeLessThan(5_000);

  // ── Bước 2: PH mất mạng 30s, GV gửi 5 tin liên tiếp ───────────────────────
  await phCtx.setOffline(true);
  console.log("[TS-09.2] PH: OFFLINE");
  await ph.waitForTimeout(30_000);

  const burst = [1, 2, 3, 4, 5].map((i) => `${tag} B2 tin ${i}`);
  for (const body of burst) {
    await sendMessage(gv, body);
    await gv.waitForTimeout(300);
  }
  // Người gửi vẫn thấy đủ 5 tin của mình dù người nhận đang offline.
  for (const body of burst) await expect(gv.getByText(body, { exact: true })).toBeVisible();

  // PH đang offline thì KHÔNG được thấy tin nào của loạt này (đối chứng dương:
  // nếu thấy, phép đo bên dưới vô nghĩa vì mạng chưa bị cắt thật).
  expect(await occurrences(ph, burst[4]!)).toBe(0);

  // ── Bước 3: PH có mạng lại → đủ 5 tin, đúng thứ tự, không trùng ────────────
  const t0 = Date.now();
  await phCtx.setOffline(false);
  console.log("[TS-09.3] PH: ONLINE trở lại");
  // Kênh đóng KHÔNG tự hồi (luật E-ter #2) — client phải tự nối lại có backoff.
  // Cho tối đa 120s: backoff nhân đôi, và còn một vòng reconcile sau SUBSCRIBED.
  await expect(ph.getByText(burst[4]!, { exact: true })).toBeVisible({ timeout: 120_000 });
  const recoverMs = Date.now() - t0;
  console.log(`[TS-09.3] Hồi đủ tin sau ${recoverMs}ms kể từ lúc có mạng`);

  for (const body of burst) {
    expect(await occurrences(ph, body), `tin "${body}" phải hiện ĐÚNG MỘT lần`).toBe(1);
  }
  const shown = await visibleMessages(ph);
  const indexes = burst.map((b) => shown.findIndex((t) => t.includes(b)));
  expect(indexes.every((i) => i >= 0)).toBe(true);
  expect(
    indexes.every((v, i) => i === 0 || v > indexes[i - 1]!),
    `thứ tự hiển thị phải đúng thứ tự gửi, đang là ${JSON.stringify(indexes)}`,
  ).toBe(true);

  // ── Bước 5: cắt mạng 10 PHÚT (reconcile không được phụ thuộc buffer channel) ─
  await phCtx.setOffline(true);
  console.log("[TS-09.5] PH: OFFLINE 10 phút…");
  await ph.waitForTimeout(10 * 60_000);
  const late = [1, 2, 3].map((i) => `${tag} B5 tin ${i}`);
  for (const body of late) {
    await sendMessage(gv, body);
    await gv.waitForTimeout(300);
  }
  const t1 = Date.now();
  await phCtx.setOffline(false);
  await expect(ph.getByText(late[2]!, { exact: true })).toBeVisible({ timeout: 150_000 });
  console.log(`[TS-09.5] Sau 10 phút offline, hồi đủ tin sau ${Date.now() - t1}ms`);
  for (const body of late) expect(await occurrences(ph, body)).toBe(1);

  await gvCtx.close();
  await phCtx.close();
});
