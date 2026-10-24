// @vitest-environment node
/**
 * DỊCH PAYLOAD ZALOCRM → việc phải làm. Bộ này canh đúng một tính chất:
 * **KHÔNG BAO GIỜ NÉM** trên dữ liệu lạ.
 *
 * Vì sao đó là tính chất đáng canh nhất: hình dạng payload còn là PHỎNG ĐOÁN.
 * Bản fork (việc F2, repo khác, CHƯA TỒN TẠI) sẽ thêm `zaloAccountId`, `threadId`,
 * `threadType`, `contactId`, `contact.phone`, `sentByExternalId`; bản gốc chưa có
 * mấy trường đó (`docs/tich-hop-zalocrm/01-ban-1-...md` §4.2). Một hàm dịch ném lỗi
 * trên trường thiếu sẽ biến "chưa nâng cấp fork" thành 5xx ⇒ ZaloCRM retry bão một
 * payload không bao giờ xử lý được. Trả `{ok:false, ma}` thì webhook ghi FAILED,
 * người trực thấy đỏ ở màn Tích hợp, và tin không rơi vào hư không.
 *
 * Khi có payload THẬT: sửa BẢNG ÁNH XẠ trong `dich-payload.ts` + fixture ở
 * `__fixtures__/`, KHÔNG sửa chỗ nào khác.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  dichPayloadZalocrm,
  docLoaiSuKien,
  docMaTin,
  NHAN_TIN_KHONG_CHU,
} from "./dich-payload";

const MAU = (ten: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", `${ten}.json`), "utf8"));

/** Bản sao sâu để mỗi ca sửa vài trường mà không đụng ca khác. */
const sao = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const ORG = "cs1";

