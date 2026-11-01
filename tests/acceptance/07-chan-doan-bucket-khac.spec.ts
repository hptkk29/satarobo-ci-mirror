/**
 * Đối chứng quyết định: CÙNG một bộ khoá R2, PUT lên bucket UPLOAD CHUNG (đường admin)
 * so với bucket ẢNH CHAT.
 *   • cả hai 403  ⇒ khoá hỏng / hết hạn
 *   • chung OK, chat 403 ⇒ token R2 KHÔNG có quyền ghi lên bucket `satarobo-chat`
 *     (đúng họ với việc `PutBucketCors` cũng trả Access Denied)
 */
import { test } from "@playwright/test";
import { readSeed, storageStateFile } from "./_fixtures";

const seed = readSeed();
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("chẩn đoán · bucket upload chung so với bucket ảnh chat", async ({ playwright }) => {
  const admin = await playwright.request.newContext({
    baseURL: seed.baseURL,
    storageState: storageStateFile("admin"),
  });
  const res = await admin.post("/api/admin/upload-url", {
    data: {
      category: "image",
      filename: "chan-doan-bucket.png",
      mimeType: "image/png",
      sizeBytes: PNG_1PX.length,
    },
  });
  const text = await res.text();
  console.log(`[ADMIN TICKET] HTTP ${res.status()}`);
  let uploadUrl: string | undefined;
  try {
    const j = JSON.parse(text) as { uploadUrl?: string; url?: string; data?: { uploadUrl?: string } };
    uploadUrl = j.uploadUrl ?? j.url ?? j.data?.uploadUrl;
  } catch {
    /* để nguyên */
  }
  if (!uploadUrl) {
    console.log(`[ADMIN TICKET] body: ${text.slice(0, 300)}`);
    await admin.dispose();
    return;
  }
  console.log(`[ADMIN TICKET] host: ${new URL(uploadUrl).host}`);

  const raw = await playwright.request.newContext();
  const put = await raw.put(uploadUrl, {
    headers: { "Content-Type": "image/png" },
    data: PNG_1PX,
  });
  console.log(`[PUT bucket CHUNG] HTTP ${put.status()}`);
  if (!put.ok()) console.log(`   ${(await put.text()).slice(0, 300)}`);

  await raw.dispose();
  await admin.dispose();
});
