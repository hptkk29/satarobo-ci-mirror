/**
 * TS-13 — Vòng đầy đủ của một thông báo lịch học (kịch bản pilot chính).
 *
 * Phần KHÔNG chạy được ở đây và phải ghi vào báo cáo:
 *   • Bước 1 "đẩy push tới PH đang offline (kể cả PH đã mute)" — trên `test` đường
 *     báo tin là ZNS Zalo, mà creds Zalo CHỈ có ở scope Production ⇒ luôn `SIMULATED`.
 *   • Bước 3 "sau 48h vẫn nằm danh sách chưa đọc" — đây là phép đo theo thời gian
 *     thật, chỉ kiểm được PH2 CHƯA đọc thì CÒN trong danh sách.
 */
import { expect, test } from "@playwright/test";
import { paths, readSeed } from "./_fixtures";
import {
  acceptPolicyIfShown,
  contextFor,
  openPortalThread,
  openTeacherThread,
  sendMessage,
} from "./_helpers";

const seed = readSeed();

test("TS-13 · thông báo ghim, đếm đã đọc, quota 10/ngày, ghim trụ được 30 tin sau", async ({
  browser,
}) => {
  test.setTimeout(20 * 60_000);
  const tag = `TS13-${Date.now().toString().slice(-6)}`;

  const gvCtx = await contextFor(browser, "gv");
  const ph1Ctx = await contextFor(browser, "ph1");
  const ph2Ctx = await contextFor(browser, "ph2");
  const gv = await gvCtx.newPage();
  const ph1 = await ph1Ctx.newPage();
  const ph2 = await ph2Ctx.newPage();

  // Máy đo cho câu hỏi "thông báo có tới client đang mở không": lần chạy 09:5x thấy
  // thông báo VÀO DB mà KHÔNG hiện trên máy PH1 trong 30s, trong khi lần trước thì có.
  // Bắt log của trình duyệt để phân biệt "broadcast không tới" với "kênh đã chết".
  ph1.on("console", (m) => {
    const t = m.text();
    if (/chat|realtime|channel|CLOSED|SUBSCRIBED|Unauthorized/i.test(t)) {
      console.log(`[ph1:console:${m.type()}] ${t.slice(0, 200)}`);
    }
  });
  ph1.on("response", (r) => {
    if (r.url().includes("/api/chat/realtime-token")) {
      console.log(`[ph1:token] ${r.status()} lúc ${new Date().toISOString()}`);
    }
  });
  ph1.on("websocket", (ws) => {
    console.log(`[ph1:ws] mở ${ws.url().slice(0, 80)}`);
    ws.on("close", () => console.log(`[ph1:ws] ĐÓNG lúc ${new Date().toISOString()}`));
  });

  await openTeacherThread(gv, seed.conversations.lopA);
  await openPortalThread(ph1, seed.conversations.lopA);
  // ⚠️ PH2 ở DANH SÁCH, KHÔNG mở luồng — đúng kịch bản ("PH2 không mở") và cũng là
  // điều kiện để phép đo có nghĩa: `AnnouncementReadMarker` đánh dấu đã đọc ngay khi
  // thông báo vào viewport, nên PH2 mà mở luồng thì "Đã đọc" nhảy 2/2 tức khắc và
  // bước 3 không còn gì để kiểm.
  // ⚠️ Cổng chính sách bọc CẢ danh sách (`portal/tin-nhan/layout.tsx`), không riêng
  // luồng tin — vào danh sách mà chưa đồng ý thì thấy cổng chứ không thấy hội thoại.
  await ph2.goto(paths.portalList);
  await acceptPolicyIfShown(ph2);
  await ph2.waitForLoadState("domcontentloaded");

  // ── Bước 1: GV gửi ANNOUNCEMENT ───────────────────────────────────────────
  const annBody = `${tag} Lớp nghỉ ngày 15/08, học bù ngày 22/08`;
  await gv.getByRole("button", { name: "Gửi thông báo" }).first().click();
  const dlg = gv.getByRole("dialog");
  await dlg.getByLabel("Nội dung thông báo").fill(annBody);
  await dlg.getByRole("button", { name: "Gửi thông báo" }).click();
  await expect(dlg.getByText("Đã gửi thông báo")).toBeVisible({ timeout: 30_000 });

  // Bảng "Đã đọc X/Y" hiện ngay sau khi gửi — mẫu số chỉ đếm PHỤ HUYNH (2 PH của LopA).
  await expect(dlg.getByText(/Đã đọc \d+\/\d+/)).toBeVisible({ timeout: 30_000 });
  const statsBefore = await dlg.getByText(/Đã đọc \d+\/\d+/).innerText();
  console.log(`[TS-13.2] Ngay sau khi gửi: ${statsBefore} (mẫu số = số PHỤ HUYNH)`);
  expect(statsBefore).toMatch(/Đã đọc \d+\/2/);

  await dlg.getByRole("button", { name: "Đóng" }).click();

  // Máy PH1 (đang mở luồng) nhận thông báo qua realtime.
  await expect(ph1.getByText(annBody, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  // Máy PH2 (đang ở danh sách) thấy hội thoại nhảy lên kèm nội dung mới, không reload.
  await expect(ph2.getByText(/ZZTEST_CHAT_NT LopA/).first()).toBeVisible({ timeout: 30_000 });
  console.log("[TS-13.1] PH1 nhận trong luồng; PH2 thấy ở danh sách");

  // ── Bước 2: PH1 đọc → bộ đếm bên GV tăng, PH1 rời danh sách chưa đọc ──────
  // AnnouncementReadMarker đánh dấu khi thông báo VÀO VIEWPORT — cuộn tới nó.
  await ph1.getByText(annBody, { exact: true }).scrollIntoViewIfNeeded();
  await ph1.waitForTimeout(4_000);

  await gv.goto(paths.teacherAnnouncements(seed.conversations.lopA));
  const statsBlock = gv.getByText(/Đã đọc \d+\/\d+/).first();
  await expect(statsBlock).toBeVisible({ timeout: 30_000 });
  // ⚠️ Bản hiện tại KHÔNG tự đẩy realtime số đã-đọc (ghi rõ trong announcement-read-stats.tsx):
  // "không reload TRANG" được hiểu là bấm "Làm mới" gọi lại Server Action. Ta bấm đúng thứ đó.
  await gv.getByRole("button", { name: "Làm mới" }).first().click();
  await expect(gv.getByText(/Đã đọc 1\/2/).first()).toBeVisible({ timeout: 30_000 });
  console.log("[TS-13.2] GV thấy Đã đọc 1/2 sau khi PH1 đọc");

  // ── Bước 3: PH2 chưa đọc thì CÒN trong danh sách chưa đọc ─────────────────
  await expect(gv.getByText("Chưa đọc:").first()).toBeVisible();
  await expect(gv.getByText(seed.users.ph2.name).first()).toBeVisible();
  console.log(`[TS-13.3] PH2 (${seed.users.ph2.name}) còn trong danh sách chưa đọc`);

  // ── Bước 4: thông báo thứ 11 trong ngày bị chặn ───────────────────────────
  await gv.goto(paths.teacherChat(seed.conversations.lopA));
  let blockedMessage: string | null = null;
  // Quota tính theo NGÀY VN cho cả lớp, không theo lần chạy — lớp có thể đã tiêu vài
  // suất từ lần nghiệm thu trước trong ngày, nên chỗ bị chặn xê dịch. Phải nhớ bản
  // CUỐI CÙNG gửi được để bước 5 biết cái nào đang ghim.
  let lastSentAnnouncement = annBody;
  for (let i = 2; i <= 11; i++) {
    // ⚠️ "Gửi thông báo" là nhãn của CẢ nút mở lẫn nút gửi trong hộp thoại. Bấm khi hộp
    // thoại trước chưa đóng hẳn ⇒ `.first()` trỏ vào nút mở đang bị lớp phủ che, Playwright
    // chờ actionability tới hết giờ và cả bài test treo (đã dính đúng thế lúc 10:47).
    //
    // ⚠️ Không dò trạng thái của chính phần tử `role="dialog"`: trên trang GV nó LUÔN tồn
    // tại (đo: 33 lần đều thấy 1 phần tử) và Playwright vẫn coi là "visible" khi đóng, nên
    // cả `toHaveCount(0)` lẫn `toBeHidden()` đều sai. Cách chắc chắn nhất mà vẫn là thao
    // tác người dùng thật: TẢI LẠI TRANG giữa hai lượt — trang mới thì không còn lớp phủ
    // nào sót lại.
    await gv.goto(paths.teacherChat(seed.conversations.lopA));
    // `.first()`: sau vài lượt điều hướng mềm, trang GV có lúc còn giữ DOM của lượt trước
    // ⇒ hai ô nhập cùng nhãn. Ta chỉ cần biết trang đã dựng xong.
    await expect(gv.getByLabel("Nội dung tin nhắn").first()).toBeVisible({ timeout: 30_000 });
    await gv.getByRole("button", { name: "Gửi thông báo" }).first().click();
    const d = gv.getByRole("dialog");
    await expect(d).toBeVisible({ timeout: 15_000 });
    await d.getByLabel("Nội dung thông báo").fill(`${tag} thông báo số ${i} trong ngày`);
    await d.getByRole("button", { name: "Gửi thông báo" }).click();
    const alert = d.locator('[role="alert"]');
    const sent = d.getByText("Đã gửi thông báo");
    await expect(alert.or(sent)).toBeVisible({ timeout: 30_000 });
    if (await alert.isVisible().catch(() => false)) {
      blockedMessage = await alert.innerText();
      console.log(`[TS-13.4] Bị chặn ở lần thứ ${i}: ${blockedMessage}`);
      await d.getByRole("button", { name: "Huỷ" }).click();
      break;
    }
    lastSentAnnouncement = `${tag} thông báo số ${i} trong ngày`;
    // Không cần bấm "Đóng": lượt sau tải lại trang, hộp thoại biến mất theo.
  }
  expect(blockedMessage, "phải bị chặn ở thông báo thứ 11").not.toBeNull();
  expect(blockedMessage!).toMatch(/10 thông báo/);

  // ── Bước 5: 30 tin CHAT sau đó, thông báo vẫn ghim trên cùng ──────────────
  // Trần gửi tin là 20/phút/người ⇒ chia 2 đợt, có nghỉ. Đây là hàng rào thật,
  // không phải thứ để né bằng cách ghi thẳng DB.
  for (let i = 1; i <= 30; i++) {
    await sendMessage(gv, `${tag} tin chat ${i}`);
    if (i === 18) {
      console.log("[TS-13.5] Nghỉ 62s để không chạm trần 20 tin/phút");
      await gv.waitForTimeout(62_000);
    }
    await gv.waitForTimeout(200);
  }

  // Ghim = thông báo MỚI NHẤT (sau bước 4 là "thông báo số 10"), nằm ngoài vùng cuộn
  // của luồng nên 30 tin chat mới không đẩy nó đi đâu được.
  await ph1.reload();
  const pinnedBody = lastSentAnnouncement;
  console.log(`[TS-13.5] Bản đang ghim phải là: "${pinnedBody}"`);
  await expect(ph1.getByText(pinnedBody, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const pinnedBox = ph1.getByText(pinnedBody, { exact: true }).first();
  const lastChat = ph1.getByText(`${tag} tin chat 30`, { exact: true }).first();
  await expect(lastChat).toBeVisible({ timeout: 30_000 });
  const [pinBox, chatBox] = await Promise.all([pinnedBox.boundingBox(), lastChat.boundingBox()]);
  expect(pinBox!.y, "khung thông báo phải nằm TRÊN tin chat mới nhất").toBeLessThan(chatBox!.y);
  console.log("[TS-13.5] Sau 30 tin chat, thông báo vẫn ghim phía trên");

  await gvCtx.close();
  await ph1Ctx.close();
  await ph2Ctx.close();
});
