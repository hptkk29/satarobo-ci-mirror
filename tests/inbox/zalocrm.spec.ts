// @vitest-environment node
/**
 * LÕI HỘP THƯ — ba lỗi có sẵn (B2/B3/B6) + gắn đơn vị theo nick. Tầng DB thật.
 *
 * Ba lỗi dưới đây có chung một tính chất: KHÔNG lỗi nào văng ra màn hình. Chúng chỉ
 * lộ khi có người khiếu nại, và lúc đó dữ liệu đã lẫn rồi.
 *
 *   B2 — `ganNguoiPhuTrach` không ghi `orgUnitId` ⇒ hội thoại ĐÃ có người nhận vẫn
 *        nằm nhóm mồ côi, mà nhóm mồ côi thì MỌI cơ sở đọc được. Rò chéo cơ sở.
 *   B3 — `timLeadTheoSdt` tra `Lead` không giới hạn cơ sở ⇒ nối hội thoại của CS1
 *        vào phiếu của CS2 khi hai bên trùng số.
 *   B6 — `sendInboxReply` bước 3 ghi `channelMessageId` VÔ ĐIỀU KIỆN, ngoài
 *        try/catch ⇒ echo về trước là ném P2002 ra thẳng Server Action, trong khi
 *        tin đã THẬT SỰ tới khách. Người trực thấy "lỗi" và bấm gửi lại.
 *
 * ⚠️ Bộ này TỰ SKIP khi không có Postgres local. Thấy SKIP trong log nghĩa là CHƯA
 * KIỂM ĐƯỢC GÌ, không phải "xanh". Và KHÔNG `resetDb()` — dọn theo TIỀN TỐ riêng.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
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
  console.warn("[zalocrm] SKIP: DATABASE_URL không trỏ Postgres local.");
}

const db = new PrismaClient();

/** Bảng `Inbox*` chưa có ⇒ SKIP kèm câu chỉ việc, đừng đổ một đống `P2021`. */
const CO_BANG =
  RUN &&
  (await db.inboxConversation
    .count()
    .then(() => true)
    .catch(() => {
      console.warn(
        "[zalocrm] SKIP: chưa có bảng Inbox*. Chạy `prisma migrate deploy` trên DB " +
          "test trước (migration 20260827120000_hop_thu_da_kenh).",
      );
      return false;
    }));

/** Tiền tố RIÊNG của bộ này — dùng lại `HTDK_` là hai file dọn dữ liệu của nhau. */
const P = "ZCRM_";
const OA = `${P}oa1`;
const CS1 = `${P}ou-cs1`;
const CS2 = `${P}ou-cs2`;
const LUC = new Date("2026-09-06T02:00:00.000Z");

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
  await db.user.deleteMany({ where: { name: { startsWith: P } } });
}

/** Tin đến chuẩn — chỉ đổi phần cần đổi ở từng ca. */
function tinDen(khoa: string, extra?: { body?: string; sentAt?: Date }) {
  return {
    channel: "ZALO_OA" as const,
    accountId: OA,
    externalUserId: `u-${khoa}`,
    channelMessageId: `${P}m-${khoa}`,
    body: extra?.body ?? "alo",
    sentAt: extra?.sentAt ?? LUC,
  };
}

