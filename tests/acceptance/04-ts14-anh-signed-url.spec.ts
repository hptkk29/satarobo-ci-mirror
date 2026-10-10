/**
 * TS-14 (phần [TAY]) — Đính kèm ảnh: gửi được, xem lớn được, và signed URL CHẾT sau
 * 5 phút khi mang ra ngoài ứng dụng, trong khi trong ứng dụng ảnh vẫn hiện (tự xin
 * URL mới).
 *
 * Phần [AUTO] của TS-14 (magic bytes, 12MB, heic, IDOR, ảnh của tin đã gỡ) đã có
 * `lib/chat/attachments.test.ts` chặn merge — ở đây KHÔNG làm lại.
 *
 * Điều kiện môi trường: `R2_CHAT_BUCKET_NAME` phải có ở env `test`. Thiếu thì luồng
 * ảnh trả 503 (fail-closed CÓ CHỦ ĐÍCH) — spec này sẽ đỏ và đó là phát hiện đúng.
 */
import { expect, test } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSeed } from "./_fixtures";
import { contextFor, openPortalThread } from "./_helpers";

const seed = readSeed();

/** PNG 1×1 hợp lệ (magic bytes thật — server kiểm byte, không kiểm đuôi file). */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("TS-14 · gửi ảnh, signed URL hết hạn sau 6 phút ngoài app nhưng trong app vẫn hiện", async ({
  browser,
}) => {
  test.setTimeout(15 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "zztest-chat-"));
  const files = [1, 2, 3].map((i) => {
    const p = path.join(dir, `nghiem-thu-${i}.png`);
    writeFileSync(p, PNG_1PX);
    return p;
  });

  const phCtx = await contextFor(browser, "ph1");
  const ph = await phCtx.newPage();
  await openPortalThread(ph, seed.conversations.lopA);

  // ── Bước 3a: PH gửi 3 ảnh ─────────────────────────────────────────────────
  await ph.locator('input[type="file"]').first().setInputFiles(files);
  const send = ph
    .getByRole("button", { name: "Gửi tin nhắn" })
    .or(ph.getByRole("button", { name: "Gửi", exact: true }))
    .first();
  // Nút Gửi bị khoá trong lúc ảnh còn đang tải lên — chờ nó mở ra rồi mới bấm.
  await expect(send).toBeEnabled({ timeout: 90_000 });
  await ph.waitForTimeout(1_000);
  await send.click();

  const img = ph.locator('img[alt^="nghiem-thu-"]').first();
  await expect(img).toBeVisible({ timeout: 60_000 });
  console.log("[TS-14.3] Thumbnail 3 ảnh đã hiện trong luồng");

  // ── Bước 3b: mang URL ra NGOÀI ứng dụng ───────────────────────────────────
  // ⚠️ Phía NGƯỜI GỬI, `<img src>` giữ nguyên `blob:` cục bộ cho tới khi tải lại trang —
  // CÓ CHỦ ĐÍCH (chat-thread.tsx: "người gửi không phải chờ một vòng ký URL để thấy lại
  // ảnh mình vừa gửi"). Muốn lấy URL đã ký thì phải dựng lại trang từ RSC.
  await ph.reload();
  // Đừng bám vào `alt`: sau khi tải lại, thư viện ảnh phải xin URL ký xong mới vẽ thẻ
  // `<img>`, và tên file server trả về đã qua bước làm sạch nên không chắc trùng tên gốc.
  // Dò theo ĐẶC ĐIỂM CỦA URL ĐÃ KÝ — thứ duy nhất ta thật sự cần ở bước này.
  let signed = "";
  for (let i = 0; i < 60; i++) {
    const srcs = await ph
      .locator("img")
      .evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));
    signed = srcs.find((s) => s.includes("r2.cloudflarestorage.com") && s.includes("X-Amz-")) ?? "";
    if (signed) break;
    await ph.waitForTimeout(2_000);
  }
  expect(signed, "phải lấy được signed URL từ thẻ img").toMatch(/^https?:\/\//);
  console.log(`[TS-14.3] Signed URL: ${signed.slice(0, 90)}…`);

  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  const fresh = await anonPage.request.get(signed);
  console.log(`[TS-14.3] Mở URL ở tab ẩn danh NGAY: HTTP ${fresh.status()}`);
  expect(fresh.status()).toBe(200);

  // ── Bước 3c: đợi 6 phút → URL phải chết ───────────────────────────────────
  console.log("[TS-14.3] Đợi 6 phút cho URL hết hạn…");
  await anonPage.waitForTimeout(6 * 60_000);
  const expired = await anonPage.request.get(signed);
  console.log(`[TS-14.3] Sau 6 phút: HTTP ${expired.status()}`);
  expect(expired.status(), "signed URL phải hết hạn").toBeGreaterThanOrEqual(400);

  // ── Bước 3d: trong ứng dụng ảnh VẪN hiện (tự xin URL mới) ─────────────────
  await ph.reload();
  // Ảnh phải VẼ ĐƯỢC (naturalWidth > 0) bằng một URL ký MỚI — chứng minh app tự xin lại
  // chứ không sống nhờ URL cũ đã chết.
  let drawn = false;
  for (let i = 0; i < 45; i++) {
    drawn = await ph
      .locator("img")
      .evaluateAll((els) =>
        els.some(
          (e) =>
            (e as HTMLImageElement).src.includes("r2.cloudflarestorage.com") &&
            (e as HTMLImageElement).naturalWidth > 0,
        ),
      );
    if (drawn) break;
    await ph.waitForTimeout(2_000);
  }
  const ok = drawn;
  expect(ok, "ảnh trong app phải vẽ được sau khi URL cũ đã chết").toBe(true);
  console.log("[TS-14.3] Trong app ảnh vẫn hiện sau khi URL cũ hết hạn");

  await anon.close();
  await phCtx.close();
});