describe("dichPayloadZalocrm — tin đến (`message.received`)", () => {
  it("[ZC-DP-01] payload đủ trường ⇒ TinDenNgoai đúng từng ô", () => {
    const kq = dichPayloadZalocrm({ payload: MAU("message-received"), orgCode: ORG });
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");

    expect(kq.viec.huong).toBe("DEN");
    expect(kq.viec.tin.channel).toBe("ZALO_CA_NHAN");
    // Khoá hội thoại là `[channel, accountId, externalThreadId]`.
    expect(kq.viec.tin.externalThreadId).toBe("zc-conv-77");
    expect(kq.viec.tin.externalUserId).toBe("1234567890123456789");
    expect(kq.viec.tin.body).toBe("Chào shop, bé nhà mình 8 tuổi học được chưa ạ?");
    expect(kq.viec.tin.sentAt.toISOString()).toBe("2026-09-06T02:00:00.000Z");
    expect(kq.viec.tin.displayName).toBe("Chị Lan");
    // SĐT phải về dạng chuẩn `84…` (không dấu `+`, không `0` đầu) — mọi tra cứu
    // SĐT trong repo đi qua `phoneVariants`, và nó nhận canonical.
    expect(kq.viec.phone).toBe("84912345678");
    expect(kq.viec.zcrmContactId).toBe("zc-ct-9");
    expect(kq.viec.zcrmConversationId).toBe("zc-conv-77");
    // Tin ĐẾN không có người gửi bên mình.
    expect(kq.viec.sentByExternalId).toBeNull();
  });

  it("[ZC-DP-02] channelMessageId mang tiền tố org — `<orgCode>:<messageId>`", () => {
    const kq = dichPayloadZalocrm({ payload: MAU("message-received"), orgCode: ORG });
    if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");
    expect(kq.viec.tin.channelMessageId).toBe("cs1:zc-msg-1001");

    // Vì sao tiền tố là BẮT BUỘC: khoá chống trùng `@@unique([channel, channelMessageId])`
    // KHÔNG kèm accountId. Hai org đánh số tin trùng nhau thì tin của org sau bị
    // `ingest*` trả `duplicate:true` — NUỐT IM LẶNG, không lỗi, không log.
    const org2 = dichPayloadZalocrm({ payload: MAU("message-received"), orgCode: "cs2" });
    if (!org2.ok || org2.viec.loai !== "TIN") throw new Error("phải là việc TIN");
    expect(org2.viec.tin.channelMessageId).not.toBe("cs1:zc-msg-1001");
  });

  it("[ZC-DP-03] accountId = `zaloAccountId` của nick, KHÔNG phải hằng 'zalocrm'", () => {
    const kq = dichPayloadZalocrm({ payload: MAU("message-received"), orgCode: ORG });
    if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");
    // Dùng hằng thì một khách nhắn HAI nick bị gộp thành MỘT hội thoại (khoá hội
    // thoại có accountId trong đó) — sai cả lịch sử lẫn cách ly cơ sở.
    expect(kq.viec.tin.accountId).toBe("zc-acc-01");
    expect(kq.viec.tin.accountId).not.toBe("zalocrm");
    expect(kq.viec.zcrmAccountId).toBe("zc-acc-01");
  });

  it("[ZC-DP-04] thiếu messageId ⇒ {ok:false}, KHÔNG bịa khoá chống trùng", () => {
    const p = sao(MAU("message-received"));
    delete (p.data as Record<string, unknown>).messageId;
    const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
    expect(kq.ok).toBe(false);
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("THIEU_MESSAGE_ID");
    expect(kq.thongDiep.length).toBeGreaterThan(0);
  });

  it("[ZC-DP-05] hội thoại NHÓM ⇒ BỎ QUA (chốt 9.6 — loại hẳn)", () => {
    // Luật chat #6: tin của phụ huynh này không bao giờ vào payload phụ huynh khác.
    // Hội thoại nhóm không tách được người, nên không ingest — và đây KHÔNG phải lỗi,
    // nên webhook phải PROCESSED chứ không FAILED (retry không giúp gì).
    for (const gt of ["group", "Group", "GROUP", 1]) {
      const p = sao(MAU("message-received"));
      (p.data as Record<string, unknown>).threadType = gt;
      const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
      expect(kq.ok, `threadType=${String(gt)}`).toBe(true);
      if (!kq.ok) throw new Error("phải ok");
      expect(kq.viec.loai).toBe("BO_QUA");
      if (kq.viec.loai !== "BO_QUA") throw new Error("phải BO_QUA");
      expect(kq.viec.lyDo).toBe("HOI_THOAI_NHOM");
    }
  });

  it("bản GỐC (chưa fork) thiếu `zaloAccountId` ⇒ {ok:false} có mã, không ném", () => {
    const kq = dichPayloadZalocrm({ payload: MAU("message-received-ban-goc"), orgCode: ORG });
    expect(kq.ok).toBe(false);
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("THIEU_ZALO_ACCOUNT_ID");
    // Thông điệp phải chỉ ra việc phải làm ở bên kia, không phải một câu chung chung.
    expect(kq.thongDiep).toMatch(/zaloAccountId/);
  });

  it("thiếu `conversationId` ⇒ {ok:false} — không có khoá hội thoại thì không ingest", () => {
    const p = sao(MAU("message-received"));
    delete (p.data as Record<string, unknown>).conversationId;
    const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
    expect(kq.ok).toBe(false);
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("THIEU_CONVERSATION_ID");
  });

  it("thiếu SĐT (bản gốc không kèm) ⇒ vẫn dịch được, `phone` = null", () => {
    const p = sao(MAU("message-received"));
    delete (p.data as Record<string, unknown>).contact;
    const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
    expect(kq.ok).toBe(true);
    if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");
    // Không có SĐT là trạng thái BÌNH THƯỜNG — hội thoại về ở dạng mồ côi.
    expect(kq.viec.phone).toBeNull();
  });

  it("SĐT rác trong payload ⇒ null, không đổ chuỗi lạ vào đường nối lead", () => {
    const p = sao(MAU("message-received"));
    (p.data as Record<string, unknown>).contact = { phone: "02363 888 999" };
    const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
    if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");
    expect(kq.viec.phone).toBeNull();
  });

  it("tin KHÔNG có chữ (ảnh/sticker/tệp) ⇒ body là NHÃN, không phải chuỗi rỗng", () => {
    const p = sao(MAU("message-received"));
    (p.data as Record<string, unknown>).contentType = "image";
    (p.data as Record<string, unknown>).content = "";
    const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
    if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");
    expect(kq.viec.tin.body).toBe(NHAN_TIN_KHONG_CHU);
    // Đính kèm KHÔNG kéo về (chốt phạm vi) — chỉ giữ loại nội dung để hiện nhãn.
    expect(JSON.stringify(kq.viec.tin.attachments ?? {})).not.toMatch(/http/);
  });

  it("`sentAt` nhận epoch giây và epoch mili, không chỉ ISO", () => {
    for (const [gt, iso] of [
      [1788660000, "2026-09-06T02:00:00.000Z"],
      [1788660000000, "2026-09-06T02:00:00.000Z"],
    ] as const) {
      const p = sao(MAU("message-received"));
      (p.data as Record<string, unknown>).sentAt = gt;
      const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
      if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");
      expect(kq.viec.tin.sentAt.toISOString()).toBe(iso);
    }
  });

  it("`sentAt` hỏng ⇒ {ok:false} — KHÔNG lấy `Date.now()` thay thế", () => {
    // Lấy giờ máy thay cho giờ tin là làm hỏng `awaitingReply` và mọi báo cáo SLA:
    // tin đến trễ sẽ trông như vừa đến, và "khách chờ 3 tiếng" biến mất.
    const p = sao(MAU("message-received"));
    (p.data as Record<string, unknown>).sentAt = "hôm qua";
    const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
    expect(kq.ok).toBe(false);
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("THIEU_THOI_DIEM");
  });
});

