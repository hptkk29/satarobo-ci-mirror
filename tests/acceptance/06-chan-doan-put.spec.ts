/**
 * Chẩn đoán tầng thấp: PUT thẳng lên R2 bằng URL ký sẵn, KHÔNG qua trình duyệt.
 * Không có CORS ở đây, nên R2 trả gì thì ta thấy nguyên văn — đây là cách duy nhất
 * đọc được lý do thật khi trình duyệt cứ báo "No 'Access-Control-Allow-Origin'".
 */
import { test } from "@playwright/test";
import { readSeed, storageStateFile } from "./_fixtures";

const seed = readSeed();
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("chẩn đoán · PUT lên R2 bằng URL ký sẵn, không qua trình duyệt", async ({ playwright }) => {
  const api = await playwright.request.newContext({
    baseURL: seed.baseURL,
    storageState: storageStateFile("ph1"),
  });
  const res = await api.post("/api/chat/upload-url", {
    data: {
      conversationId: seed.conversations.lopA,
      files: [
        {
          fileName: "chan-doan-put.png",
          mimeType: "image/png",
          sizeBytes: PNG_1PX.length,
          headBase64: PNG_1PX.subarray(0, 16).toString("base64"),
        },
      ],
    },
  });
  const body = (await res.json()) as {
    ok: boolean;
    data?: { files: { uploadUrl: string; storagePath: string }[] };
  };
  const uploadUrl = body.data?.files[0]?.uploadUrl;
  console.log(`[TICKET] HTTP ${res.status()} · có uploadUrl: ${Boolean(uploadUrl)}`);
  if (!uploadUrl) {
    console.log(`[TICKET] body: ${JSON.stringify(body).slice(0, 400)}`);
    await api.dispose();
    return;
  }
  console.log(`[TICKET] query: ${uploadUrl.split("?")[1]?.replace(/X-Amz-Signature=[^&]+/, "X-Amz-Signature=***")}`);

  const raw = await playwright.request.newContext();

  // 1) Y HỆT trình duyệt: PUT kèm Content-Type
  const withCt = await raw.put(uploadUrl, {
    headers: { "Content-Type": "image/png" },
    data: PNG_1PX,
  });
  console.log(`[PUT kèm Content-Type] HTTP ${withCt.status()}`);
  if (!withCt.ok()) console.log(`   ${(await withCt.text()).slice(0, 400)}`);

  // 2) Đối chứng: PUT KHÔNG kèm Content-Type — tách bạch "ký sai" với "header thừa"
  const noCt = await raw.put(uploadUrl, { data: PNG_1PX });
  console.log(`[PUT KHÔNG Content-Type] HTTP ${noCt.status()}`);
  if (!noCt.ok()) console.log(`   ${(await noCt.text()).slice(0, 400)}`);

  await raw.dispose();
  await api.dispose();
});
