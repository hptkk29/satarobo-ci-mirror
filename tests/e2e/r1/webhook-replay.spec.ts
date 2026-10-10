/**
 * R1-11 — WebhookDelivery log + replay (OI-20). PG LOCAL.
 */
import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import { db } from "../../../lib/db";
import { resetDb } from "../../e2e/_helpers/seed";
import { handleMessengerWebhook } from "../../../lib/crm/meta-webhook";
import { replayDelivery, getFailedDeliveries } from "../../../lib/crm/webhook-replay";

const SECRET = "test-app-secret";
const payload = {
  object: "page",
  entry: [{ id: "PAGE1", messaging: [{ sender: { id: "PSID9" }, timestamp: 1700000000000, message: { mid: "mid-rp", text: "replay" } }] }],
};
const sign = (raw: string) => "sha256=" + crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");

test.describe("[R1-11] Webhook replay", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[R1-11-C11.1] webhook hợp lệ → lưu WebhookDelivery (PROCESSED)", async () => {
    const raw = JSON.stringify(payload);
    await handleMessengerWebhook({ rawBody: raw, signatureHeader: sign(raw), appSecret: SECRET });
    const d = await db.webhookDelivery.findFirst({ where: { source: "facebook-messenger" } });
    expect(d?.status).toBe("PROCESSED");
    expect(d?.externalId).toBe("mid-rp");
  });

  test("[R1-11-C11.2] replay 1 delivery FAILED → xử lý lại, tạo conversation", async () => {
    const d = await db.webhookDelivery.create({
      data: { source: "facebook-messenger", externalId: "mid-rp", payload, status: "FAILED" },
    });
    expect((await getFailedDeliveries()).some((x) => x.id === d.id)).toBe(true);

    const r = await replayDelivery(d.id);
    expect(r.created).toBe(1);
    expect(await db.messengerConversation.count({ where: { pageId: "PAGE1", psid: "PSID9" } })).toBe(1);
    const after = await db.webhookDelivery.findUnique({ where: { id: d.id } });
    expect(after?.status).toBe("PROCESSED");
    expect(after?.retryCount).toBe(1);
  });

  test("[R1-11-C11.3] replay trùng (cùng mid) → không tạo message trùng (idempotent)", async () => {
    const d1 = await db.webhookDelivery.create({ data: { source: "facebook-messenger", payload, status: "FAILED" } });
    const d2 = await db.webhookDelivery.create({ data: { source: "facebook-messenger", payload, status: "FAILED" } });
    await replayDelivery(d1.id);
    const r2 = await replayDelivery(d2.id); // cùng mid → dedupe
    expect(r2.created).toBe(0);
    expect(await db.messengerMessage.count({ where: { externalEventId: "mid-rp" } })).toBe(1);
  });
});
