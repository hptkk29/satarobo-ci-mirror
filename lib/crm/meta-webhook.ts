// lib/crm/meta-webhook.ts — R1-02: xử lý webhook Messenger của Meta (SR.QD.217).
// Verify X-Hub-Signature-256 (HMAC App Secret) + parse payload + ingest (idempotent mid).
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { recordIncomingMessage } from "@/lib/crm/messenger-service";

/** Verify chữ ký Meta `sha256=<hmac>` bằng App Secret (timing-safe). THUẦN. */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string | undefined,
): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type MessengerEvent = {
  pageId: string;
  psid: string;
  text: string | null;
  mid: string | null;
  sentAt: Date;
};

/** Trích các sự kiện tin nhắn từ payload Meta (object=page). THUẦN. */
export function parseMessengerEvents(body: unknown): MessengerEvent[] {
  const out: MessengerEvent[] = [];
  if (!body || typeof body !== "object") return out;
  const b = body as { object?: string; entry?: unknown[] };
  if (b.object !== "page" || !Array.isArray(b.entry)) return out;
  for (const entryRaw of b.entry) {
    const entry = entryRaw as { id?: string; messaging?: unknown[] };
    const pageId = entry.id ?? "";
    if (!Array.isArray(entry.messaging)) continue;
    for (const mRaw of entry.messaging) {
      const m = mRaw as {
        sender?: { id?: string };
        timestamp?: number;
        message?: { mid?: string; text?: string; is_echo?: boolean };
      };
      const psid = m.sender?.id;
      if (!psid || !m.message) continue; // bỏ qua event không phải tin nhắn (delivery/read...)
      // S-2b (27/08/2026) — BỎ QUA ECHO CỦA CHÍNH MÌNH.
      // Từ khi hệ thống gửi được tin ra Meta (`lib/crm/messenger-send.ts`), Meta bắn lại
      // mỗi tin ta gửi dưới dạng `message.is_echo = true`, và trong event đó `sender.id`
      // là PAGE ID chứ không phải PSID khách. Nhận nó vào sẽ đẻ một hội thoại ma mang
      // `psid = pageId`, set `firstMessageAt` cho nó, rồi `lib/crm/sla.ts` bật cảnh báo
      // SLA-0 "chưa ai trả lời" cho một hội thoại không có khách nào.
      if (m.message.is_echo) continue;
      out.push({
        pageId,
        psid,
        text: m.message.text ?? null,
        mid: m.message.mid ?? null,
        sentAt: m.timestamp ? new Date(m.timestamp) : new Date(),
      });
    }
  }
  return out;
}

/**
 * Xử lý 1 POST webhook: verify chữ ký → parse → ghi conversation/message (idempotent mid).
 * Luôn 200 cho payload hợp lệ (C2.5 — Meta không retry bão); chữ ký sai → 401 (C2.2).
 */
export async function handleMessengerWebhook(input: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  appSecret: string | undefined;
  now?: Date;
}): Promise<{ status: number; created: number }> {
  if (!verifyMetaSignature(input.rawBody, input.signatureHeader, input.appSecret)) {
    return { status: 401, created: 0 };
  }
  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, created: 0 };
  }

  // Log MỌI payload hợp lệ (R1-11 dùng lại để replay — kể cả khi xử lý lỗi).
  const events0 = parseMessengerEvents(body);
  const delivery = await db.webhookDelivery.create({
    data: {
      source: "facebook-messenger",
      externalId: events0[0]?.mid ?? null,
      payload: body as object,
      status: "RECEIVED",
    },
  });

  try {
    const created = await ingestMessengerEvents(body);
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    return { status: 200, created };
  } catch (e) {
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", errorMessage: String(e).slice(0, 1000) },
    });
    return { status: 200, created: 0 }; // vẫn 200 với Meta; đã lưu FAILED để replay (C11.1)
  }
}

/** Parse + ghi tin nhắn (idempotent mid). Tách để replay (R1-11) tái dùng. */
export async function ingestMessengerEvents(body: unknown): Promise<number> {
  const events = parseMessengerEvents(body);
  let created = 0;
  for (const ev of events) {
    const r = await recordIncomingMessage({
      pageId: ev.pageId,
      psid: ev.psid,
      text: ev.text,
      sentAt: ev.sentAt,
      externalEventId: ev.mid, // idempotent (C2.4 / C11.3)
    });
    if (!r.deduped) created++;
  }
  return created;
}