describe("dichPayloadZalocrm — tin đi (`message.sent`)", () => {
  it("externalUserId lấy từ `threadId` (KHÁCH), KHÔNG phải `senderUid` (nick mình)", () => {
    const kq = dichPayloadZalocrm({ payload: MAU("message-sent"), orgCode: ORG });
    if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");
    expect(kq.viec.huong).toBe("DI");
    // `senderUid` của tin ĐI là UID nick CỦA MÌNH. Lấy nó làm `externalUserId` là đẻ
    // ra một `InboxIdentity` mang danh chính nhân viên, và hội thoại của khách tách
    // làm đôi — lỗi này không văng ra đâu cả, chỉ thấy khi đọc lại lịch sử.
    expect(kq.viec.tin.externalUserId).toBe("1234567890123456789");
    expect(kq.viec.tin.externalUserId).not.toBe("9999999999999999999");
    expect(kq.viec.tin.externalThreadId).toBe("zc-conv-77");
  });

  it("KHÔNG lấy `senderName` của tin ĐI làm displayName — đó là tên nhân viên", () => {
    const kq = dichPayloadZalocrm({ payload: MAU("message-sent"), orgCode: ORG });
    if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");
    // `ingest*` upsert `displayName` lên chính danh tính KHÁCH. Ghi tên nhân viên vào
    // đó là đổi tên khách thành tên Sale trong toàn bộ hộp thư.
    expect(kq.viec.tin.displayName).not.toBe("Sata Robo CS1");
    expect(kq.viec.tin.displayName).toBe("Chị Lan");
  });

  it("đọc `sentByExternalId` — nguồn DUY NHẤT để quy tin về một `User` Sata", () => {
    const kq = dichPayloadZalocrm({ payload: MAU("message-sent"), orgCode: ORG });
    if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");
    expect(kq.viec.sentByExternalId).toBe("usr-sale-cs1");
    expect(kq.viec.noiDung).toBe("Dạ bé 8 tuổi học lớp Sata 2 ạ.");
  });

  it("tin ĐI thiếu `threadId` (bản gốc) ⇒ {ok:false}, KHÔNG rơi về senderUid", () => {
    const p = sao(MAU("message-sent"));
    delete (p.data as Record<string, unknown>).threadId;
    const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
    expect(kq.ok).toBe(false);
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("THIEU_NGUOI_NHAN");
  });
});

