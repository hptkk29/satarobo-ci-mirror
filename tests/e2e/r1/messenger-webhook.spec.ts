/**
 * R1-02 — Webhook Messenger: verify chữ ký + ingest idempotent + GET challenge. PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "../../../lib/db";
import { resetDb } from "../../e2e/_helpers/seed";
import { handleMessengerWebhook } from "../../../lib/crm/meta-webhook";
import { GET } from "../../../app/api/webhooks/meta/messenger/route";

const SECRET = "test-app-secret";
const payload = {
  object: "page",
  entry: [
    {
      id: "PAGE1",
      messaging: [
        { sender: { id: "PSID1" }, recipient: { id: "PAGE1" }, timestamp: 1700000000000, message: { mid: "mid-1", text: "xin chào" } },
      ],
    },
  ],
};
const sign = (raw: string) => "sha256=" + crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");

test.describe("[R1-02] Messenger webhook", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R1-02-C2.3] chữ ký hợp lệ → tạo conversation + message (L1)", async () => {
    const raw = JSON.stringify(payload);
    const r = await handleMessengerWebhook({ rawBody: raw, signatureHeader: sign(raw), appSecret: SECRET });
    expect(r.status).toBe(200);
    expect(r.created).toBe(1);
    const conv = await db.messengerConversation.findFirst({ where: { pageId: "PAGE1", psid: "PSID1" } });
    expect(conv).not.toBeNull();
    expect(await db.messengerMessage.count({ where: { conversationId: conv!.id } })).toBe(1);
  });

  test("[R1-02-C2.2] chữ ký sai → 401, KHÔNG tạo dữ liệu", async () => {
    const raw = JSON.stringify(payload);
    const r = await handleMessengerWebhook({ rawBody: raw, signatureHeader: "sha256=bad", appSecret: SECRET });
    expect(r.status).toBe(401);
    expect(await db.messengerConversation.count()).toBe(0);
  });

  test("[R1-02-C2.4] cùng mid gửi lại → KHÔNG tạo trùng (idempotent)", async () => {
    const raw = JSON.stringify(payload);
    await handleMessengerWebhook({ rawBody: raw, signatureHeader: sign(raw), appSecret: SECRET });
    const r2 = await handleMessengerWebhook({ rawBody: raw, signatureHeader: sign(raw), appSecret: SECRET });
    expect(r2.created).toBe(0);
    expect(await db.messengerMessage.count()).toBe(1);
  });

  test("[R1-02-C2.5] payload hợp lệ luôn trả 200", async () => {
    const raw = JSON.stringify(payload);
    const r = await handleMessengerWebhook({ rawBody: raw, signatureHeader: sign(raw), appSecret: SECRET });
    expect(r.status).toBe(200);
  });

  test("[R1-02-C2.1] GET verify challenge trả đúng hub.challenge", async () => {
    process.env.WEBHOOK_FACEBOOK_VERIFY_TOKEN = "verify-tok";
    const ok = new NextRequest(
      "http://localhost/api/webhooks/meta/messenger?hub.mode=subscribe&hub.verify_token=verify-tok&hub.challenge=12345",
    );
    const res = await GET(ok);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");

    const bad = new NextRequest(
      "http://localhost/api/webhooks/meta/messenger?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345",
    );
    expect((await GET(bad)).status).toBe(403);
  });
});