describe.skipIf(!CO_BANG)("lõi hộp thư — B2 · B3 · B6 · gắn đơn vị theo nick", () => {
  beforeAll(purge);
  afterAll(async () => {
    await purge();
    await db.$disconnect();
  });
  beforeEach(purge);
  afterEach(() => {
    // Ca B6 thay sổ đăng ký adapter bằng bản giả; không gỡ là mọi ca sau đó gửi tin
    // qua adapter giả mà không ai biết.
    vi.doUnmock("@/lib/integrations/registry");
    vi.resetModules();
  });

  // ── B2 — gán người phụ trách phải HẾT mồ côi ───────────────────────────────
  describe("🔴 B2 — hội thoại đã có người nhận không được nằm nhóm 'ai cũng đọc'", () => {
    it("[ZC-17] gán người phụ trách ⇒ đơn vị của người đó lan xuống identity + hội thoại + tin", async () => {
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { ganNguoiPhuTrach } = await import("@/lib/inbox/thao-tac");

      const sale = await db.user.create({ data: { name: `${P}Sale CS1`, orgUnitId: CS1 } });
      const r = await ingestInboundMessage(tinDen("gan"));

      const truoc = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      });
      expect(truoc.orgUnitId, "tin đầu tiên phải mồ côi — đó là trạng thái ĐÚNG").toBeNull();

      await ganNguoiPhuTrach({
        conversationId: r.conversationId,
        assigneeId: sale.id,
        boiUserId: sale.id,
      });

      const sau = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
        include: { identity: true },
      });
      expect(sau.assigneeId).toBe(sale.id);
      expect(sau.orgUnitId).toBe(CS1);
      expect(sau.identity.orgUnitId).toBe(CS1);

      const tin = await db.inboxMessage.findMany({ where: { conversationId: r.conversationId } });
      expect(tin.length).toBeGreaterThan(0);
      expect(tin.every((t) => t.orgUnitId === CS1)).toBe(true);
    });

    it("[ZC-05] gán về CS1 rồi thì Sale CS2 KHÔNG còn thấy hội thoại đó", async () => {
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { ganNguoiPhuTrach } = await import("@/lib/inbox/thao-tac");
      const { listInboxConversations, getInboxThread } = await import("@/lib/inbox/queries");

      const sale = await db.user.create({ data: { name: `${P}Sale CS1 b`, orgUnitId: CS1 } });
      const r = await ingestInboundMessage(tinDen("scope"));
      await ganNguoiPhuTrach({
        conversationId: r.conversationId,
        assigneeId: sale.id,
        boiUserId: sale.id,
      });

      const cs1 = await listInboxConversations({ actor: actorCoSo(CS1), canViewPii: true });
      const cs2 = await listInboxConversations({ actor: actorCoSo(CS2), canViewPii: true });
      expect(cs1.rows.map((x) => x.id)).toContain(r.conversationId);
      expect(cs2.rows.map((x) => x.id)).not.toContain(r.conversationId);

      // Gõ thẳng id cũng không vào được — cách ly phải ở TẦNG DỮ LIỆU.
      const goThang = await getInboxThread({
        actor: actorCoSo(CS2),
        canViewPii: true,
        conversationId: r.conversationId,
      });
      expect(goThang).toBeNull();
    });

    it("[ZC-17b] KHÔNG đè đơn vị đã có từ nối lead (gán người CS2 không kéo hội thoại CS1 đi)", async () => {
      // `Lead` là nguồn mạnh hơn người phụ trách. Đè là chuyển hội thoại sang cơ sở
      // khác sau lưng người đang xử lý, không một dòng log nào nói ra.
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { noiIdentityVaoLead } = await import("@/lib/inbox/identity");
      const { ganNguoiPhuTrach } = await import("@/lib/inbox/thao-tac");

      const lead = await db.lead.create({
        data: { parentName: `${P}Mẹ CS1`, phone: "84905000901", orgUnitId: CS1 },
      });
      const nguoiCs2 = await db.user.create({ data: { name: `${P}Sale CS2`, orgUnitId: CS2 } });
      const r = await ingestInboundMessage(tinDen("khongde"));
      const hoi0 = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      });
      await noiIdentityVaoLead({
        identityId: hoi0.identityId,
        leadId: lead.id,
        source: "MANUAL",
        boiUserId: null,
      });

      await ganNguoiPhuTrach({
        conversationId: r.conversationId,
        assigneeId: nguoiCs2.id,
        boiUserId: nguoiCs2.id,
      });

      const sau = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      });
      expect(sau.assigneeId).toBe(nguoiCs2.id); // vẫn gán được (điều phối là việc của người)
      expect(sau.orgUnitId, "đơn vị phải GIỮ theo lead").toBe(CS1);
    });

    it("[ZC-17c] trả hội thoại về hàng đợi chung KHÔNG xoá đơn vị", async () => {
      // Xoá đơn vị lúc bỏ gán là mở lại đúng lỗ B2: hội thoại rơi về nhóm mồ côi và
      // mọi cơ sở đọc lại được. Muốn gỡ đơn vị thì gỡ nối lead (`goNoiIdentity`).
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { ganNguoiPhuTrach } = await import("@/lib/inbox/thao-tac");

      const sale = await db.user.create({ data: { name: `${P}Sale CS1 c`, orgUnitId: CS1 } });
      const r = await ingestInboundMessage(tinDen("bogan"));
      await ganNguoiPhuTrach({
        conversationId: r.conversationId,
        assigneeId: sale.id,
        boiUserId: sale.id,
      });
      await ganNguoiPhuTrach({
        conversationId: r.conversationId,
        assigneeId: null,
        boiUserId: sale.id,
      });

      const sau = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      });
      expect(sau.assigneeId).toBeNull();
      expect(sau.orgUnitId).toBe(CS1);
    });

    it("[ZC-17d] người được gán chưa khai đơn vị ⇒ vẫn gán được, hội thoại vẫn mồ côi", async () => {
      // Không được ném lỗi: điều phối là việc hằng ngày, còn đơn vị của tài khoản là
      // dữ liệu quản trị. Chặn gán vì thiếu dữ liệu quản trị là chặn nhầm chỗ.
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { ganNguoiPhuTrach } = await import("@/lib/inbox/thao-tac");

      const lac = await db.user.create({ data: { name: `${P}Sale chua khai` } });
      const r = await ingestInboundMessage(tinDen("khongdonvi"));
      await ganNguoiPhuTrach({
        conversationId: r.conversationId,
        assigneeId: lac.id,
        boiUserId: lac.id,
      });

      const sau = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      });
      expect(sau.assigneeId).toBe(lac.id);
      expect(sau.orgUnitId).toBeNull();
    });
  });

  // ── B3 — nối lead phải cùng cơ sở ──────────────────────────────────────────
  describe("🔴 B3 — không nối hội thoại sang phiếu của cơ sở khác", () => {
    it("[ZC-03] SĐT khớp phiếu của CS2 ⇒ hội thoại CS1 KHÔNG được nối", async () => {
      const { timLeadTheoSdt, thuNoiTheoSdt } = await import("@/lib/inbox/identity");
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");

      const leadCs2 = await db.lead.create({
        data: { parentName: `${P}Mẹ CS2 b`, phone: "84905111222", orgUnitId: CS2 },
      });

      expect((await timLeadTheoSdt("0905111222", CS1)).map((x) => x.id)).not.toContain(leadCs2.id);
      expect((await timLeadTheoSdt("0905111222", CS2)).map((x) => x.id)).toContain(leadCs2.id);

      const r = await ingestInboundMessage(tinDen("noicheo"));
      const hoi0 = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      });

      const qd = await thuNoiTheoSdt({
        identityId: hoi0.identityId,
        sdt: "0905111222",
        orgUnitId: CS1,
      });
      expect(qd).toEqual({ noi: false, lyDo: "KHONG_KHOP_LEAD" });

      const dt = await db.inboxIdentity.findUniqueOrThrow({ where: { id: hoi0.identityId } });
      expect(dt.leadId).toBeNull();
    });

    it("[ZC-03b] phiếu CHƯA có đơn vị vẫn nối được (đừng bỏ rơi phiếu tồn đọng)", async () => {
      const { thuNoiTheoSdt } = await import("@/lib/inbox/identity");
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");

      const leadTroi = await db.lead.create({
        data: { parentName: `${P}Mẹ chưa gán`, phone: "84905111333" },
      });
      const r = await ingestInboundMessage(tinDen("noitroi"));
      const hoi0 = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      });

      const qd = await thuNoiTheoSdt({
        identityId: hoi0.identityId,
        sdt: "0905111333",
        orgUnitId: CS1,
      });
      expect(qd).toEqual({ noi: true, leadId: leadTroi.id, source: "PHONE_MATCH" });
    });

    it("[ZC-03c] chưa biết đơn vị ⇒ giữ nguyên hành vi cũ, vẫn nối theo SĐT", async () => {
      const { timLeadTheoSdt } = await import("@/lib/inbox/identity");
      const lead = await db.lead.create({
        data: { parentName: `${P}Mẹ CS2 c`, phone: "84905111444", orgUnitId: CS2 },
      });
      expect((await timLeadTheoSdt("0905111444")).map((x) => x.id)).toContain(lead.id);
    });

    it("[ZC-15] nối lead ⇒ đơn vị lan đủ ba bảng (identity + hội thoại + tin)", async () => {
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { noiIdentityVaoLead } = await import("@/lib/inbox/identity");

      const lead = await db.lead.create({
        data: { parentName: `${P}Mẹ lan`, phone: "84905111555", orgUnitId: CS1 },
      });
      const r = await ingestInboundMessage(tinDen("lan3bang"));
      const hoi0 = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      });
      await noiIdentityVaoLead({
        identityId: hoi0.identityId,
        leadId: lead.id,
        source: "MANUAL",
        boiUserId: null,
      });

      const sau = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
        include: { identity: true },
      });
      const tin = await db.inboxMessage.findMany({ where: { conversationId: r.conversationId } });
      expect(sau.identity.orgUnitId).toBe(CS1);
      expect(sau.identity.leadId).toBe(lead.id);
      expect(sau.orgUnitId).toBe(CS1);
      expect(tin.every((t) => t.orgUnitId === CS1)).toBe(true);
    });
  });

  // ── B6 — echo về trước không được ném P2002 ────────────────────────────────
  describe("🔴 B6 — echo về trước bước 3 không được làm vỡ lượt gửi", () => {
    it("[ZC-B6] echo mang đúng id nhà cung cấp về TRƯỚC ⇒ không ném, id vẫn thuộc đúng một dòng", async () => {
      // Trước khi sửa: bước 3 ghi `channelMessageId` vô điều kiện và nằm NGOÀI
      // try/catch ⇒ P2002 bay thẳng ra Server Action. Người trực đọc "lỗi hệ thống"
      // và bấm gửi lại, trong khi tin đã tới khách rồi.
      const { ingestOutboundEcho } = await import("@/lib/inbox/ingest");
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");

      const r = await ingestInboundMessage(tinDen("echotruoc"));
      const ID_NCC = `${P}prov-truoc`;
      await ingestOutboundEcho({
        channel: "ZALO_OA",
        accountId: OA,
        externalUserId: "u-echotruoc",
        channelMessageId: ID_NCC,
        body: "Dạ em nghe ạ",
        sentAt: new Date(LUC.getTime() + 30_000),
      });

      const sendInboxReply = await napSendVoiAdapterThat(ID_NCC);
      const kq = await sendInboxReply({
        conversationId: r.conversationId,
        body: "Dạ em nghe ạ",
        sentByUserId: "u-sale",
        outboundKey: `${P}key-echotruoc`,
      });

      expect(kq.outcome.status).toBe("SENT");
      expect(kq.daTraLoiKhach).toBe(true);

      // Kết quả gửi VẪN được ghi sổ — mất nó là mất luôn bằng chứng đã trả lời khách.
      const cuaMinh = await db.inboxMessage.findUniqueOrThrow({ where: { id: kq.messageId } });
      expect(cuaMinh.deliveryStatus).toBe("SENT");
      expect(cuaMinh.providerMessageId).toBe(ID_NCC);
      expect(cuaMinh.channelMessageId, "id đã thuộc dòng echo — không giành lại").toBeNull();

      const giu = await db.inboxMessage.count({
        where: { channel: "ZALO_OA", channelMessageId: ID_NCC },
      });
      expect(giu).toBe(1);
    });

    it("[ZC-B6b] gửi đi trước, echo về sau ⇒ echo bị nhận ra là TRÙNG, không có dòng OUT thứ hai", async () => {
      // Mặt còn lại của B6: tách hai lệnh không được làm mất tác dụng chống echo.
      const { ingestInboundMessage, ingestOutboundEcho } = await import("@/lib/inbox/ingest");

      const r = await ingestInboundMessage(tinDen("echosau"));
      const ID_NCC = `${P}prov-sau`;
      const sendInboxReply = await napSendVoiAdapterThat(ID_NCC);
      const kq = await sendInboxReply({
        conversationId: r.conversationId,
        body: "Dạ vâng ạ",
        sentByUserId: "u-sale",
        outboundKey: `${P}key-echosau`,
      });
      expect(kq.outcome.status).toBe("SENT");

      const echo = await ingestOutboundEcho({
        channel: "ZALO_OA",
        accountId: OA,
        externalUserId: "u-echosau",
        channelMessageId: ID_NCC,
        body: "Dạ vâng ạ",
        sentAt: new Date(LUC.getTime() + 90_000),
      });
      expect(echo.duplicate).toBe(true);

      const soRa = await db.inboxMessage.count({
        where: { conversationId: r.conversationId, direction: "OUT" },
      });
      expect(soRa).toBe(1);
    });
  });

  // ── Gắn đơn vị theo nick ───────────────────────────────────────────────────
  describe("gắn cơ sở NGAY lúc nhận tin đầu tiên (theo nick)", () => {
    it("[ZC-16] gắn theo nick ⇒ hội thoại hết 'chưa biết cơ sở', tin sau tự thừa hưởng", async () => {
      // Mục đích: nhóm "mồ côi" chỉ còn nghĩa CHƯA NỐI LEAD, không còn nghĩa CHƯA
      // BIẾT CƠ SỞ. Nick ZaloCRM luôn thuộc đúng một cơ sở — biết rồi thì gắn ngay.
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { ganDonViTheoNick } = await import("@/lib/inbox/don-vi");
      const { listInboxConversations } = await import("@/lib/inbox/queries");

      const r = await ingestInboundMessage(tinDen("nick"));
      const kq = await ganDonViTheoNick({ conversationId: r.conversationId, orgUnitId: CS1 });
      expect(kq.daGan).toBe(true);

      const sau = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
        include: { identity: true },
      });
      expect(sau.orgUnitId).toBe(CS1);
      expect(sau.identity.orgUnitId).toBe(CS1);
      expect(sau.identity.leadId, "vẫn CHƯA nối lead — hai chuyện khác nhau").toBeNull();
      const tin1 = await db.inboxMessage.findMany({ where: { conversationId: r.conversationId } });
      expect(tin1.every((t) => t.orgUnitId === CS1)).toBe(true);

      // Tin thứ hai của cùng khách thừa hưởng đơn vị mà không cần gọi lại.
      await ingestInboundMessage({
        channel: "ZALO_OA",
        accountId: OA,
        externalUserId: "u-nick",
        channelMessageId: `${P}m-nick-2`,
        body: "cho hỏi học phí",
        sentAt: new Date(LUC.getTime() + 60_000),
      });
      const tin2 = await db.inboxMessage.findMany({ where: { conversationId: r.conversationId } });
      expect(tin2.length).toBe(2);
      expect(tin2.every((t) => t.orgUnitId === CS1)).toBe(true);

      const cs2 = await listInboxConversations({ actor: actorCoSo(CS2), canViewPii: true });
      expect(cs2.rows.map((x) => x.id)).not.toContain(r.conversationId);
    });

    it("[ZC-16b] nick chưa khai cơ sở (`null`) ⇒ không đụng gì, hội thoại giữ nguyên", async () => {
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { ganDonViTheoNick } = await import("@/lib/inbox/don-vi");

      const r = await ingestInboundMessage(tinDen("nicktrong"));
      const kq = await ganDonViTheoNick({ conversationId: r.conversationId, orgUnitId: null });
      expect(kq).toEqual({ daGan: false, lyDo: "KHONG_BIET_DON_VI" });

      const sau = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      });
      expect(sau.orgUnitId).toBeNull();
    });

    it("[ZC-16c] hội thoại đã thuộc CS1, nick khai CS2 ⇒ TỪ CHỐI, dữ liệu không đổi", async () => {
      const { ingestInboundMessage } = await import("@/lib/inbox/ingest");
      const { ganDonViTheoNick } = await import("@/lib/inbox/don-vi");

      const r = await ingestInboundMessage(tinDen("nickdoi"));
      await ganDonViTheoNick({ conversationId: r.conversationId, orgUnitId: CS1 });
      const kq = await ganDonViTheoNick({ conversationId: r.conversationId, orgUnitId: CS2 });
      expect(kq).toEqual({ daGan: false, lyDo: "DA_CO_DON_VI_KHAC" });

      const sau = await db.inboxConversation.findUniqueOrThrow({
        where: { id: r.conversationId },
      });
      expect(sau.orgUnitId).toBe(CS1);
    });

    it("[ZC-16d] id không tồn tại ⇒ trả KHONG_TIM_THAY, không ném", async () => {
      // Đường gọi là WEBHOOK: ném ở đây là nhà cung cấp thấy 5xx và retry mãi một
      // payload không bao giờ xử lý được.
      const { ganDonViTheoNick } = await import("@/lib/inbox/don-vi");
      expect(
        await ganDonViTheoNick({ conversationId: `${P}khong-co`, orgUnitId: CS1 }),
      ).toEqual({ daGan: false, lyDo: "KHONG_TIM_THAY" });
    });
  });
});

