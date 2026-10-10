// @vitest-environment node
/**
 * HỘP THƯ ĐA KÊNH — tầng DB thật (Postgres LOCAL).
 *
 * Bốn nhóm dưới đây là bốn chỗ mà một lỗi KHÔNG văng ra ngoài, chỉ lộ khi có người
 * khiếu nại:
 *   1. Webhook retry đẻ tin trùng + thổi phồng số tin chưa đọc.
 *   2. Hội thoại mồ côi biến mất khỏi mắt người phải xử lý nó.
 *   3. Nối lead xong mà cách ly cơ sở KHÔNG bật lên (hoặc bật nhầm).
 *   4. Gửi hụt mà hệ thống ghi là đã trả lời — tắt đồng hồ SLA của một khách chưa
 *      ai trả lời. Đây đúng là lỗi đã sống nhiều tháng ở module Messenger.
 *
 * ⚠️ Bộ này TỰ SKIP khi không có Postgres local. Thấy SKIP trong log nghĩa là CHƯA
 * KIỂM ĐƯỢC GÌ, không phải "xanh".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { RUN_DB_TESTS } from "../_helpers/db-gate";

const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
// 16/09/2026 — dùng CỔNG DUY NHẤT `RUN_DB_TESTS` (tests/_helpers/db-gate.ts) thay cho
// biểu thức chép tay. Bản chép tay chỉ hỏi "URL có trỏ Postgres cục bộ không" nên BỎ MẤT
// cờ `ALLOW_DB_RESET` — đúng cái chốt dựng sau sự cố mất DB 04/09/2026. Hệ quả đo được:
// trên máy dev (DATABASE_URL = 127.0.0.1/satarobo_local) các bộ này CHẠY THẬT trên DB
// đang làm việc, nên `pnpm test:unit` lúc xanh lúc đỏ tuỳ thứ tự, còn `assertTestDb()`
// thì từ chối dọn ⇒ đỏ câm không liên quan gì tới mã.
const RUN = RUN_DB_TESTS;

if (!RUN) {
  console.warn("[hop-thu] SKIP: DATABASE_URL không trỏ Postgres local.");
}

const db = new PrismaClient();

/**
 * Migration `20260827120000_hop_thu_da_kenh` CHƯA được chạy ở môi trường nào (luật
 * cứng Nền Hệ thống #4 — người vận hành chạy tay). Nếu bảng chưa có thì bộ này phải
 * SKIP kèm câu chỉ việc, chứ không đổ một đống `P2021: table does not exist` khiến
 * người đọc log tưởng code hỏng.
 */
const CO_BANG =
  RUN &&
  (await db.inboxConversation
    .count()
    .then(() => true)
    .catch(() => {
      console.warn(
        "[hop-thu] SKIP: chưa có bảng Inbox*. Chạy `npx prisma migrate deploy` " +
          "trên DB test trước (migration 20260827120000_hop_thu_da_kenh).",
      );
      return false;
    }));
/** Tiền tố cố định để dọn theo TIỀN TỐ — bộ này chạy chung DB, KHÔNG `resetDb()`. */
const P = "HTDK_";
const OA = `${P}oa1`;
const LUC = new Date("2026-08-27T02:00:00.000Z");

async function purge() {
  const hoi = await db.inboxConversation.findMany({
    where: { accountId: { startsWith: P } },
    select: { id: true },
  });
  if (hoi.length) {
    await db.inboxMessage.deleteMany({ where: { conversationId: { in: hoi.map((h) => h.id) } } });
    await db.inboxConversation.deleteMany({ where: { id: { in: hoi.map((h) => h.id) } } });
  }
  await db.inboxIdentity.deleteMany({ where: { accountId: { startsWith: P } } });
  await db.lead.deleteMany({ where: { parentName: { startsWith: P } } });
}

