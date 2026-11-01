/**
 * Chẩn đoán TS-14: đi ĐÚNG đường của trình duyệt (xin ticket → PUT thẳng lên R2) và
 * ghi lại mọi response + log console, để phân biệt 3 khả năng:
 *   (a) thiếu `R2_CHAT_BUCKET_NAME` → /api/chat/upload-url trả 503;
 *   (b) bucket chat thiếu luật CORS cho PUT từ domain site → trình duyệt CHẶN,
 *       XHR báo lỗi mạng, ảnh không bao giờ "ready" (không có lỗi phía server);
 *   (c) lỗi khác của client.
 */
import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSeed } from "./_fixtures";
import { contextFor, openPortalThread } from "./_helpers";

const seed = readSeed();
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("chẩn đoán · đường upload ảnh của trình duyệt", async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "zztest-chat-"));
  const file = path.join(dir, "chan-doan.png");
  writeFileSync(file, PNG_1PX);

  const ctx = await contextFor(browser, "ph1");
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const t = m.text();
    // LÝ DO của lỗi CORS nằm ở CUỐI câu ("…has been blocked by CORS policy: <lý do>"),
    // mà signed URL dài cả nghìn ký tự nên cắt đầu là mất đúng thứ cần đọc.
    console.log(`[console:${m.type()}] …${t.slice(-260)}`);
  });
  page.on("requestfailed", (r) => {
    console.log(`[requestfailed] ${r.method()} ${r.url().slice(0, 120)} — ${r.failure()?.errorText}`);
  });
  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes("/api/chat/") || u.includes("r2.cloudflarestorage.com")) {
      console.log(`[response] ${r.status()} ${r.request().method()} ${u.slice(0, 120)}`);
    }
    // Server Action POST thẳng vào URL của trang — đây là chỗ đọc được lỗi thật.
    if (r.request().method() === "POST" && u.includes("/portal/tin-nhan/")) {
      const body = await r.text().catch(() => "(không đọc được)");
      // Payload là dòng flight của React — chỉ in phần MANG NGHĨA: kết quả ActionResult.
      const meaningful =
        body.match(/\{"ok":[^\n]{0,400}/)?.[0] ??
        body.match(/"(code|message)":"[^"]{0,200}"/g)?.join(" · ") ??
        `(${body.length} ký tự, không thấy khuôn ActionResult)`;
      console.log(`[SERVER ACTION] HTTP ${r.status()} · ${meaningful}`);
    }
  });

  await openPortalThread(page, seed.conversations.lopA);
  await page.locator('input[type="file"]').first().setInputFiles(file);

  // Chờ upload xong rồi BẤM GỬI — phần hỏng nằm ở đây chứ không ở khâu upload:
  // đo 10/08 thấy ảnh lên R2 thành công (PUT 200) mà DB có 0 MessageAttachment.
  const send = page
    .getByRole("button", { name: "Gửi tin nhắn" })
    .or(page.getByRole("button", { name: "Gửi", exact: true }))
    .first();
  await expect(send).toBeEnabled({ timeout: 90_000 });
  await page.waitForTimeout(1_000);
  await send.click();
  await page.waitForTimeout(15_000);

  // Toast của sonner mang đúng câu lỗi mà Server Action trả về.
  const toasts = await page
    .locator("[data-sonner-toast], [role='status'], [role='alert']")
    .allInnerTexts();
  console.log(`[toast] ${JSON.stringify(toasts).slice(0, 500)}`);
  const strip = await page
    .locator("body")
    .innerText()
    .then((t) => t.split("\n").filter((l) => /ảnh|Ảnh|tải|lỗi|Lỗi/.test(l)).slice(0, 10));
  console.log(`[trạng thái] ${JSON.stringify(strip)}`);

  const sendEnabled = await page
    .getByRole("button", { name: "Gửi", exact: true })
    .first()
    .isEnabled();
  console.log(`[trạng thái] nút Gửi enabled = ${sendEnabled}`);
  expect(true).toBe(true);
  await ctx.close();
});