/**
 * Nạp `sendInboxReply` với sổ đăng ký adapter GIẢ trả `SENT` kèm id cho trước.
 *
 * Vì sao phải giả: môi trường test không có khoá kết nối Zalo/Meta ⇒ mọi adapter
 * thật trả `SIMULATED` với `providerMessageId = null`, mà `null` thì bước 3 không
 * bao giờ va khoá chống trùng — tức không tái hiện được B6.
 */
async function napSendVoiAdapterThat(providerMessageId: string) {
  vi.resetModules();
  vi.doMock("@/lib/integrations/registry", () => ({
    getChannelProvider: () => ({
      channel: "ZALO_OA",
      name: "gia-lap",
      label: "Giả lập",
      isConfigured: () => true,
      send: async () => ({ status: "SENT" as const, providerMessageId }),
    }),
    khongCoAdapter: (channel: string) => ({
      status: "SKIPPED" as const,
      errorCode: `KENH_KHONG_GUI_DUOC_${channel}`,
    }),
  }));
  const { sendInboxReply } = await import("@/lib/inbox/send");
  return sendInboxReply;
}

/** Actor cấp cơ sở tối thiểu — chỉ cần field mà `inboxOrgScopeWhere` đọc. */
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

// ═══════════════════════════════════════════════════════════════════════════
// L7 — CHUỖI XỬ LÝ WEBHOOK ĐẦY ĐỦ (`napSuKienZalocrm`), tầng DB thật.
//
// Bộ ở trên kiểm từng mảnh rời của lõi hộp thư. Bộ này kiểm CHUỖI: dịch payload →
// nick → ingest → gắn cơ sở → nối phiếu → dòng thời gian. Đó là chỗ các bước hay bị
// bỏ quên nhất, và mọi thiếu sót ở đây đều hỏng CÂM:
//   · quên `ganDonViTheoNick` ⇒ hội thoại ở lại nhóm mồ côi ⇒ MỌI cơ sở đọc được;
//   · quên tiền tố org ở `channelMessageId` ⇒ tin của org sau bị nuốt im lặng;
//   · ghi mốc cho tin ĐẾN ⇒ bump `lastActivityAt` và che mất "khách nhắn mà Sale im";
//   · đè `zcrmConversationId` đang khác NULL ⇒ cướp ánh xạ của hội thoại thứ nhất.
// ═══════════════════════════════════════════════════════════════════════════