describe.skipIf(!CO_BANG)("hộp thư đa kênh — tầng DB", () => {
  beforeAll(purge);
  afterAll(async () => {
    await purge();
    await db.$disconnect();
  });
  beforeEach(purge);

  // ── 1. Chống trùng ────────────────────────────────────────────────────────
  describe("webhook gửi lại cùng một tin", () => {
    it("[HT-01] cùng `channelMessageId` ⇒ KHÔNG tạo tin thứ hai", async () => {
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const tin = {
        channel: "ZALO_OA" as const,
        accountId: OA,
        externalUserId: "u-1",
        channelMessageId: `${P}msg-1`,
        body: "chào shop",
        sentAt: LUC,
      };
      const lan1 = await ingestInboundMessage(tin);
      const lan2 = await ingestInboundMessage(tin);

      expect(lan1.duplicate).toBe(false);
      expect(lan2.duplicate).toBe(true);
      expect(lan2.conversationId).toBe(lan1.conversationId);

      const so = await db.inboxMessage.count({ where: { conversationId: lan1.conversationId } });
      expect(so).toBe(1);
    });

    it("[HT-02] retry KHÔNG cộng thêm vào số tin chưa đọc", async () => {
      // Kiểm trùng phải xảy ra TRƯỚC khi cộng bộ đếm. Cộng trước rồi mới phát hiện
      // trùng thì mỗi lần Zalo retry lại +1 vào huy hiệu và không ai truy ra vì sao.
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const tin = {
        channel: "ZALO_OA" as const,
        accountId: OA,
        externalUserId: "u-2",
        channelMessageId: `${P}msg-2`,
        body: "alo",
        sentAt: LUC,
      };
      const r = await ingestInboundMessage(tin);
      await ingestInboundMessage(tin);
      await ingestInboundMessage(tin);

      const hoi = await db.inboxConversation.findUniqueOrThrow({ where: { id: r.conversationId } });
      expect(hoi.unreadCount).toBe(1);
    });

    it("[HT-03] hai khách khác nhau trên cùng OA ⇒ hai hội thoại riêng", async () => {
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const a = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-a",
        channelMessageId: `${P}m-a`, body: "a", sentAt: LUC,
      });
      const b = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-b",
        channelMessageId: `${P}m-b`, body: "b", sentAt: LUC,
      });
      expect(a.conversationId).not.toBe(b.conversationId);
    });
  });

  // ── 2. Mồ côi ─────────────────────────────────────────────────────────────
  describe("hội thoại mồ côi là trạng thái BÌNH THƯỜNG", () => {
    it("[HT-04] tin đầu tiên của người lạ ⇒ chưa nối lead, chưa có đơn vị", async () => {
      // Webhook `user_send_text` của Zalo KHÔNG BAO GIỜ kèm SĐT — đây là ca thường
      // gặp nhất, không phải ca lỗi.
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-la",
        channelMessageId: `${P}m-la`, body: "cho hỏi học phí", sentAt: LUC,
      });
      const hoi = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
        include: { identity: true },
      });
      expect(hoi.orgUnitId).toBeNull();
      expect(hoi.identity.leadId).toBeNull();
      expect(hoi.awaitingReply).toBe(true);
    });

    it("[HT-05] người cấp cơ sở VẪN thấy hội thoại mồ côi", async () => {
      // Giấu tồn đọng khỏi chính người phải xử lý là cách chắc chắn nhất để nó
      // không bao giờ được xử lý — khách nhắn vào rồi không ai trả lời.
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { listInboxConversations } = await import("@/lib/inbox/queries");
      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-mc",
        channelMessageId: `${P}m-mc`, body: "hi", sentAt: LUC,
      });
      const ds = await listInboxConversations({
        actor: actorCoSo("ou-cs1"),
        canViewPii: true,
        loc: { moCoi: true },
      });
      expect(ds.rows.map((x) => x.id)).toContain(r.conversationId);
    });
  });

  // ── 3. Nối lead + cách ly cơ sở ───────────────────────────────────────────
  describe("nối lead ⇒ bật cách ly cơ sở", () => {
    it("[HT-06] nối xong thì đơn vị LAN xuống hội thoại và tin", async () => {
      // Không lan thì hội thoại vẫn nằm trong nhóm mồ côi dù đã biết nó thuộc cơ sở
      // nào — tức cách ly cơ sở không bao giờ bật lên.
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { noiIdentityVaoLead } = await import("@/lib/inbox/identity");

      const lead = await db.lead.create({
        data: { parentName: `${P}Mẹ An`, phone: "84905000111", orgUnitId: "ou-cs1" },
      });
      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-noi",
        channelMessageId: `${P}m-noi`, body: "xin chào", sentAt: LUC,
      });
      const hoi0 = await db.inboxConversation.findUniqueOrThrow({ where: { id: r.conversationId } });

      await noiIdentityVaoLead({
        identityId: hoi0.identityId, leadId: lead.id, source: "MANUAL", boiUserId: null,
      });

      const hoi = await db.inboxConversation.findUniqueOrThrow({ where: { id: r.conversationId } });
      const tin = await db.inboxMessage.findMany({ where: { conversationId: r.conversationId } });
      expect(hoi.orgUnitId).toBe("ou-cs1");
      expect(tin.every((t) => t.orgUnitId === "ou-cs1")).toBe(true);
    });

    it("[HT-07] CS2 KHÔNG thấy hội thoại đã nối vào lead của CS1", async () => {
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { noiIdentityVaoLead } = await import("@/lib/inbox/identity");
      const { listInboxConversations, getInboxThread } = await import("@/lib/inbox/queries");

      const lead = await db.lead.create({
        data: { parentName: `${P}Mẹ Bình`, phone: "84905000222", orgUnitId: "ou-cs1" },
      });
      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-cl",
        channelMessageId: `${P}m-cl`, body: "hỏi lớp", sentAt: LUC,
      });
      const hoi0 = await db.inboxConversation.findUniqueOrThrow({ where: { id: r.conversationId } });
      await noiIdentityVaoLead({
        identityId: hoi0.identityId, leadId: lead.id, source: "MANUAL", boiUserId: null,
      });

      const cs1 = await listInboxConversations({ actor: actorCoSo("ou-cs1"), canViewPii: true });
      const cs2 = await listInboxConversations({ actor: actorCoSo("ou-cs2"), canViewPii: true });
      expect(cs1.rows.map((x) => x.id)).toContain(r.conversationId);
      expect(cs2.rows.map((x) => x.id)).not.toContain(r.conversationId);

      // Và gõ thẳng id cũng không vào được — cách ly phải ở TẦNG DỮ LIỆU, không
      // phải ở tầng "không có link để bấm".
      const gõThẳng = await getInboxThread({
        actor: actorCoSo("ou-cs2"), canViewPii: true, conversationId: r.conversationId,
      });
      expect(gõThẳng).toBeNull();
    });

    it("[HT-08] tự nối theo SĐT chỉ khi có ĐÚNG MỘT phiếu khớp", async () => {
      const { thuNoiTheoSdt } = await import("@/lib/inbox/identity");
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");

      // Hai phiếu cùng số — không được đoán.
      await db.lead.create({ data: { parentName: `${P}Trùng 1`, phone: "84905000333" } });
      await db.lead.create({ data: { parentName: `${P}Trùng 2`, phone: "0905000333" } });

      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-trung",
        channelMessageId: `${P}m-trung`, body: "x", sentAt: LUC,
      });
      const hoi = await db.inboxConversation.findUniqueOrThrow({ where: { id: r.conversationId } });
      const qd = await thuNoiTheoSdt({ identityId: hoi.identityId, sdt: "0905000333" });
      expect(qd).toEqual({ noi: false, lyDo: "NHIEU_LEAD_KHOP" });

      const dt = await db.inboxIdentity.findUniqueOrThrow({ where: { id: hoi.identityId } });
      expect(dt.leadId).toBeNull();
    });

    it("[HT-09] tra lead theo SĐT bắt CẢ HAI định dạng `0…` và `84…`", async () => {
      // DB còn tồn tại cả hai dạng (đo trên DEV 03/08: 99 bản `0…`, 8 bản `84…`).
      // So bằng một dạng là bỏ sót đúng nửa dữ liệu mà không có dấu hiệu nào.
      const { timLeadTheoSdt } = await import("@/lib/inbox/identity");
      const l = await db.lead.create({
        data: { parentName: `${P}Dạng 84`, phone: "84905000444" },
      });
      const theo0 = await timLeadTheoSdt("0905000444");
      expect(theo0.map((x) => x.id)).toContain(l.id);
    });
  });

  // ── 4. Gửi tin: mô phỏng KHÔNG được tính là đã trả lời ─────────────────────
  describe("🔴 gửi hụt KHÔNG được tắt đồng hồ chờ trả lời", () => {
    it("[HT-10] kênh mô phỏng ⇒ tin ghi SIMULATED, hội thoại VẪN đang chờ", async () => {
      // Đây là lỗi đã sống nhiều tháng ở module Messenger: `recordOutgoingMessage`
      // set `respondedAt` mỗi lần bấm Gửi, mà `lib/crm/sla.ts` đọc đúng cột đó ⇒
      // mỗi lần gửi hụt là tắt cảnh báo của một khách chưa ai trả lời.
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { sendInboxReply } = await import("@/lib/inbox/send");

      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-gui",
        channelMessageId: `${P}m-gui`, body: "cho hỏi", sentAt: LUC,
      });

      const kq = await sendInboxReply({
        conversationId: r.conversationId,
        body: "Dạ em trả lời ạ",
        sentByUserId: "user-sale-1",
        outboundKey: `${P}key-1`,
      });

      // Chưa có khoá kết nối Zalo trong môi trường test ⇒ mô phỏng.
      expect(kq.outcome.status).toBe("SIMULATED");
      expect(kq.daTraLoiKhach).toBe(false);

      const tin = await db.inboxMessage.findUniqueOrThrow({ where: { id: kq.messageId } });
      expect(tin.deliveryStatus).toBe("SIMULATED");
      expect(tin.sentByUserId).toBe("user-sale-1");
      expect(tin.providerMessageId).toBeNull();

      const hoi = await db.inboxConversation.findUniqueOrThrow({ where: { id: r.conversationId } });
      expect(hoi.lastOutboundAt).toBeNull();
      expect(hoi.awaitingReply).toBe(true);
      expect(hoi.unreadCount).toBe(1);
    });

    it("[HT-11] bấm hai lần cùng một khoá ⇒ chỉ MỘT dòng, lần hai báo trùng", async () => {
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { sendInboxReply, TrungLuotGuiError } = await import("@/lib/inbox/send");

      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-dup",
        channelMessageId: `${P}m-dup`, body: "?", sentAt: LUC,
      });
      const khoa = `${P}key-dup`;
      await sendInboxReply({
        conversationId: r.conversationId, body: "lần 1",
        sentByUserId: "u1", outboundKey: khoa,
      });
      await expect(
        sendInboxReply({
          conversationId: r.conversationId, body: "lần 1",
          sentByUserId: "u1", outboundKey: khoa,
        }),
      ).rejects.toBeInstanceOf(TrungLuotGuiError);

      const so = await db.inboxMessage.count({
        where: { conversationId: r.conversationId, direction: "OUT" },
      });
      expect(so).toBe(1);
    });

    it("[HT-11b] hai LƯỢT SOẠN cùng nội dung trong cùng hội thoại ⇒ vẫn hai dòng", async () => {
      // Mặt trái của [HT-11]. Lưới chống bấm đúp chỉ đúng khi khoá đại diện cho MỘT
      // LƯỢT SOẠN. Bản cũ dựng khoá bằng `${conversationId}:${băm(nội dung)}` ⇒ nội dung
      // nằm trong khoá ⇒ lần thứ hai Sale gõ đúng một câu đã gửi ("Dạ em nghe ạ", "Vâng
      // ạ", một emoji) bị báo TRÙNG LƯỢT GỬI, cho một tin hoàn toàn hợp lệ.
      //
      // Bài kiểm này gọi CHÍNH hàm dựng khoá mà ô soạn dùng — nếu ai đó đưa nội dung
      // trở lại khoá thì nó đỏ ở đây, không phải chờ Sale khiếu nại.
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { sendInboxReply } = await import("@/lib/inbox/send");
      const { taoKhoaLuotGui, nonceLuotGui } = await import(
        "@/lib/inbox/khoa-luot-gui"
      );

      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-lap",
        channelMessageId: `${P}m-lap`, body: "?", sentAt: LUC,
      });

      const CAU = "Dạ em nghe ạ";
      await sendInboxReply({
        conversationId: r.conversationId, body: CAU,
        sentByUserId: "u1", outboundKey: taoKhoaLuotGui(r.conversationId, nonceLuotGui()),
      });
      await sendInboxReply({
        conversationId: r.conversationId, body: CAU,
        sentByUserId: "u1", outboundKey: taoKhoaLuotGui(r.conversationId, nonceLuotGui()),
      });

      const so = await db.inboxMessage.count({
        where: { conversationId: r.conversationId, direction: "OUT" },
      });
      expect(so).toBe(2);
    });

    it("[HT-12] tin OA gửi NGOÀI hệ thống vẫn tắt được đồng hồ, và được đánh dấu", async () => {
      // Nhân viên trả lời thẳng trên `oa.zalo.me`: khách THẬT SỰ đã được trả lời
      // (nên phải tắt đồng hồ), nhưng không định danh được ai gõ (nên phải đánh dấu
      // — đó là chỉ số M-OA-4, đầu vào để biết dữ liệu chấm điểm có dùng được không).
      const { ingestInboundMessage, ingestOutboundEcho } = await import("@/lib/inbox/ingest");

      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-echo",
        channelMessageId: `${P}m-echo-in`, body: "hỏi", sentAt: LUC,
      });
      await ingestOutboundEcho({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-echo",
        channelMessageId: `${P}m-echo-out`, body: "đáp",
        sentAt: new Date(LUC.getTime() + 60_000),
      });

      const hoi = await db.inboxConversation.findUniqueOrThrow({ where: { id: r.conversationId } });
      expect(hoi.awaitingReply).toBe(false);
      expect(hoi.lastOutboundAt).not.toBeNull();

      const tinRa = await db.inboxMessage.findFirstOrThrow({
        where: { conversationId: r.conversationId, direction: "OUT" },
      });
      expect(tinRa.sentOutsideSystem).toBe(true);
      expect(tinRa.sentByUserId).toBeNull();
      expect(tinRa.deliveryStatus).toBe("SENT");
    });

    it("[HT-13] xoá mềm tin trả lời cuối ⇒ hội thoại quay lại 'chưa trả lời'", async () => {
      // Xoá tin mà không tính lại là hội thoại biến mất khỏi danh sách "chưa trả lời"
      // trong khi khách vẫn đang chờ.
      const { ingestInboundMessage, ingestOutboundEcho } = await import("@/lib/inbox/ingest");
      const { xoaMemTin } = await import("@/lib/inbox/thao-tac");

      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-xoa",
        channelMessageId: `${P}m-xoa-in`, body: "hỏi", sentAt: LUC,
      });
      const ra = await ingestOutboundEcho({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-xoa",
        channelMessageId: `${P}m-xoa-out`, body: "đáp",
        sentAt: new Date(LUC.getTime() + 60_000),
      });
      expect(
        (await db.inboxConversation.findUniqueOrThrow({ where: { id: r.conversationId } }))
          .awaitingReply,
      ).toBe(false);

      await xoaMemTin({
        conversationId: r.conversationId,
        messageId: ra.messageId!,
        boiUserId: "u1",
        lyDo: "gửi nhầm hội thoại, đã xác minh lại",
      });

      const hoi = await db.inboxConversation.findUniqueOrThrow({ where: { id: r.conversationId } });
      expect(hoi.awaitingReply).toBe(true);
      const tin = await db.inboxMessage.findUniqueOrThrow({ where: { id: ra.messageId! } });
      expect(tin.deletedAt).not.toBeNull(); // XOÁ MỀM — dòng vẫn còn
    });
  });

  // ── 5. Rò liên hệ ─────────────────────────────────────────────────────────
  describe("không rò SĐT cho người không có quyền", () => {
    it("[HT-14] `canViewPii = false` ⇒ SĐT không có trong kết quả, kể cả trong nội dung tin", async () => {
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { noiIdentityVaoLead } = await import("@/lib/inbox/identity");
      const { getInboxThread } = await import("@/lib/inbox/queries");

      const lead = await db.lead.create({
        data: { parentName: `${P}Mẹ Cúc`, phone: "84905000555", orgUnitId: "ou-cs1" },
      });
      const r = await ingestInboundMessage({
        channel: "ZALO_OA", accountId: OA, externalUserId: "u-pii",
        channelMessageId: `${P}m-pii`,
        body: "sdt em 0905000555 nhe, mail nhamekhach@gmail.com",
        sentAt: LUC,
      });
      const hoi0 = await db.inboxConversation.findUniqueOrThrow({ where: { id: r.conversationId } });
      await noiIdentityVaoLead({
        identityId: hoi0.identityId, leadId: lead.id, source: "MANUAL", boiUserId: null,
      });

      const che = await getInboxThread({
        actor: actorCoSo("ou-cs1"), canViewPii: false, conversationId: r.conversationId,
      });
      const chuoi = JSON.stringify(che);
      expect(chuoi).not.toContain("0905000555");
      expect(chuoi).not.toContain("84905000555");
      expect(chuoi).not.toContain("nhamekhach@gmail.com");

      const day = await getInboxThread({
        actor: actorCoSo("ou-cs1"), canViewPii: true, conversationId: r.conversationId,
      });
      expect(JSON.stringify(day)).toContain("0905000555");
    });
  });
});

/** Actor cấp cơ sở tối thiểu — chỉ cần các field mà `inboxOrgScopeWhere` đọc. */
function actorCoSo(orgUnitId: string) {
  return {
    userId: "u-test",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [orgUnitId],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
