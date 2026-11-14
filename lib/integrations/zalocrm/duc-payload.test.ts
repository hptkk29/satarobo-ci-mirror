// @vitest-environment node
/**
 * ĐỤC PII TRƯỚC KHI GHI `WebhookDelivery`.
 *
 * 🔴 VÌ SAO PHẢI VIẾT MỚI: `logWebhookDelivery` (`lib/lead/webhook.ts`) ghi payload
 * NGUYÊN VĂN, và trong repo KHÔNG tồn tại hàm đục nào cho payload webhook —
 * `redactContactsInText` (`lib/lead/pii.ts`) chỉ đục SĐT/email TRONG một chuỗi và
 * chỉ được dùng ở tầng ĐỌC của hộp thư.
 *
 * Hậu quả nếu bỏ bước này: nội dung chat của phụ huynh (kèm SĐT khách tự gõ trong
 * câu) nằm plaintext trong một bảng KHÔNG có TTL, KHÔNG cách ly cơ sở, và màn
 * "Webhook lỗi — Replay" mở cho bất kỳ ai có `settings:edit`.
 *
 * Điều phải GIỮ: mã tin / mã hội thoại / mã nick / orgCode — không có chúng thì
 * bảng này hết tác dụng đối soát, mà đối soát là lý do duy nhất nó tồn tại.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { DA_DUC, ducNoiDung, ducPayload } from "./duc-payload";

const MAU = (ten: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", `${ten}.json`), "utf8"));

const NOI_DUNG = "Chào shop, bé nhà mình 8 tuổi học được chưa ạ?";
const SDT = "0912345678";

describe("ducPayload", () => {
  it("[ZC-DU-01] `content` bị thay bằng { len, sha256 } — không còn nguyên văn", () => {
    const ra = ducPayload(MAU("message-received")) as Record<string, Record<string, unknown>>;
    const noiDung = ra.data.content as { len: number; sha256: string };

    expect(noiDung).toEqual({
      len: NOI_DUNG.length,
      sha256: createHash("sha256").update(NOI_DUNG, "utf8").digest("hex"),
    });
    // Kiểm trên CHUỖI JSON của cả object chứ không từng field: che một field mà sót
    // một field khác là bịt cửa trước mở cửa sau (bài học `lib/inbox/view.test.ts`).
    expect(JSON.stringify(ra)).not.toContain(NOI_DUNG);
  });

  it("[ZC-DU-02] `contact.phone` bị đục", () => {
    const ra = ducPayload(MAU("message-received"));
    expect(JSON.stringify(ra)).not.toContain(SDT);
    // Cả dạng canonical `84…` cũng không được lọt.
    expect(JSON.stringify(ra)).not.toContain("84912345678");
    const contact = (ra as Record<string, Record<string, Record<string, unknown>>>).data.contact;
    expect(contact.phone).toBe(DA_DUC);
  });

  it("[ZC-DU-03] messageId / conversationId / threadId / orgCode GIỮ NGUYÊN để đối soát", () => {
    const ra = ducPayload(MAU("message-received")) as Record<string, unknown>;
    const data = ra.data as Record<string, unknown>;
    expect(ra.event).toBe("message.received");
    expect(ra.orgCode).toBe("cs1");
    expect(data.messageId).toBe("zc-msg-1001");
    expect(data.conversationId).toBe("zc-conv-77");
    expect(data.threadId).toBe("1234567890123456789");
    expect(data.threadType).toBe("user");
    expect(data.zaloAccountId).toBe("zc-acc-01");
    expect(data.contactId).toBe("zc-ct-9");
    expect(data.contentType).toBe("text");
    expect(data.sentAt).toBe("2026-09-06T02:00:00.000Z");
  });

  it("tên người và email cũng bị đục — không chỉ SĐT", () => {
    // `WebhookDelivery` hiện với MỌI cơ sở cho ai có `settings:edit`. Tên phụ huynh là
    // dữ liệu cá nhân y như số máy; giữ lại "cho dễ nhìn" là giữ lại đúng thứ không
    // được phép nhìn.
    const ra = JSON.stringify(ducPayload(MAU("contact-updated")));
    expect(ra).not.toContain("Chị Lan");
    expect(ra).not.toContain("lan@example.com");
    expect(ra).toContain("zc-ct-9"); // mã liên hệ thì giữ
  });

  it("SĐT nằm SÂU trong `changes` cũng bị đục", () => {
    const ra = JSON.stringify(ducPayload(MAU("contact-updated")));
    expect(ra).not.toContain(SDT);
  });

  it("cùng nội dung ⇒ cùng sha256; khác nội dung ⇒ khác — đối soát được mà không lộ chữ", () => {
    const a = ducNoiDung("xin chào");
    const b = ducNoiDung("xin chào");
    const c = ducNoiDung("xin chào!");
    expect(a).toEqual(b);
    expect(a.sha256).not.toBe(c.sha256);
    expect(a.len).toBe(8);
  });

  it("`senderName` của tin ĐI (tên nhân viên) cũng bị đục", () => {
    const ra = JSON.stringify(ducPayload(MAU("message-sent")));
    expect(ra).not.toContain("Sata Robo CS1");
    expect(ra).toContain("usr-sale-cs1"); // định danh nhân viên thì GIỮ để quy trách nhiệm
  });

  it("không ném với payload rác, và luôn trả thứ `JSON.stringify` được", () => {
    for (const p of [null, undefined, 0, "", "chuỗi", [], [{ content: "bí mật" }], { a: { b: { c: {} } } }]) {
      expect(() => ducPayload(p)).not.toThrow();
      expect(() => JSON.stringify(ducPayload(p))).not.toThrow();
    }
    expect(JSON.stringify(ducPayload([{ content: "bí mật" }]))).not.toContain("bí mật");
  });

  it("payload lồng quá sâu / mảng quá dài bị CẮT, không đệ quy vô hạn", () => {
    // Bên gửi là máy chủ của người khác. Một payload lồng 10.000 tầng làm hàm đục
    // tràn ngăn xếp ⇒ 5xx ⇒ ZaloCRM retry ⇒ vòng lặp. Cắt là bảo vệ chính mình.
    let sau: Record<string, unknown> = { content: "đáy" };
    for (let i = 0; i < 200; i++) sau = { lop: sau };
    expect(() => ducPayload(sau)).not.toThrow();

    const dai = { data: { items: Array.from({ length: 5_000 }, (_, i) => ({ content: `x${i}` })) } };
    const ra = JSON.stringify(ducPayload(dai));
    expect(ra.length).toBeLessThan(60_000);
    expect(ra).not.toContain("x4999");
  });

  it("chuỗi lạ quá dài bị cắt — không nuốt nguyên body của người lạ", () => {
    const ra = ducPayload({ event: "webhook.test", data: { ghiChu: "z".repeat(10_000) } });
    expect(JSON.stringify(ra).length).toBeLessThan(1_000);
  });
});