/** orgCode riêng của bộ này — phải hợp khuôn `/^[a-z0-9-]{1,32}$/`. */
const ORG = "zcrm-test";
const NICK = `${P}acc-01`;
/** Cấu hình org giả — HMAC/env đã kiểm ở `lib/integrations/zalocrm/webhook.test.ts`. */
const CAU_HINH = { orgCode: ORG, secret: "khong-dung-o-day", centerId: null, orgUnitId: CS1 };

async function purgeL7() {
  const leads = await db.lead.findMany({
    where: { parentName: { startsWith: P } },
    select: { id: true },
  });
  if (leads.length) {
    await db.leadActivity.deleteMany({ where: { leadId: { in: leads.map((l) => l.id) } } });
  }
  await db.zaloCrmThread.deleteMany({ where: { orgCode: { startsWith: ORG } } });
  await db.zaloCrmNick.deleteMany({ where: { orgCode: { startsWith: ORG } } });
  await purge();
}

/** Payload webhook như bản FORK sẽ gửi (đủ `zaloAccountId`/`threadId`/`contact.phone`). */
function payloadTin(
  khoa: string,
  o?: {
    huong?: "DEN" | "DI";
    phone?: string | null;
    conv?: string;
    noiDung?: string;
    sentByExternalId?: string;
    nick?: string;
  },
): Record<string, unknown> {
  const huong = o?.huong ?? "DEN";
  const uidKhach = `${P}uid-${o?.conv ?? khoa}`;
  return {
    event: huong === "DEN" ? "message.received" : "message.sent",
    data: {
      messageId: `m-${khoa}`,
      conversationId: `${P}conv-${o?.conv ?? khoa}`,
      zaloAccountId: o?.nick ?? NICK,
      threadId: uidKhach,
      threadType: "user",
      senderUid: huong === "DEN" ? uidKhach : `${P}uid-nick`,
      ...(o?.phone === null
        ? {}
        : { contact: { id: `${P}ct-1`, phone: o?.phone ?? "0912345678" } }),
      ...(o?.sentByExternalId ? { sentByExternalId: o.sentByExternalId } : {}),
      content: o?.noiDung ?? "cho hỏi học phí",
      contentType: "text",
      sentAt: LUC.toISOString(),
    },
  };
}

/** Dịch rồi nạp — đúng chuỗi mà `webhook.ts` chạy sau khi qua chữ ký. */
async function chay(payload: unknown, orgCode = ORG) {
  const { dichPayloadZalocrm } = await import("@/lib/integrations/zalocrm/dich-payload");
  const { napSuKienZalocrm } = await import("@/lib/integrations/zalocrm/nap-su-kien");
  const dich = dichPayloadZalocrm({ payload, orgCode });
  if (!dich.ok) throw new Error(`dịch hỏng: ${dich.ma}`);
  return napSuKienZalocrm({ viec: dich.viec, cauHinh: { ...CAU_HINH, orgCode } });
}

