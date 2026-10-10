// R1-02 — verify chữ ký + parse payload (THUẦN). Pure.
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyMetaSignature, parseMessengerEvents } from "@/lib/crm/meta-webhook";

const SECRET = "test-app-secret";
const sign = (raw: string) =>
  "sha256=" + crypto.createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");

describe("[R1-02] verifyMetaSignature", () => {
  it("[R1-02-C2.2] chữ ký đúng → true; sai/thiếu → false", () => {
    const raw = '{"a":1}';
    expect(verifyMetaSignature(raw, sign(raw), SECRET)).toBe(true);
    expect(verifyMetaSignature(raw, "sha256=deadbeef", SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, sign(raw), undefined)).toBe(false);
  });
});

describe("[R1-02] parseMessengerEvents", () => {
  it("trích đúng event tin nhắn", () => {
    const body = {
      object: "page",
      entry: [
        { id: "PAGE1", messaging: [{ sender: { id: "PSID1" }, timestamp: 1700000000000, message: { mid: "m1", text: "hi" } }] },
      ],
    };
    const ev = parseMessengerEvents(body);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ pageId: "PAGE1", psid: "PSID1", text: "hi", mid: "m1" });
  });

  it("bỏ qua event không phải tin nhắn + payload không hợp lệ", () => {
    expect(parseMessengerEvents({ object: "page", entry: [{ id: "P", messaging: [{ sender: { id: "x" }, delivery: {} }] }] })).toEqual([]);
    expect(parseMessengerEvents({ object: "instagram" })).toEqual([]);
    expect(parseMessengerEvents(null)).toEqual([]);
  });
});

// ─── S-2b (27/08/2026) — ECHO của chính mình ────────────────────────────────
// Từ khi hệ thống GỬI được tin ra Meta (`lib/crm/messenger-send.ts`), Meta bắn lại
// mỗi tin ta gửi dưới dạng event `message.is_echo = true`, và trong event đó
// `sender.id` là **PAGE ID**, không phải PSID khách. Bản parse cũ nhận mọi event có
// `message` + `sender.id` ⇒ tin ta vừa gửi quay về thành tin ĐẾN của một "khách" mang
// psid = pageId: đẻ hội thoại ma, set `firstMessageAt` cho nó, và `lib/crm/sla.ts`
// bật cảnh báo SLA-0 "chưa ai trả lời" cho một hội thoại không có khách nào.
describe("[S-2b] parseMessengerEvents — echo tin của chính mình", () => {
  const echo = {
    object: "page",
    entry: [
      {
        id: "PAGE1",
        messaging: [
          {
            sender: { id: "PAGE1" },
            recipient: { id: "PSID1" },
            timestamp: 1700000000000,
            message: { mid: "m-echo", text: "Dạ em chào chị", is_echo: true },
          },
        ],
      },
    ],
  };

  it("bỏ qua event echo — không được biến tin GỬI ĐI thành tin ĐẾN", () => {
    expect(parseMessengerEvents(echo)).toEqual([]);
  });

  it("tin khách thật trong cùng lô vẫn được nhận", () => {
    const lo = {
      object: "page",
      entry: [
        {
          id: "PAGE1",
          messaging: [
            echo.entry[0]!.messaging[0]!,
            { sender: { id: "PSID1" }, timestamp: 1700000001000, message: { mid: "m2", text: "dạ" } },
          ],
        },
      ],
    };
    const ev = parseMessengerEvents(lo);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ psid: "PSID1", mid: "m2" });
  });
});