describe("dichPayloadZalocrm — sự kiện khác", () => {
  it("`contact.updated` có SĐT ⇒ việc LIEN_HE, SĐT đã chuẩn hoá", () => {
    const kq = dichPayloadZalocrm({ payload: MAU("contact-updated"), orgCode: ORG });
    expect(kq.ok).toBe(true);
    if (!kq.ok || kq.viec.loai !== "LIEN_HE") throw new Error("phải là việc LIEN_HE");
    expect(kq.viec.zcrmContactId).toBe("zc-ct-9");
    expect(kq.viec.phone).toBe("84912345678");
  });

  it("`contact.updated` KHÔNG đổi SĐT ⇒ BỎ QUA (không có gì để nối lại)", () => {
    const p = sao(MAU("contact-updated"));
    (p.data as Record<string, unknown>).changes = { fullName: { from: "A", to: "B" } };
    delete ((p.data as Record<string, unknown>).contact as Record<string, unknown>).phone;
    const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
    if (!kq.ok) throw new Error("phải ok");
    expect(kq.viec.loai).toBe("BO_QUA");
  });

  it("`zalo.connected` / `zalo.disconnected` ⇒ việc NICK, có mốc thời gian", () => {
    const on = dichPayloadZalocrm({ payload: MAU("zalo-connected"), orgCode: ORG });
    if (!on.ok || on.viec.loai !== "NICK") throw new Error("phải là việc NICK");
    expect(on.viec.zcrmAccountId).toBe("zc-acc-01");
    expect(on.viec.trangThai).toBe("CONNECTED");
    expect(on.viec.luc.toISOString()).toBe("2026-09-06T01:00:00.000Z");

    const p = sao(MAU("zalo-connected"));
    p.event = "zalo.disconnected";
    const off = dichPayloadZalocrm({ payload: p, orgCode: ORG });
    if (!off.ok || off.viec.loai !== "NICK") throw new Error("phải là việc NICK");
    expect(off.viec.trangThai).toBe("DISCONNECTED");
  });

  it("`zalo.connected` không có mốc ⇒ dùng `now` truyền vào (không đoán)", () => {
    const p = sao(MAU("zalo-connected"));
    delete p.timestamp;
    const luc = new Date("2026-01-02T03:04:05.000Z");
    const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG, now: luc });
    if (!kq.ok || kq.viec.loai !== "NICK") throw new Error("phải là việc NICK");
    expect(kq.viec.luc.toISOString()).toBe(luc.toISOString());
  });

  it("sự kiện đã biết mà không cần làm gì (`contact.created`, `friend.*`, `webhook.test`) ⇒ BỎ QUA", () => {
    for (const ev of ["contact.created", "friend.request", "webhook.test", "khong-biet.la"]) {
      const kq = dichPayloadZalocrm({ payload: { event: ev, data: {} }, orgCode: ORG });
      expect(kq.ok, ev).toBe(true);
      if (!kq.ok) throw new Error("phải ok");
      expect(kq.viec.loai).toBe("BO_QUA");
    }
  });

  it("tên sự kiện lấy từ header `X-Webhook-Event` khi payload không mang `event`", () => {
    const p = sao(MAU("message-received"));
    delete p.event;
    const kq = dichPayloadZalocrm({
      payload: p,
      orgCode: ORG,
      tenSuKienHeader: "message.received",
    });
    if (!kq.ok || kq.viec.loai !== "TIN") throw new Error("phải là việc TIN");
    expect(kq.viec.tin.channelMessageId).toBe("cs1:zc-msg-1001");
  });

  it("không có tên sự kiện ở đâu cả ⇒ {ok:false} THIEU_SU_KIEN", () => {
    const p = sao(MAU("message-received"));
    delete p.event;
    const kq = dichPayloadZalocrm({ payload: p, orgCode: ORG });
    expect(kq.ok).toBe(false);
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("THIEU_SU_KIEN");
  });
});

describe("KHÔNG BAO GIỜ NÉM — đây là tính chất, không phải chi tiết", () => {
  const RAC: unknown[] = [
    null,
    undefined,
    0,
    "",
    "một chuỗi",
    [],
    [1, 2, 3],
    {},
    { event: 1, data: 2 },
    { event: "message.received" },
    { event: "message.received", data: null },
    { event: "message.received", data: [] },
    { event: "message.received", data: { messageId: {}, contact: "x" } },
    { event: "zalo.connected", data: {} },
  ];

  it("mọi payload rác đều trả kết quả có hình dạng, không ném", () => {
    for (const p of RAC) {
      const chay = () => dichPayloadZalocrm({ payload: p, orgCode: ORG });
      expect(chay, JSON.stringify(p ?? null)).not.toThrow();
      const kq = chay();
      expect(typeof kq.ok).toBe("boolean");
      if (!kq.ok) expect(typeof kq.ma).toBe("string");
    }
  });

  it("`docMaTin` trả mã tin hoặc null — dùng làm `WebhookDelivery.externalId`", () => {
    expect(docMaTin(MAU("message-received"))).toBe("zc-msg-1001");
    for (const p of RAC) expect(() => docMaTin(p)).not.toThrow();
    expect(docMaTin("rác")).toBeNull();
    expect(docMaTin({ event: "zalo.connected", data: {} })).toBeNull();
  });

  it("`docLoaiSuKien` không ném và ưu tiên payload hơn header", () => {
    expect(docLoaiSuKien(MAU("message-received"), "zalo.connected")).toBe("message.received");
    expect(docLoaiSuKien({}, "zalo.connected")).toBe("zalo.connected");
    expect(docLoaiSuKien(null, null)).toBeNull();
  });

  it("orgCode rỗng ⇒ {ok:false} — tiền tố rỗng là mất chống trùng theo org", () => {
    const kq = dichPayloadZalocrm({ payload: MAU("message-received"), orgCode: "" });
    expect(kq.ok).toBe(false);
    if (kq.ok) throw new Error("phải hỏng");
    expect(kq.ma).toBe("THIEU_ORG");
  });
});