describe.skipIf(!CO_BANG)("L7 — chuỗi xử lý webhook ZaloCRM", () => {
  beforeAll(purgeL7);
  afterAll(purgeL7);
  beforeEach(purgeL7);

  it("[ZC-01] tin TRÙNG channelMessageId ⇒ không dòng thứ hai, KHÔNG cộng chưa đọc", async () => {
    // Outbox của fork retry khi thấy non-2xx, và cron đối soát (GĐ3) đổ vào cùng bảng.
    // Cộng bộ đếm trước rồi mới phát hiện trùng là mỗi lần retry lại +1 vào huy hiệu,
    // và không ai truy ra vì sao.
    const p = payloadTin("trung");
    const lan1 = await chay(p);
    const lan2 = await chay(p);

    expect(lan1).toMatchObject({ ok: true, trung: false });
    expect(lan2).toMatchObject({ ok: true, trung: true });
    if (!lan1.ok) throw new Error("lượt đầu phải ok");

    const hoi = await db.inboxConversation.findUniqueOrThrow({
      where: { id: lan1.conversationId! },
    });
    expect(hoi.unreadCount).toBe(1);
    const tin = await db.inboxMessage.findMany({ where: { conversationId: hoi.id } });
    expect(tin.length).toBe(1);
    expect(tin[0].channelMessageId).toBe(`${ORG}:m-trung`);
  });

  it("[ZC-L7-01] tin đầu tiên đã có CƠ SỞ của nick — không nằm nhóm 'ai cũng đọc'", async () => {
    const kq = await chay(payloadTin("gancoso", { phone: null }));
    if (!kq.ok) throw new Error("phải ok");

    const hoi = await db.inboxConversation.findUniqueOrThrow({
      where: { id: kq.conversationId! },
      include: { identity: true },
    });
    expect(hoi.orgUnitId).toBe(CS1);
    expect(hoi.identity.orgUnitId).toBe(CS1);
    expect(hoi.identity.leadId, "chưa nối phiếu — hai chuyện khác nhau").toBeNull();

    const { listInboxConversations } = await import("@/lib/inbox/queries");
    const cs2 = await listInboxConversations({ actor: actorCoSo(CS2), canViewPii: true });
    expect(cs2.rows.map((x) => x.id)).not.toContain(hoi.id);
  });

  it("[ZC-L7-02] nick được TẠO tự động + cập nhật `lastEventAt` (không chờ đồng bộ tay)", async () => {
    await chay(payloadTin("nickmoi"));
    const nick = await db.zaloCrmNick.findUniqueOrThrow({ where: { zcrmAccountId: NICK } });
    expect(nick.orgCode).toBe(ORG);
    expect(nick.orgUnitId).toBe(CS1);
    expect(nick.lastEventAt?.toISOString()).toBe(LUC.toISOString());
  });

  it("[ZC-L7-03] dòng ĐẶT TRƯỚC `(orgCode, phone)` ⇒ nối đúng phiếu Sale đã bấm", async () => {
    // Chiều lead → chat: Sale bấm "Nhắn Zalo" TRƯỚC khi hội thoại tồn tại, nên dòng
    // đặt trước chỉ có `(orgCode, phone)` + `leadId`, `zcrmConversationId` còn NULL.
    const lead = await db.lead.create({
      data: { parentName: `${P}Mẹ đặt trước`, phone: "84912345678", orgUnitId: CS1 },
    });
    await db.zaloCrmThread.create({
      data: { orgCode: ORG, phone: "84912345678", leadId: lead.id, orgUnitId: CS1 },
    });

    const kq = await chay(payloadTin("dattruoc", { conv: "A" }));
    if (!kq.ok) throw new Error("phải ok");

    const hoi = await db.inboxConversation.findUniqueOrThrow({
      where: { id: kq.conversationId! },
      include: { identity: true },
    });
    expect(hoi.identity.leadId).toBe(lead.id);
    // `EXTERNAL_TAG`, KHÔNG phải `WEBHOOK_PROFILE`: giá trị kia là bằng chứng ĐỒNG Ý
    // (khách tự bấm "Chia sẻ thông tin") — ghi phép nối máy-với-máy vào đó là hỏng vết.
    expect(hoi.identity.linkSource).toBe("EXTERNAL_TAG");

    const thread = await db.zaloCrmThread.findFirstOrThrow({ where: { orgCode: ORG } });
    expect(thread.zcrmConversationId, "webhook đầu tiên điền nốt id hội thoại").toBe(
      `${P}conv-A`,
    );
  });

  it("[ZC-L7-04] KHÔNG đè `zcrmConversationId` đang khác NULL (khách nhắn hai nick)", async () => {
    // `@@unique([orgCode, phone])` chỉ giữ được MỘT ánh xạ cho một số. Cướp ánh xạ của
    // hội thoại thứ nhất là chuyển lịch sử của khách sang nhầm chỗ, im lặng.
    const lead = await db.lead.create({
      data: { parentName: `${P}Mẹ hai nick`, phone: "84912345678", orgUnitId: CS1 },
    });
    await db.zaloCrmThread.create({
      data: {
        orgCode: ORG,
        phone: "84912345678",
        leadId: lead.id,
        zcrmConversationId: `${P}conv-CU`,
        orgUnitId: CS1,
      },
    });

    await chay(payloadTin("hainick", { conv: "MOI" }));

    const thread = await db.zaloCrmThread.findFirstOrThrow({ where: { orgCode: ORG } });
    expect(thread.zcrmConversationId).toBe(`${P}conv-CU`);
    expect(
      await db.zaloCrmThread.count({ where: { orgCode: ORG } }),
      "không đẻ dòng ánh xạ thứ hai cho cùng một số",
    ).toBe(1);
  });

  it("[ZC-L7-05] không có dòng đặt trước ⇒ nối theo SĐT, và ghi ngược vào ánh xạ", async () => {
    const cungCoSo = await db.lead.create({
      data: { parentName: `${P}Mẹ CS1`, phone: "84912345678", orgUnitId: CS1 },
    });
    const kq = await chay(payloadTin("theosdt", { conv: "S1" }));
    if (!kq.ok) throw new Error("phải ok");

    const hoi = await db.inboxConversation.findUniqueOrThrow({
      where: { id: kq.conversationId! },
      include: { identity: true },
    });
    expect(hoi.identity.leadId).toBe(cungCoSo.id);
    expect(hoi.identity.linkSource).toBe("PHONE_MATCH");
    const thread = await db.zaloCrmThread.findFirstOrThrow({ where: { orgCode: ORG } });
    expect(thread.leadId).toBe(cungCoSo.id);
  });

  it("[ZC-L7-06] phiếu ở CƠ SỞ KHÁC trùng số ⇒ KHÔNG nối, và KHÔNG tự tạo lead", async () => {
    await db.lead.create({
      data: { parentName: `${P}Mẹ CS2 trùng số`, phone: "84912345678", orgUnitId: CS2 },
    });
    const truoc = await db.lead.count({ where: { parentName: { startsWith: P } } });

    const kq = await chay(payloadTin("cheocoso", { conv: "X1" }));
    if (!kq.ok) throw new Error("phải ok");
    const hoi = await db.inboxConversation.findUniqueOrThrow({
      where: { id: kq.conversationId! },
      include: { identity: true },
    });
    expect(hoi.identity.leadId, "thà mồ côi còn hơn nối nhầm hồ sơ").toBeNull();

    // 🔴 Chốt 9.3/9.5: KHÔNG tự tạo lead. Một người nhắn "alo" không phải một phiếu
    // khách — tạo tự động là bơm rác vào phễu và vào cả số liệu chuyển đổi.
    expect(await db.lead.count({ where: { parentName: { startsWith: P } } })).toBe(truoc);
  });

  it("[ZC-L7-07] TIN ĐẾN không ghi dòng thời gian nào (đừng che 'khách nhắn mà Sale im')", async () => {
    const lead = await db.lead.create({
      data: { parentName: `${P}Mẹ tin đến`, phone: "84912345678", orgUnitId: CS1 },
    });
    await chay(payloadTin("tinden", { conv: "D1" }));
    expect(await db.leadActivity.count({ where: { leadId: lead.id } })).toBe(0);
    const sau = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(sau.firstContactAt, "SLA-3 phải còn kêu").toBeNull();
  });

  it("[ZC-L7-08] TIN ĐI của chủ phiếu ⇒ một dòng MESSAGE mang dấu nguồn zalocrm", async () => {
    const sale = await db.user.create({ data: { name: `${P}Sale CS1`, orgUnitId: CS1 } });
    const lead = await db.lead.create({
      data: {
        parentName: `${P}Mẹ tin đi`,
        phone: "84912345678",
        orgUnitId: CS1,
        assignedToId: sale.id,
      },
    });

    await chay(
      payloadTin("tindi", {
        huong: "DI",
        conv: "E1",
        noiDung: "Dạ bên em có lớp thứ 7 ạ",
        sentByExternalId: sale.id,
      }),
    );

    const dong = await db.leadActivity.findMany({ where: { leadId: lead.id } });
    expect(dong.length).toBe(1);
    expect(dong[0].type).toBe("MESSAGE");
    expect(dong[0].actorId).toBe(sale.id);
    expect(dong[0].content).toBe("[Zalo] Dạ bên em có lớp thứ 7 ạ");
    expect((dong[0].metadata as Record<string, unknown>).via).toBe("zalocrm");

    const sau = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(sau.lastActivityAt, "người gửi LÀ chủ phiếu ⇒ đồng hồ được làm mới").not.toBeNull();
  });

  it("[ZC-L7-09] tin ĐI của phiếu CHƯA GIAO ⇒ NOTE máy, không khoá tự chia", async () => {
    // Ghi `MESSAGE` cho phiếu chưa giao là khoá luôn cơ chế tự chia
    // (`hasSaleInteraction`): phiếu nằm im, không ai được giao, không gì đỏ lên.
    const sale = await db.user.create({ data: { name: `${P}Sale lẻ`, orgUnitId: CS1 } });
    const lead = await db.lead.create({
      data: { parentName: `${P}Mẹ chưa giao`, phone: "84912345678", orgUnitId: CS1 },
    });

    await chay(payloadTin("chuagiao", { huong: "DI", conv: "F1", sentByExternalId: sale.id }));

    const dong = await db.leadActivity.findMany({ where: { leadId: lead.id } });
    expect(dong.length).toBe(1);
    expect(dong[0].type).toBe("NOTE");
    expect((dong[0].metadata as Record<string, unknown>).system).toBe(true);
    const sau = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(sau.firstContactAt, "NOTE máy KHÔNG đóng dấu liên hệ lần đầu").toBeNull();
  });

  it("[ZC-L7-10] tin ĐI và tin ĐẾN của cùng khách rơi vào MỘT hội thoại", async () => {
    // Chiều ĐI, `senderUid` là UID NICK CỦA MÌNH — lấy nhầm nó làm `externalUserId` là
    // đẻ ra một danh tính mang danh nhân viên và tách hội thoại của khách làm đôi.
    const den = await chay(payloadTin("gop1", { conv: "G1" }));
    const di = await chay(payloadTin("gop2", { huong: "DI", conv: "G1" }));
    if (!den.ok || !di.ok) throw new Error("phải ok");
    expect(di.conversationId).toBe(den.conversationId);

    const tin = await db.inboxMessage.findMany({
      where: { conversationId: den.conversationId! },
      orderBy: { direction: "asc" },
    });
    expect(tin.length).toBe(2);
    expect(tin.map((t) => t.direction).sort()).toEqual(["IN", "OUT"]);
    expect(tin.find((t) => t.direction === "OUT")?.sentOutsideSystem).toBe(true);
  });

  it("[ZC-L7-11] `zalo.connected` lặp lại là IDEMPOTENT (mỗi lần restart là một loạt)", async () => {
    const nap = async (ev: string, ts: string) =>
      chay({ event: ev, timestamp: ts, data: { accountId: NICK } });

    await nap("zalo.connected", "2026-09-06T02:00:00.000Z");
    await nap("zalo.connected", "2026-09-06T03:00:00.000Z");
    expect(await db.zaloCrmNick.count({ where: { orgCode: ORG } })).toBe(1);
    let nick = await db.zaloCrmNick.findUniqueOrThrow({ where: { zcrmAccountId: NICK } });
    expect(nick.status).toBe("CONNECTED");
    expect(nick.lastEventAt?.toISOString()).toBe("2026-09-06T03:00:00.000Z");

    // Sự kiện tới LỆCH THỨ TỰ không được kéo lùi mốc — cảnh báo "connected mà im quá
    // N giờ" đọc chính cột này.
    await nap("zalo.connected", "2026-09-06T01:00:00.000Z");
    nick = await db.zaloCrmNick.findUniqueOrThrow({ where: { zcrmAccountId: NICK } });
    expect(nick.lastEventAt?.toISOString()).toBe("2026-09-06T03:00:00.000Z");

    await nap("zalo.disconnected", "2026-09-06T04:00:00.000Z");
    nick = await db.zaloCrmNick.findUniqueOrThrow({ where: { zcrmAccountId: NICK } });
    expect(nick.status).toBe("DISCONNECTED");
  });

  it("[ZC-L7-12] nick ĐÃ GỠ (xoá mềm) không được hồi sinh, nhưng tin vẫn không rơi", async () => {
    await db.zaloCrmNick.create({
      data: {
        zcrmAccountId: NICK,
        orgCode: ORG,
        orgUnitId: CS1,
        deletedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    const kq = await chay(payloadTin("nickgo", { conv: "H1", phone: null }));
    if (!kq.ok) throw new Error("tin không được rơi vì một quyết định vận hành");

    const nick = await db.zaloCrmNick.findUniqueOrThrow({ where: { zcrmAccountId: NICK } });
    expect(nick.deletedAt, "máy không lật lại quyết định của người").not.toBeNull();
    // Vẫn gắn được cơ sở, vì cấu hình cấp org biết nick này thuộc đâu.
    const hoi = await db.inboxConversation.findUniqueOrThrow({
      where: { id: kq.conversationId! },
    });
    expect(hoi.orgUnitId).toBe(CS1);
  });

  it("[ZC-L7-13] hội thoại NHÓM không ingest gì cả (chốt 9.6)", async () => {
    const p = payloadTin("nhom", { conv: "I1" });
    (p.data as Record<string, unknown>).threadType = "group";
    expect(await chay(p)).toMatchObject({ ok: true, trung: false, ghiChu: "HOI_THOAI_NHOM" });
    expect(await db.inboxConversation.count({ where: { accountId: NICK } })).toBe(0);
  });

  it("[ZC-L7-14] hai org khác nhau, CÙNG messageId ⇒ HAI tin (không nuốt im lặng)", async () => {
    // `@@unique([channel, channelMessageId])` KHÔNG kèm accountId. Không có tiền tố
    // org thì tin của org thứ hai bị `ingest*` trả `duplicate:true` — không lỗi, không
    // log, tin biến mất.
    const a = await chay(payloadTin("dungid", { conv: "J1" }), ORG);
    const b = await chay(
      payloadTin("dungid", { conv: "J1", nick: `${NICK}-2` }),
      `${ORG}-2`,
    );
    expect(a).toMatchObject({ ok: true, trung: false });
    expect(b).toMatchObject({ ok: true, trung: false });

    const ids = await db.inboxMessage.findMany({
      where: { channelMessageId: { endsWith: ":m-dungid" } },
      select: { channelMessageId: true },
    });
    expect(ids.map((x) => x.channelMessageId).sort()).toEqual([
      `${ORG}-2:m-dungid`,
      `${ORG}:m-dungid`,
    ]);
  });

  it("[ZC-L7-15] `contact.updated` mang SĐT ⇒ ghi ánh xạ để lượt tin SAU nối được", async () => {
    const lead = await db.lead.create({
      data: { parentName: `${P}Mẹ khai số sau`, phone: "84912345678", orgUnitId: CS1 },
    });

    const kqLienHe = await chay({
      event: "contact.updated",
      data: {
        contactId: `${P}ct-1`,
        changes: { phone: { from: null, to: "0912345678" } },
        contact: { id: `${P}ct-1`, phone: "0912345678" },
      },
    });
    expect(kqLienHe).toMatchObject({ ok: true });

    const thread = await db.zaloCrmThread.findFirstOrThrow({ where: { orgCode: ORG } });
    expect(thread.phone).toBe("84912345678");
    expect(thread.zcrmContactId).toBe(`${P}ct-1`);

    // ⚠️ Nối phiếu xảy ra ở LƯỢT TIN KẾ TIẾP: sự kiện này chỉ mang `contactId`, không
    // mang `conversationId`, mà đường tra "hội thoại nào ứng với luồng ZaloCRM nào"
    // nằm trong `lib/inbox/`. Trễ đúng một tin — hành vi ĐÃ BIẾT, không phải sót.
    const kq = await chay(payloadTin("saukhaiso", { conv: "K1" }));
    if (!kq.ok) throw new Error("phải ok");
    const hoi = await db.inboxConversation.findUniqueOrThrow({
      where: { id: kq.conversationId! },
      include: { identity: true },
    });
    expect(hoi.identity.leadId).toBe(lead.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L12 — DÒNG "ĐẶT TRƯỚC" do nút "Nhắn Zalo" ghi, và phép NỐI HAI ĐẦU.
//
// Bộ L7 ở trên chứng minh đường ĐỌC: có dòng `(orgCode, phone) → leadId` thì webhook
// đầu tiên nối đúng phiếu. Nhưng dòng đó ở đấy là do TEST tự tạo bằng tay — trong mã
// thật KHÔNG AI GHI NÓ (trang `/admin/zalo-crm` khai `lead?: string` mà không đọc).
// Bộ này khoá vế còn lại: Sale bấm nút ⇒ dòng có thật ⇒ tin ĐẦU TIÊN của khách (tin
// KHÔNG kèm số điện thoại) rơi đúng phiếu, không phải vào nhóm mồ côi nối tay.
//
// Vì sao phải chạm DB thật: luật ghi đã có bộ thuần riêng
// (`lib/integrations/zalocrm/dat-truoc.test.ts`); thứ CHỈ tầng DB nói được là
// `@@unique([orgCode, phone])` có thật sự chặn dòng thứ hai không, `scopedDb` có thật
// sự giấu phiếu cơ sở khác không, và hai đầu có khớp nhau không.
// ═══════════════════════════════════════════════════════════════════════════

/** Cơ sở THẬT (bảng `Center`) — `scopedDb` lọc `Lead` theo `centerId`, không theo chuỗi bịa. */
const SLUG_L12 = "zcrm-l12-";

async function purgeL12() {
  await purgeL7();
  // Xoá cơ sở SAU lead (khoá ngoại `Lead.centerId → Center.id`).
  await db.center.deleteMany({ where: { slug: { startsWith: SLUG_L12 } } });
}

async function dungHaiCoSo() {
  const cs1 = await db.center.create({
    data: {
      name: `${P}CS1`,
      slug: `${SLUG_L12}cs1`,
      address: "211 Nguyễn Hữu Thọ",
      code: `${P}CS1`,
    },
  });
  const cs2 = await db.center.create({
    data: {
      name: `${P}CS2`,
      slug: `${SLUG_L12}cs2`,
      address: "114 Hoàng Diệu",
      code: `${P}CS2`,
    },
  });
  return { cs1, cs2 };
}

/** Actor cấp cơ sở — chỉ đủ field mà `scopedDb` và cổng gác của đường ghi đọc. */
function actorCuaCoSo(centerId: string) {
  return {
    userId: "u-l12",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [centerId],
    visibleOrgUnitIds: [CS1],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const SO_KHACH = "84912345678";

describe.skipIf(!CO_BANG)("L12 — dòng ĐẶT TRƯỚC khi Sale bấm nút Nhắn Zalo", () => {
  beforeAll(purgeL12);
  afterAll(purgeL12);
  beforeEach(purgeL12);

  async function datTruoc(o: {
    centerId: string;
    leadId: string;
    compose?: string;
    actorCenterId?: string;
  }) {
    const { datTruocLuongZalo } = await import("@/lib/integrations/zalocrm/dat-truoc");
    return datTruocLuongZalo({
      actor: actorCuaCoSo(o.actorCenterId ?? o.centerId),
      coSo: { centerId: o.centerId, orgCode: ORG },
      compose: o.compose ?? SO_KHACH,
      lead: o.leadId,
    });
  }

  it("[ZC-L12-01] chưa có gì ⇒ tạo đúng một dòng `(orgCode, phone) → leadId`", async () => {
    const { cs1 } = await dungHaiCoSo();
    const lead = await db.lead.create({
      data: { parentName: `${P}Mẹ mới`, phone: SO_KHACH, centerId: cs1.id },
    });

    expect(await datTruoc({ centerId: cs1.id, leadId: lead.id })).toMatchObject({ ma: "DA_TAO" });

    const dong = await db.zaloCrmThread.findFirstOrThrow({ where: { orgCode: ORG } });
    expect(dong.phone, "phải là canonical 84… — đúng dạng nap-su-kien tra").toBe(SO_KHACH);
    expect(dong.leadId).toBe(lead.id);
    expect(dong.centerId).toBe(cs1.id);
    expect(
      dong.zcrmConversationId,
      "hội thoại chưa tồn tại — đó chính là ý nghĩa của 'đặt trước'",
    ).toBeNull();
  });

  it("[ZC-L12-02] bấm hai lần / F5 / hai tab ⇒ vẫn ĐÚNG MỘT dòng, không lỗi", async () => {
    const { cs1 } = await dungHaiCoSo();
    const lead = await db.lead.create({
      data: { parentName: `${P}Mẹ bấm hai lần`, phone: SO_KHACH, centerId: cs1.id },
    });

    expect(await datTruoc({ centerId: cs1.id, leadId: lead.id })).toMatchObject({ ma: "DA_TAO" });
    expect(await datTruoc({ centerId: cs1.id, leadId: lead.id })).toMatchObject({ ma: "DA_DUNG" });
    expect(await db.zaloCrmThread.count({ where: { orgCode: ORG } })).toBe(1);
  });

  it("[ZC-L12-03] 🔴 dòng đã nối hội thoại THẬT của phiếu khác ⇒ không đè gì cả", async () => {
    const { cs1 } = await dungHaiCoSo();
    const leadCu = await db.lead.create({
      data: { parentName: `${P}Mẹ phiếu cũ`, phone: SO_KHACH, centerId: cs1.id },
    });
    const leadMoi = await db.lead.create({
      data: { parentName: `${P}Mẹ phiếu trùng số`, phone: SO_KHACH, centerId: cs1.id },
    });
    await db.zaloCrmThread.create({
      data: {
        orgCode: ORG,
        phone: SO_KHACH,
        leadId: leadCu.id,
        zcrmConversationId: `${P}conv-CU`,
        centerId: cs1.id,
      },
    });

    expect(await datTruoc({ centerId: cs1.id, leadId: leadMoi.id })).toMatchObject({
      ma: "GIU_ANH_XA_CU",
    });

    const dong = await db.zaloCrmThread.findFirstOrThrow({ where: { orgCode: ORG } });
    expect(dong.leadId, "lịch sử chat của khách không được chuyển sang phiếu khác").toBe(leadCu.id);
    expect(dong.zcrmConversationId).toBe(`${P}conv-CU`);
    expect(await db.zaloCrmThread.count({ where: { orgCode: ORG } })).toBe(1);
  });

  it("[ZC-L12-03b] dòng đã có hội thoại nhưng CHƯA có phiếu ⇒ điền phiếu, giữ hội thoại", async () => {
    const { cs1 } = await dungHaiCoSo();
    const lead = await db.lead.create({
      data: { parentName: `${P}Mẹ nối tay`, phone: SO_KHACH, centerId: cs1.id },
    });
    await db.zaloCrmThread.create({
      data: { orgCode: ORG, phone: SO_KHACH, zcrmConversationId: `${P}conv-MC`, centerId: cs1.id },
    });

    expect(await datTruoc({ centerId: cs1.id, leadId: lead.id })).toMatchObject({
      ma: "DA_CAP_NHAT",
    });
    const dong = await db.zaloCrmThread.findFirstOrThrow({ where: { orgCode: ORG } });
    expect(dong.leadId).toBe(lead.id);
    expect(dong.zcrmConversationId).toBe(`${P}conv-MC`);
  });

  it("[ZC-L12-04] số sai dạng / lệch số của phiếu ⇒ KHÔNG ghi dòng nào", async () => {
    const { cs1 } = await dungHaiCoSo();
    const lead = await db.lead.create({
      data: { parentName: `${P}Mẹ số lệch`, phone: SO_KHACH, centerId: cs1.id },
    });

    // Số cố định: `canonicalPhone` trả null ⇒ dòng ghi ra sẽ không bao giờ tra tới.
    expect(
      await datTruoc({ centerId: cs1.id, leadId: lead.id, compose: "02363123456" }),
    ).toMatchObject({ ma: "SO_KHONG_HOP_LE" });

    // Cặp (số, phiếu) lệch chỉ đến từ URL sửa tay — ghi được là hội thoại của người
    // này nằm trong hồ sơ người kia ngay từ tin đầu tiên.
    expect(
      await datTruoc({ centerId: cs1.id, leadId: lead.id, compose: "84905000111" }),
    ).toMatchObject({ ma: "SO_LECH_PHIEU" });

    expect(await db.zaloCrmThread.count({ where: { orgCode: ORG } })).toBe(0);
  });

  it("[ZC-L12-05] 🔴 phiếu NGOÀI tầm nhìn (cơ sở khác) ⇒ không ghi, kể cả khi gõ tay id", async () => {
    const { cs1, cs2 } = await dungHaiCoSo();
    const leadCs2 = await db.lead.create({
      data: { parentName: `${P}Mẹ CS2`, phone: SO_KHACH, centerId: cs2.id },
    });

    // Người CS1 gõ tay `?lead=<id phiếu CS2>`: `scopedDb` không thấy phiếu ⇒ dừng.
    expect(
      await datTruoc({ centerId: cs1.id, leadId: leadCs2.id, actorCenterId: cs1.id }),
    ).toMatchObject({ ma: "KHONG_DOC_DUOC_PHIEU" });

    // Và người CS1 cũng không đặt trước được vào ORG của CS2 (bảng ở SCOPE_EXEMPT nên
    // `scopedDb` KHÔNG che — cổng phải nằm trong chính đường ghi).
    expect(
      await datTruoc({ centerId: cs2.id, leadId: leadCs2.id, actorCenterId: cs1.id }),
    ).toMatchObject({ ma: "NGOAI_TAM_NHIN" });

    expect(await db.zaloCrmThread.count({ where: { orgCode: ORG } })).toBe(0);
  });

  it("[ZC-L12-06] 🔴 NỐI HAI ĐẦU: đặt trước xong, tin ĐẦU TIÊN của khách vào đúng phiếu", async () => {
    // Đây là lý do tồn tại của cả lô. Tin đầu tiên KHÔNG kèm số điện thoại, nên nếu
    // không có dòng đặt trước thì hội thoại nằm nhóm mồ côi và phải nối tay.
    const { cs1 } = await dungHaiCoSo();
    const lead = await db.lead.create({
      data: { parentName: `${P}Mẹ hai đầu`, phone: SO_KHACH, centerId: cs1.id, orgUnitId: CS1 },
    });

    expect(await datTruoc({ centerId: cs1.id, leadId: lead.id })).toMatchObject({ ma: "DA_TAO" });

    const kq = await chay(payloadTin("haidau", { conv: "L1" }));
    if (!kq.ok) throw new Error("phải ok");

    const hoi = await db.inboxConversation.findUniqueOrThrow({
      where: { id: kq.conversationId! },
      include: { identity: true },
    });
    expect(hoi.identity.leadId, "ý định tường minh của con người thắng mọi phép suy đoán").toBe(
      lead.id,
    );
    expect(hoi.identity.linkSource).toBe("EXTERNAL_TAG");

    const dong = await db.zaloCrmThread.findFirstOrThrow({ where: { orgCode: ORG } });
    expect(dong.zcrmConversationId, "webhook điền nốt id hội thoại vào dòng đặt trước").toBe(
      `${P}conv-L1`,
    );
    expect(await db.zaloCrmThread.count({ where: { orgCode: ORG } })).toBe(1);
  });
});
