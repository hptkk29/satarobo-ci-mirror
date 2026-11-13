// @vitest-environment node
/**
 * AI LEAD GATEWAY — TRANH CHẤP · IDEMPOTENCY · GỘP HỒ SƠ · VẬN HÀNH (Postgres THẬT).
 *
 * Những thứ KHÔNG test thuần nào chứng minh được vì chúng nằm ở khoá hàng / chỉ mục duy nhất / giao dịch:
 *   · 20 yêu cầu song song CÙNG key ⇒ 1 lần ghi, 19 lần phát lại;
 *   · 20 yêu cầu song song KHÁC key cùng hội thoại ⇒ VẪN đúng 1 hồ sơ mở;
 *   · nonce song song ⇒ đúng 1 thắng; replay · 409 · gộp ứng viên · không "hạ cấp" tên Facebook;
 *   · handoff song song ⇒ đúng 1 tin chờ; sự cố gộp theo NGÀY VN; thăm dò ack một lần; catalog 304; cron dọn.
 *
 * Mã ca: [AIL-DT-*]. ⚠️ Bộ này TỰ SKIP khi không có Postgres test (db-gate) — thấy SKIP nghĩa là CHƯA KIỂM ĐƯỢC GÌ.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTenDbTest, RUN_DB_TESTS } from "../_helpers/db-gate";

const mk = vi.hoisted(() => ({
  auto: false,
  taoLead: vi.fn(),
  baoHoSo: vi.fn(),
  baoSla: vi.fn(),
  baoSuCo: vi.fn(),
}));
vi.mock("@/lib/rate-limit", async () => {
  const that = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  // Khoá ngẫu nhiên mỗi lượt ⇒ KHÔNG giới hạn: bộ này đo tranh chấp, không đo hạn mức (hạn mức ở xac-thuc.test.ts).
  return { ...that, rateLimit: (a: { key: string; max: number; windowMs: number }) => that.rateLimit({ ...a, key: `${a.key}:${Math.random()}` }) };
});
vi.mock("@/lib/ai-lead/cai-dat", async (goc) => {
  const that = await goc<typeof import("@/lib/ai-lead/cai-dat")>();
  return { ...that, congProd: async () => ({ allowed: true, reason: "OK", thieu: [] }), docCaiDat: async () => ({ ...(await that.docCaiDat()), autoCreateEnabled: mk.auto }) };
});
vi.mock("@/lib/ai-lead/dich-vu/thong-bao", async (goc) => {
  const that = await goc<typeof import("@/lib/ai-lead/dich-vu/thong-bao")>();
  return { ...that, baoHoSoCanXuLy: mk.baoHoSo, baoQuaHan: mk.baoSla, baoSuCoAgent: mk.baoSuCo };
});
vi.mock("@/lib/ai-lead/dich-vu/tao-lead", () => ({ taoLeadTuHoSo: mk.taoLead }));

import { db } from "@/lib/db";
import { docFixture } from "@/lib/ai-lead/ho-tro-test";
import { docPhanHoi } from "@/lib/ai-lead/ho-tro-yeu-cau-test";
import { chayDonDep } from "@/lib/ai-lead/dich-vu/don-dep";
import { tinhEtag } from "@/lib/ai-lead/dich-vu/cau-hinh-thuan";
import { doiViecNen } from "@/lib/ai-lead/dich-vu/nen";
import { AGENT_KHAC, AGENT_TEST, batMoiTruong, don, donHoiThoai, dung, goi, PAGE } from "./_nen";

// Tranh chấp 20 yêu cầu trên pool 5 kết nối (lib/db.ts) chậm hơn mặc định 5 s của vitest.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const RUN = RUN_DB_TESTS;
if (!RUN) console.warn("[ai-lead-dt] SKIP: DATABASE_URL không trỏ Postgres test cục bộ / thiếu ALLOW_DB_RESET.");

type Th = Record<string, unknown>;
const PSID = "7000000000000001";
const sha40 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 40);
const khoa = (kind: string, seed: string, v = 1) => `${kind}:${sha40(seed)}:v${v}`;

/** Thân /lead-intakes dựng từ fixture 10 với key/mid riêng theo `seed`. */
function thanIntake(seed: string, sua: (b: Th) => void = () => undefined): Th {
  const b = JSON.parse(JSON.stringify(docFixture("10").request.body)) as Th;
  b.idempotencyKey = khoa(String(b.intent), seed);
  b.evidence = { phoneMessageMid: `m_phone_${seed}`, campusMessageMid: `m_campus_${seed}` };
  sua(b);
  return b;
}
function thanHandoff(seed: string): Th {
  const b = JSON.parse(JSON.stringify(docFixture("20").request.body)) as Th;
  b.idempotencyKey = khoa("HANDOFF", seed);
  return b;
}
function thanIncident(seed: string, sua: (b: Th) => void = () => undefined): Th {
  const b = JSON.parse(JSON.stringify(docFixture("30").request.body)) as Th;
  b.idempotencyKey = khoa("INCIDENT", seed);
  sua(b);
  return b;
}
const goiDoc = async (...a: Parameters<typeof goi>) => {
  const p = await docPhanHoi(await goi(...a));
  await doiViecNen();
  return p;
};
const dem = (ds: { status: number; header: Record<string, string> }[], f: (p: { status: number; header: Record<string, string> }) => boolean) => ds.filter(f).length;
const hoSoCuaAgent = () => db.aiLeadDraft.findMany({ where: { conversation: { agentId: AGENT_TEST } }, orderBy: { createdAt: "asc" } });

describe.skipIf(!RUN)("AI Lead Gateway — tranh chấp, idempotency, vận hành (Postgres thật)", () => {
  let khoiPhuc: () => void;
  let coSo: Record<"CS1" | "CS2" | "CS3", string>;
  beforeAll(async () => {
    assertTenDbTest();
    khoiPhuc = batMoiTruong();
    coSo = (await dung()).coSo;
  });
  afterAll(async () => {
    await db.orgUnit.deleteMany({ where: { code: { startsWith: "AILTG_" } } });
    await don();
    khoiPhuc();
    await db.$disconnect();
  });
  beforeEach(async () => {
    mk.auto = false;
    for (const f of [mk.taoLead, mk.baoHoSo, mk.baoSla, mk.baoSuCo]) f.mockReset();
    mk.taoLead.mockResolvedValue({ ok: true, leadId: "lead_x", duplicate: false });
    mk.baoHoSo.mockResolvedValue(undefined);
    mk.baoSla.mockResolvedValue(undefined);
    mk.baoSuCo.mockResolvedValue(undefined);
    await donHoiThoai();
    await db.aiLeadAgentPage.deleteMany({ where: { OR: [{ agentId: AGENT_TEST, pageId: PAGE_THEM }, { agentId: AGENT_KHAC, pageId: PAGE }] } });
    await db.aiLeadAgentPage.updateMany({ where: { agentId: AGENT_TEST }, data: { routingCenterId: null, autoCreate: false } }); // autoCreate: cờ tự tạo lead RIÊNG của Page (E2), mặc định TẮT
    await db.aiLeadCatalogSnapshot.upsert({
      where: { version: 7 },
      update: {},
      create: { version: 7, publishedById: "ailtg", etag: "cat-7-a1b2c3", payload: (docFixture("01").response.body as { data: object }).data, publishedAt: new Date("2026-10-26T02:00:00.000Z") },
    });
  });

  describe("[AIL-DT-01] 20 yêu cầu song song CÙNG idempotencyKey (nonce khác nhau)", () => {
    it("⇒ đúng 1 hồ sơ · 1 hội thoại · 1 dòng idempotency; 1 bản gốc + 19 bản PHÁT LẠI giống hệt", async () => {
      const than = thanIntake("dt01");
      const ds = await Promise.all(Array.from({ length: 20 }, () => goiDoc("leadIntakes", { than })));
      expect(ds.map((p) => p.status)).toEqual(Array(20).fill(200));
      expect(dem(ds, (p) => p.header["idempotent-replay"] === "true")).toBe(19);
      expect(new Set(ds.map((p) => JSON.stringify(p.body))).size, "mọi phản hồi (receiptId, requestId) giống nhau").toBe(1);
      expect((await hoSoCuaAgent()).length).toBe(1);
      expect(await db.aiLeadConversation.count({ where: { agentId: AGENT_TEST } })).toBe(1);
      expect(await db.aiLeadRequest.count({ where: { agentId: AGENT_TEST } })).toBe(1);
    });

    it("cùng key mà thân KHÁC (song song) ⇒ đúng 1 thắng; phần còn lại 409", async () => {
      const a = thanIntake("dt01b");
      const b = thanIntake("dt01b", (x) => {
        (x.candidate as Th).campusCode = "CS2";
      });
      b.idempotencyKey = a.idempotencyKey;
      const ds = await Promise.all(Array.from({ length: 10 }, (_, i) => goiDoc("leadIntakes", { than: i % 2 === 0 ? a : b })));
      const loai = new Set(ds.map((p) => p.status));
      expect([...loai].sort()).toEqual([200, 409]);
      expect((await hoSoCuaAgent()).length).toBe(1);
    });
  });

  describe("[AIL-DT-02] 20 yêu cầu song song KHÁC key trên CÙNG hội thoại", () => {
    it("⇒ vẫn đúng 1 hồ sơ MỞ (khoá hàng hội thoại), version tăng đủ, mọi lượt 200", async () => {
      const ds = await Promise.all(Array.from({ length: 20 }, (_, i) => goiDoc("leadIntakes", { than: thanIntake(`dt02-${i}`) })));
      expect(ds.map((p) => p.status)).toEqual(Array(20).fill(200));
      const hs = await hoSoCuaAgent();
      expect(hs.length, "đúng một hồ sơ mở").toBe(1);
      expect(hs[0]!.version, "1 lần tạo + 19 lần gộp").toBe(20);
      expect(await db.aiLeadConversation.count({ where: { agentId: AGENT_TEST } })).toBe(1);
      expect(await db.aiLeadRequest.count({ where: { agentId: AGENT_TEST } })).toBe(20);
    });

    it("hai INTENT khác nhau cùng hội thoại ⇒ hai hồ sơ (gộp theo (hội thoại, intent))", async () => {
      const a = thanIntake("dt02i-a");
      const b = thanIntake("dt02i-b", (x) => {
        x.intent = "ENROLLMENT_REQUEST";
        x.idempotencyKey = khoa("ENROLLMENT_REQUEST", "dt02i-b");
      });
      await Promise.all([goiDoc("leadIntakes", { than: a }), goiDoc("leadIntakes", { than: b })]);
      expect((await hoSoCuaAgent()).map((h) => h.intent).sort()).toEqual(["CONSULTATION_REQUEST", "ENROLLMENT_REQUEST"]);
    });

    it("hồ sơ đã ĐÓNG (REJECTED) ⇒ lượt kế tạo hồ sơ MỚI, không sống lại hồ sơ cũ", async () => {
      await goiDoc("leadIntakes", { than: thanIntake("dt02c-1") });
      await db.aiLeadDraft.updateMany({ where: { conversation: { agentId: AGENT_TEST } }, data: { state: "REJECTED", closedAt: new Date() } });
      await goiDoc("leadIntakes", { than: thanIntake("dt02c-2") });
      const hs = await hoSoCuaAgent();
      expect(hs.map((h) => h.state)).toEqual(["REJECTED", "READY_FOR_REVIEW"]);
    });
  });

  describe("[AIL-DT-02d] hồ sơ đã ra lead / đang do nhân viên giữ không bị yêu cầu mới nuốt hoặc đè (review độc lập 27/10)", () => {
    it("ASSIGNMENT_PENDING (lead đã tạo, chờ chia chủ) ⇒ lượt kế cùng intent mở hồ sơ MỚI, hồ sơ cũ giữ nguyên", async () => {
      await goiDoc("leadIntakes", { than: thanIntake("dt02d-1") });
      await db.aiLeadDraft.updateMany({ where: { conversation: { agentId: AGENT_TEST } }, data: { state: "ASSIGNMENT_PENDING", leadId: "lead_cu", resultNote: "lead-chua-co-chu" } });
      const truoc = (await hoSoCuaAgent())[0]!;
      await goiDoc("leadIntakes", { than: thanIntake("dt02d-2", (x) => ((x.candidate as Th).phoneRaw = "0912345678")) });
      const hs = await hoSoCuaAgent();
      expect(hs.map((h) => h.state)).toEqual(["ASSIGNMENT_PENDING", "READY_FOR_REVIEW"]);
      expect(hs[0]!.phoneRaw, "hồ sơ đã ra lead không bị ghi đè").toBe(truoc.phoneRaw);
      expect(hs[0]!.version).toBe(truoc.version);
      expect(hs[1]!.phoneRaw).toBe("0912345678");
    });

    it("IN_PROGRESS do nhân viên CS1 nhận ⇒ Agent gửi cơ sở CS2 + SĐT khác: hồ sơ KHÔNG đổi (centerId, campusCenterId, phone), phản hồi vẫn 200", async () => {
      await goiDoc("leadIntakes", { than: thanIntake("dt02e-1") });
      await db.aiLeadDraft.updateMany({
        where: { conversation: { agentId: AGENT_TEST } },
        data: { state: "IN_PROGRESS", claimedById: "nv-cs1", claimedAt: new Date(), centerId: coSo.CS1, campusCenterId: coSo.CS1, campusCode: "CS1" },
      });
      const truoc = (await hoSoCuaAgent())[0]!;
      mk.baoHoSo.mockClear(); // lượt đầu (tạo hồ sơ) đã báo; đo riêng lượt thứ hai
      const p = await goiDoc("leadIntakes", {
        than: thanIntake("dt02e-2", (x) => {
          (x.candidate as Th).campusCode = "CS2";
          (x.candidate as Th).phoneRaw = "0988777666";
        }),
      });
      expect(p.status).toBe(200);
      const sau = (await hoSoCuaAgent())[0]!;
      expect({ c: sau.centerId, cc: sau.campusCenterId, code: sau.campusCode, phone: sau.phoneRaw, v: sau.version, state: sau.state }).toEqual({
        c: coSo.CS1,
        cc: coSo.CS1,
        code: "CS1",
        phone: truoc.phoneRaw,
        v: truoc.version,
        state: "IN_PROGRESS",
      });
      expect(mk.baoHoSo).not.toHaveBeenCalled();
    });
  });

  describe("[AIL-DT-03] nonce song song", () => {
    it("20 yêu cầu CÙNG nonce, khác key ⇒ đúng 1 thành công, 19 NONCE_REUSED; chỉ 1 dòng nonce", async () => {
      const nonce = "nonce-song-song-0000000001";
      const ds = await Promise.all(Array.from({ length: 20 }, (_, i) => goiDoc("leadIntakes", { than: thanIntake(`dt03-${i}`), nonce })));
      expect(dem(ds, (p) => p.status === 200)).toBe(1);
      expect(dem(ds, (p) => p.status === 401)).toBe(19);
      expect(await db.aiLeadNonce.count({ where: { agentId: AGENT_TEST, nonce } })).toBe(1);
      expect((await hoSoCuaAgent()).length).toBe(1);
    });
    it("nonce CHỈ ghi sau xác thực: chữ ký sai ⇒ không có dòng nonce nào", async () => {
      const nonce = "nonce-chu-ky-sai-00000001";
      const p = await goiDoc("leadIntakes", { than: thanIntake("dt03b"), nonce, sigGhiDe: "0".repeat(64) });
      expect(p.status).toBe(401);
      expect(await db.aiLeadNonce.count({ where: { nonce } })).toBe(0);
    });
  });

  describe("[AIL-DT-04] replay · 409 · nội dung", () => {
    it("gửi lại đúng thân (nonce mới) ⇒ phản hồi cũ giống hệt + Idempotent-Replay; không ghi thêm", async () => {
      const than = thanIntake("dt04");
      const a = await goiDoc("leadIntakes", { than });
      const b = await goiDoc("leadIntakes", { than });
      expect(b.header["idempotent-replay"]).toBe("true");
      expect(a.header["idempotent-replay"]).toBeUndefined();
      expect(b.body).toEqual(a.body);
      const h = await hoSoCuaAgent();
      expect(h.length).toBe(1);
      expect(h[0]!.version).toBe(1);
    });
    it("thân khác thứ tự khoá / khoảng trắng vẫn là CÙNG nội dung (replay chứ không 409)", async () => {
      const than = thanIntake("dt04b");
      const a = await goiDoc("leadIntakes", { than });
      const dao = JSON.stringify(Object.fromEntries(Object.entries(than).reverse()), null, 2);
      const b = await goiDoc("leadIntakes", { than: dao });
      expect(b.status).toBe(200);
      expect(b.body).toEqual(a.body);
    });
    it("cùng key, nội dung khác ⇒ 409 và KHÔNG đổi hồ sơ", async () => {
      const a = thanIntake("dt04c");
      await goiDoc("leadIntakes", { than: a });
      const khac = JSON.parse(JSON.stringify(a)) as Th;
      (khac.candidate as Th).campusCode = "CS2";
      const r = await goiDoc("leadIntakes", { than: khac });
      expect(r.status).toBe(409);
      const h = (await hoSoCuaAgent())[0]!;
      expect(h.campusCode).toBe("CS1");
      expect(h.version).toBe(1);
    });
    it("khoá idempotency tính THEO agent: agent khác dùng cùng key không đụng nhau", async () => {
      const t1 = thanIntake("dt04d");
      await goiDoc("leadIntakes", { than: t1 });
      await db.aiLeadAgentPage.create({ data: { agentId: AGENT_KHAC, pageId: PAGE } });
      const r = await goiDoc("leadIntakes", { than: t1, agentId: AGENT_KHAC });
      expect(r.status).toBe(200);
      expect(r.header["idempotent-replay"]).toBeUndefined();
      expect(await db.aiLeadConversation.count({ where: { pageId: PAGE, psid: PSID } })).toBe(2);
    });
    it("replay trả lại phản hồi của lần đầu kể cả khi catalog đã đổi (ví dụ cơ sở ngừng nhận)", async () => {
      const than = thanIntake("dt04e");
      const a = await goiDoc("leadIntakes", { than });
      await db.aiLeadCatalogSnapshot.create({
        data: {
          version: 8,
          publishedById: "ailtg",
          etag: "cat-8",
          payload: { pages: [{ pageId: PAGE, campuses: [{ campusCode: "CS1", name: "CS1", address: "x", acceptingLeads: false }] }] },
        },
      });
      const b = await goiDoc("leadIntakes", { than });
      expect(b.body).toEqual(a.body);
      expect((b.body as { data: { status: string } }).data.status).toBe("ACCEPTED");
      await db.aiLeadCatalogSnapshot.deleteMany({ where: { version: 8 } });
    });
  });

  describe("[AIL-DT-05] gộp ứng viên giữa các lượt (candidate GỒM TẤT CẢ cái đã biết)", () => {
    it("lượt 1 chỉ SĐT ⇒ NEED_INFO[campus]; lượt 2 chỉ cơ sở ⇒ ACCEPTED (SĐT lượt 1 vẫn được tính); một hồ sơ, đủ điều kiện", async () => {
      const l1 = thanIntake("dt05-1", (b) => {
        b.candidate = { phoneRaw: "0905123456" };
        b.evidence = { phoneMessageMid: "m_phone_dt05" };
      });
      const r1 = await goiDoc("leadIntakes", { than: l1 });
      expect((r1.body as { data: Th }).data).toMatchObject({ status: "NEED_INFO", askFields: ["campus"] });
      const l2 = thanIntake("dt05-2", (b) => {
        b.candidate = { campusCode: "CS1" };
        b.evidence = { campusMessageMid: "m_campus_dt05" };
      });
      const r2 = await goiDoc("leadIntakes", { than: l2 });
      expect((r2.body as { data: Th }).data).toMatchObject({ status: "ACCEPTED", nextAction: "ACKNOWLEDGE_GENERIC" });
      const hs = await hoSoCuaAgent();
      expect(hs.length).toBe(1);
      expect(hs[0]).toMatchObject({ state: "READY_FOR_REVIEW", phoneCanonical: "84905123456", campusCode: "CS1", campusCenterId: coSo.CS1, centerId: coSo.CS1, missingFields: [] });
      expect(hs[0]!.evidence).toMatchObject({ phoneMessageMid: "m_phone_dt05", campusMessageMid: "m_campus_dt05" });
    });

    it("khách ĐỔI cơ sở sang cơ sở đã ngừng nhận ⇒ INVALID_SELECTION và hồ sơ quay lại thiếu cơ sở", async () => {
      await goiDoc("leadIntakes", { than: thanIntake("dt05b-1") });
      const r = await goiDoc("leadIntakes", {
        than: thanIntake("dt05b-2", (b) => {
          b.candidate = { campusCode: "CS3" };
          b.evidence = { campusMessageMid: "m_campus_cs3" };
        }),
      });
      expect((r.body as { data: Th }).data).toMatchObject({ status: "INVALID_SELECTION", refreshCatalog: true });
      const h = (await hoSoCuaAgent())[0]!;
      expect(h.campusCenterId).toBeNull();
      expect(h.missingFields).toContain("campus");
    });

    it("`evidence.staff` (dấu xác minh của nhân viên) KHÔNG bị mất khi Agent gửi thêm dữ liệu — MERGE chứ không thay", async () => {
      await goiDoc("leadIntakes", { than: thanIntake("dt05c-1") });
      const h0 = (await hoSoCuaAgent())[0]!;
      await db.aiLeadDraft.update({ where: { id: h0.id }, data: { evidence: { ...(h0.evidence as object), staff: { fbName: { v: "Phụ huynh Minh Anh", by: "u1", at: "2026-10-27T00:00:00.000Z" } } } } });
      await goiDoc("leadIntakes", { than: thanIntake("dt05c-2") });
      const h1 = (await hoSoCuaAgent())[0]!;
      expect((h1.evidence as { staff?: object }).staff).toEqual({ fbName: { v: "Phụ huynh Minh Anh", by: "u1", at: "2026-10-27T00:00:00.000Z" } });
    });

    it("tên khách TỰ KHAI không hạ cấp tên Meta: phản hồi vẫn ACCEPTED, hội thoại giữ tên + nguồn Meta", async () => {
      await goiDoc("leadIntakes", { than: thanIntake("dt05d-1") });
      const r = await goiDoc("leadIntakes", {
        than: thanIntake("dt05d-2", (b) => {
          (b.conversation as Th).fbName = "tên tự gõ";
          (b.conversation as Th).fbNameSource = "CUSTOMER_STATED";
        }),
      });
      expect((r.body as { data: Th }).data).toMatchObject({ status: "ACCEPTED" });
      const hoi = await db.aiLeadConversation.findFirstOrThrow({ where: { agentId: AGENT_TEST } });
      expect(hoi).toMatchObject({ fbName: "Phụ huynh Minh Anh", fbNameSource: "META_PROFILE_API" });
    });

    it("lượt sau fbName=null KHÔNG xoá tên đã có", async () => {
      await goiDoc("leadIntakes", { than: thanIntake("dt05e-1") });
      await goiDoc("leadIntakes", {
        than: thanIntake("dt05e-2", (b) => {
          b.conversation = { pageId: PAGE, psid: PSID, fbName: null };
        }),
      });
      expect((await db.aiLeadConversation.findFirstOrThrow({ where: { agentId: AGENT_TEST } })).fbName).toBe("Phụ huynh Minh Anh");
    });
  });

  describe("[AIL-DT-06] hội thoại do NGƯỜI giữ (ownerState ≠ AI_ACTIVE)", () => {
    it.each(["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"] as const)(
      "%s ⇒ phản hồi LUÔN HUMAN_QUEUED (kể cả khi thiếu SĐT) nhưng dữ liệu khách VẪN được lưu",
      async (os) => {
        await db.aiLeadConversation.create({ data: { agentId: AGENT_TEST, pageId: PAGE, psid: PSID, ownerState: os } });
        const r = await goiDoc("leadIntakes", {
          than: thanIntake(`dt06-${os}`, (b) => {
            b.candidate = { phoneRaw: "0236 3123 456" };
            b.evidence = { phoneMessageMid: "m_phone_dt06" };
          }),
        });
        expect((r.body as { data: Th }).data).toMatchObject({ status: "HUMAN_QUEUED", nextAction: "TELL_STAFF_WILL_CONTACT" });
        expect((r.body as { data: Th }).data).not.toHaveProperty("askFields");
        const hs = await hoSoCuaAgent();
        expect(hs.length).toBe(1);
        expect(hs[0]).toMatchObject({ phoneRaw: "0236 3123 456", phoneCanonical: null, state: "PENDING_INFO" });
        expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe("[AIL-DT-07] cơ sở xử lý · SLA · thông báo SAU commit", () => {
    it("khách chưa chọn cơ sở ⇒ centerId = routingCenterId của Page; chọn rồi ⇒ cơ sở khách chọn", async () => {
      await db.aiLeadAgentPage.updateMany({ where: { agentId: AGENT_TEST }, data: { routingCenterId: coSo.CS2 } });
      await goiDoc("leadIntakes", {
        than: thanIntake("dt07-1", (b) => {
          b.candidate = { phoneRaw: "0905123456" };
          b.evidence = { phoneMessageMid: "m_phone_dt07" };
        }),
      });
      expect((await hoSoCuaAgent())[0]!.centerId).toBe(coSo.CS2);
      await goiDoc("leadIntakes", { than: thanIntake("dt07-2") });
      expect((await hoSoCuaAgent())[0]!.centerId).toBe(coSo.CS1);
    });

    it("không có routing và khách chưa chọn ⇒ centerId NULL (chỉ HO thấy), không đoán", async () => {
      await goiDoc("leadIntakes", {
        than: thanIntake("dt07b", (b) => {
          b.candidate = { phoneRaw: "0905123456" };
          b.evidence = { phoneMessageMid: "m_phone_dt07b" };
        }),
      });
      expect((await hoSoCuaAgent())[0]!.centerId).toBeNull();
    });

    it("orgUnitId ghi KÉP khi cơ sở có OrgUnit", async () => {
      // DB dùng chung với các bộ DB chạy trước trong CI: Center CS1 có thể ĐÃ có OrgUnit (mỗi Center một OrgUnit — `centerId` duy nhất). Dùng lại nếu có, chỉ tạo + dọn khi chưa có.
      const co = await db.orgUnit.findFirst({ where: { centerId: coSo.CS1, type: "CENTER", deletedAt: null }, select: { id: true } });
      const ou = co ?? (await db.orgUnit.create({ data: { type: "CENTER", code: "AILTG_CS1", name: "AILTG CS1", centerId: coSo.CS1 } }));
      await goiDoc("leadIntakes", { than: thanIntake("dt07c") });
      expect((await hoSoCuaAgent())[0]).toMatchObject({ centerId: coSo.CS1, orgUnitId: ou.id });
      await db.aiLeadDraft.deleteMany({ where: { conversation: { agentId: AGENT_TEST } } });
      if (!co) await db.orgUnit.delete({ where: { id: ou.id } });
    });

    it("hồ sơ đủ điều kiện ⇒ READY_FOR_REVIEW, đặt SLA theo tham số, báo QLCS đúng MỘT lần (lần gộp sau không báo lại)", async () => {
      await goiDoc("leadIntakes", { than: thanIntake("dt07d-1") });
      const h = (await hoSoCuaAgent())[0]!;
      expect(h.state).toBe("READY_FOR_REVIEW");
      expect(h.slaClaimDueAt!.getTime() - h.createdAt.getTime()).toBeGreaterThan(29 * 60_000);
      expect(h.slaClaimDueAt!.getTime() - h.createdAt.getTime()).toBeLessThan(31 * 60_000);
      expect(h.slaResolveDueAt).not.toBeNull();
      expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
      expect(mk.baoHoSo).toHaveBeenCalledWith(expect.objectContaining({ draftId: h.id, centerId: coSo.CS1 }));
      const han = h.slaClaimDueAt!.getTime();
      await goiDoc("leadIntakes", { than: thanIntake("dt07d-2") });
      expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
      expect((await hoSoCuaAgent())[0]!.slaClaimDueAt!.getTime(), "SLA chỉ đặt MỘT lần — đặt lại mỗi lượt gộp thì không bao giờ tới hạn").toBe(han);
    });

    it("hồ sơ còn COLLECTING (Agent còn hỏi) ⇒ KHÔNG báo, KHÔNG đặt SLA", async () => {
      await goiDoc("leadIntakes", {
        than: thanIntake("dt07e", (b) => {
          b.candidate = { phoneRaw: "0905123456" };
          b.evidence = { phoneMessageMid: "m_phone_dt07e" };
        }),
      });
      const h = (await hoSoCuaAgent())[0]!;
      expect(h.state).toBe("COLLECTING");
      expect(h.slaClaimDueAt).toBeNull();
      expect(mk.baoHoSo).not.toHaveBeenCalled();
    });

    it("CHỈ thiếu tên Facebook (fixture 14) ⇒ WAITING_QLCS + báo", async () => {
      await goiDoc("leadIntakes", { than: docFixture("14").request.body });
      expect((await hoSoCuaAgent())[0]!.state).toBe("WAITING_QLCS");
      expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
    });

    it("hồ sơ IN_PROGRESS (nhân viên đã nhận) KHÔNG bị kéo lùi và KHÔNG đổi cơ sở khi Agent gửi thêm dữ liệu", async () => {
      await goiDoc("leadIntakes", { than: thanIntake("dt07f-1") });
      const h0 = (await hoSoCuaAgent())[0]!;
      await db.aiLeadDraft.update({ where: { id: h0.id }, data: { state: "IN_PROGRESS", claimedById: "u1", claimedAt: new Date() } });
      await goiDoc("leadIntakes", {
        than: thanIntake("dt07f-2", (b) => {
          b.candidate = { phoneRaw: "0912345678", campusCode: "CS2" };
          b.evidence = { phoneMessageMid: "m_phone_dt07f2", campusMessageMid: "m_campus_dt07f2" };
        }),
      });
      const h1 = (await hoSoCuaAgent())[0]!;
      expect(h1.state).toBe("IN_PROGRESS");
      expect(h1.centerId).toBe(coSo.CS1);
      // Đảo luật cũ (review độc lập 27/10): hồ sơ nhân viên đã nhận KHÔNG bị Agent đè SĐT/cơ sở — kẻo lead ra ở cơ sở khác với cơ sở nhân viên duyệt.
      expect(h1.phoneCanonical).toBe(h0.phoneCanonical);
      expect(h1.campusCenterId).toBe(h0.campusCenterId);
      expect(h1.version).toBe(h0.version); // Gateway không ghi gì
    });
  });

  describe("[AIL-DT-08] tự tạo lead (ai.autoCreateEnabled)", () => {
    it("TẮT (mặc định) ⇒ KHÔNG bao giờ gọi taoLeadTuHoSo; hồ sơ chờ duyệt", async () => {
      await goiDoc("leadIntakes", { than: thanIntake("dt08a") });
      expect(mk.taoLead).not.toHaveBeenCalled();
      expect((await hoSoCuaAgent())[0]!.state).toBe("READY_FOR_REVIEW");
    });

    it("BẬT + đủ điều kiện ⇒ gọi MỘT lần SAU khi đã quyết phản hồi; thành công ⇒ không báo thêm", async () => {
      mk.auto = true;
      await db.aiLeadAgentPage.updateMany({ where: { agentId: AGENT_TEST }, data: { autoCreate: true } }); // E2: cần CẢ cờ riêng của Page
      const r = await goiDoc("leadIntakes", { than: thanIntake("dt08b") });
      expect(r.status).toBe(200);
      expect(mk.taoLead).toHaveBeenCalledTimes(1);
      expect(mk.taoLead.mock.calls[0]![1]).toEqual({ tu: "AUTO" });
      expect(mk.baoHoSo).not.toHaveBeenCalled();
    });

    it("BẬT + taoLeadTuHoSo THẤT BẠI/NÉM ⇒ phản hồi Agent KHÔNG ĐỔI (N1), hồ sơ SYSTEM_EXCEPTION kèm MÃ, có báo nhân viên", async () => {
      const sach = await goiDoc("leadIntakes", { than: thanIntake("dt08c-0") });
      await donHoiThoai();
      mk.auto = true;
      await db.aiLeadAgentPage.updateMany({ where: { agentId: AGENT_TEST }, data: { autoCreate: true } }); // E2: cần CẢ cờ riêng của Page
      for (const cach of ["tra-loi", "nem"] as const) {
        mk.taoLead.mockReset();
        if (cach === "tra-loi") mk.taoLead.mockResolvedValue({ ok: false, lyDo: "LOI_INGEST", chiTiet: "chi tiet co SDT 0905123456" });
        else mk.taoLead.mockRejectedValue(new Error("ingest nổ: 0905123456"));
        mk.baoHoSo.mockClear();
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const r = await goiDoc("leadIntakes", { than: thanIntake(`dt08c-${cach}`) });
        spy.mockRestore();
        expect(r.status).toBe(200);
        expect((r.body as { data: Th }).data).toMatchObject({ status: "ACCEPTED", nextAction: "ACKNOWLEDGE_GENERIC" });
        expect(Object.keys((r.body as { data: Th }).data)).toEqual(Object.keys((sach.body as { data: Th }).data));
        const h = (await hoSoCuaAgent())[0]!;
        expect(h.state).toBe("SYSTEM_EXCEPTION");
        expect(h.resultNote).toBe("AUTO_LOI_INGEST");
        expect(mk.baoHoSo).toHaveBeenCalledTimes(1);
        await donHoiThoai();
      }
    });

    it("BẬT nhưng hồ sơ CHƯA đủ điều kiện ⇒ không gọi", async () => {
      mk.auto = true;
      await db.aiLeadAgentPage.updateMany({ where: { agentId: AGENT_TEST }, data: { autoCreate: true } });
      await goiDoc("leadIntakes", {
        than: thanIntake("dt08d", (b) => {
          b.candidate = { phoneRaw: "0905123456" };
          b.evidence = { phoneMessageMid: "m_phone_dt08d" };
        }),
      });
      expect(mk.taoLead).not.toHaveBeenCalled();
    });
  });

  describe("[AIL-DT-09] /handoffs", () => {
    it("20 handoff song song khác key cùng hội thoại ⇒ đúng 1 QUEUED (một tin chờ) + 19 ALREADY_QUEUED", async () => {
      const ds = await Promise.all(Array.from({ length: 20 }, (_, i) => goiDoc("handoffs", { than: thanHandoff(`dt09-${i}`) })));
      expect(ds.map((p) => p.status)).toEqual(Array(20).fill(200));
      const kq = ds.map((p) => (p.body as { data: Th }).data);
      expect(kq.filter((d) => d.handoffStatus === "QUEUED" && d.nextAction === "SEND_HOLDING_MESSAGE").length).toBe(1);
      expect(kq.filter((d) => d.handoffStatus === "ALREADY_QUEUED" && d.nextAction === "STAY_SILENT").length).toBe(19);
      const hoi = await db.aiLeadConversation.findFirstOrThrow({ where: { agentId: AGENT_TEST } });
      expect(hoi.ownerState).toBe("HANDOFF_REQUESTED");
      expect(hoi.holdingSentAt).not.toBeNull();
    });

    it("phát lại một QUEUED (cùng key) ⇒ lại SEND_HOLDING_MESSAGE (Agent tự chống gửi đôi bằng cờ holdingSent) + header replay", async () => {
      const than = thanHandoff("dt09b");
      const a = await goiDoc("handoffs", { than });
      const b = await goiDoc("handoffs", { than });
      expect(b.header["idempotent-replay"]).toBe("true");
      expect(b.body).toEqual(a.body);
      expect((b.body as { data: Th }).data.nextAction).toBe("SEND_HOLDING_MESSAGE");
    });

    it("Page TẠM DỪNG vẫn cho xin gặp người", async () => {
      await db.aiLeadAgentPage.updateMany({ where: { agentId: AGENT_TEST }, data: { state: "PAUSED" } });
      const r = await goiDoc("handoffs", { than: thanHandoff("dt09c") });
      expect(r.status).toBe(200);
    });

    it("đúng bảng theo ownerState (TAKEOVER_PENDING ⇒ ALREADY_QUEUED; PAUSED ⇒ ALREADY_HUMAN_OWNED/PAUSED)", async () => {
      await db.aiLeadConversation.create({ data: { agentId: AGENT_TEST, pageId: PAGE, psid: PSID, ownerState: "TAKEOVER_PENDING" } });
      expect(((await goiDoc("handoffs", { than: thanHandoff("dt09d-1") })).body as { data: Th }).data).toMatchObject({ handoffStatus: "ALREADY_QUEUED", ownerMode: "HANDOFF_REQUESTED", nextAction: "STAY_SILENT" });
      await db.aiLeadConversation.updateMany({ where: { agentId: AGENT_TEST }, data: { ownerState: "PAUSED" } });
      expect(((await goiDoc("handoffs", { than: thanHandoff("dt09d-2") })).body as { data: Th }).data).toMatchObject({ handoffStatus: "ALREADY_HUMAN_OWNED", ownerMode: "PAUSED", nextAction: "STAY_SILENT" });
    });

    it("hồ sơ đang COLLECTING của hội thoại chuyển sang cần người (PENDING_INFO) + SLA + báo", async () => {
      await goiDoc("leadIntakes", {
        than: thanIntake("dt09e", (b) => {
          b.candidate = { phoneRaw: "0905123456" };
          b.evidence = { phoneMessageMid: "m_phone_dt09e" };
        }),
      });
      expect((await hoSoCuaAgent())[0]!.state).toBe("COLLECTING");
      await goiDoc("handoffs", { than: thanHandoff("dt09e") });
      const h = (await hoSoCuaAgent())[0]!;
      expect(h.state).toBe("PENDING_INFO");
      expect(h.slaClaimDueAt).not.toBeNull();
      expect(mk.baoHoSo).toHaveBeenCalledWith(expect.objectContaining({ draftId: h.id }));
    });

    it("[HOF-SLA] hồ sơ chuyển người qua /handoffs cũng lấy hạn SLA từ BỘ QUY TẮC (như /lead-intakes) và ghi ruleSetVersion — trước đây handoff bỏ qua quy tắc theo Page/cơ sở (doc agent 28/10)", async () => {
      await db.aiLeadRuleSet.deleteMany({});
      await db.aiLeadRuleSet.create({
        data: { version: 1, reason: "kiểm thử SLA handoff", publishedById: "dt", hash: "h", payload: { rules: [{ kind: "SLA", scope: { type: "PAGE", pageId: PAGE }, claimMinutes: 7, resolveMinutes: 70 }] } },
      });
      try {
        await goiDoc("leadIntakes", {
          than: thanIntake("hof1", (b) => {
            b.candidate = { phoneRaw: "0905123499" };
            b.evidence = { phoneMessageMid: "m_phone_hof1" };
          }),
        });
        await goiDoc("handoffs", { than: thanHandoff("hof1") });
        const h = (await hoSoCuaAgent())[0]!;
        expect(h.state).toBe("PENDING_INFO");
        expect(h.slaClaimDueAt!.getTime() - h.createdAt.getTime()).toBeGreaterThan(6 * 60_000);
        expect(h.slaClaimDueAt!.getTime() - h.createdAt.getTime()).toBeLessThan(8 * 60_000);
        expect(h.slaResolveDueAt!.getTime() - h.createdAt.getTime()).toBeGreaterThan(69 * 60_000);
        expect(h.ruleSetVersion).toBe(1);
      } finally {
        await db.aiLeadRuleSet.deleteMany({});
      }
    });

    it("sau handoff, /lead-intakes cùng hội thoại LUÔN HUMAN_QUEUED (đồng nhất với quyết định mới 27/10)", async () => {
      await goiDoc("handoffs", { than: thanHandoff("dt09f") });
      const r = await goiDoc("leadIntakes", { than: thanIntake("dt09f") });
      expect((r.body as { data: Th }).data).toMatchObject({ status: "HUMAN_QUEUED" });
    });
  });

  describe("[AIL-DT-10] /incidents gộp theo NGÀY NHẬN giờ VN", () => {
    const khung = async <T>(iso: string, f: () => Promise<T>): Promise<T> => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(iso));
      try {
        return await f();
      } finally {
        vi.useRealTimers();
      }
    };
    const chiDoc = (seed: string, iso: string, sev: string, sua?: (b: Th) => void) =>
      thanIncident(seed, (b) => {
        b.occurredAt = iso;
        b.severity = sev;
        sua?.(b);
      });

    it("5 báo cáo song song (key khác) cùng (page, category, detailCode) ⇒ 1 dòng, count=5, severity LỚN NHẤT", async () => {
      await khung("2026-10-26T08:00:00.000Z", async () => {
        const mucs = ["LOW", "MEDIUM", "HIGH", "LOW", "MEDIUM"];
        const ds = await Promise.all(mucs.map((m, i) => goiDoc("incidents", { than: chiDoc(`dt10-${i}`, `2026-10-26T07:${10 + i}:00.000Z`, m) })));
        expect(ds.map((p) => p.status)).toEqual(Array(5).fill(200));
      });
      const ds = await db.aiLeadIncident.findMany({ where: { agentId: AGENT_TEST } });
      expect(ds.length).toBe(1);
      expect(ds[0]).toMatchObject({ count: 5, severity: "HIGH", state: "OPEN", pageId: PAGE });
      expect(mk.baoSuCo).toHaveBeenCalledTimes(1); // chỉ MỘT thông báo (sự cố MỚI mức HIGH; các lượt sau cùng id ⇒ không báo lại)
    });

    it("[INC-REOPEN] sự cố đã RESOLVED mà Agent báo lại CÙNG ngày ⇒ mở lại (OPEN, bỏ người phụ trách), báo lại với khoá riêng theo lần; báo cáo mức thấp tái diễn ⇒ mở lại nhưng không rung chuông; sự cố đang OPEN không bị báo lại", async () => {
      await khung("2026-10-26T08:00:00.000Z", async () => {
        await goiDoc("incidents", { than: chiDoc("inc-r1", "2026-10-26T07:10:00.000Z", "HIGH") });
      });
      expect(mk.baoSuCo).toHaveBeenCalledTimes(1);
      expect(mk.baoSuCo.mock.calls[0]![0]).not.toHaveProperty("lanMoLai");
      await db.aiLeadIncident.updateMany({ where: { agentId: AGENT_TEST }, data: { state: "RESOLVED", assigneeId: "u-cu" } });
      mk.baoSuCo.mockClear();
      await khung("2026-10-26T09:00:00.000Z", async () => {
        await goiDoc("incidents", { than: chiDoc("inc-r2", "2026-10-26T08:50:00.000Z", "HIGH") });
      });
      const sc = await db.aiLeadIncident.findFirstOrThrow({ where: { agentId: AGENT_TEST } });
      expect(sc).toMatchObject({ state: "OPEN", assigneeId: null, count: 2, soLanMoLai: 1 });
      expect(sc.moLaiLuc, "ghi mốc mở lại để cron leo thang tính từ đó").not.toBeNull();
      const vet = await db.auditLog.findMany({ where: { entityType: "AiLeadIncident", entityId: sc.id, action: "AI_LEAD_SU_CO_TU_MO_LAI" } });
      expect(vet.length).toBe(1);
      expect(vet[0]).toMatchObject({ actorId: null, module: "ai-lead" });
      expect(vet[0]!.oldValues).toMatchObject({ state: "RESOLVED", assigneeId: "u-cu" });
      expect(mk.baoSuCo).toHaveBeenCalledTimes(1);
      expect(mk.baoSuCo.mock.calls[0]![0]).toMatchObject({ incidentId: sc.id, lanMoLai: 2 });
      // đang OPEN, báo lại tiếp ⇒ KHÔNG báo lại (không phải tái diễn)
      mk.baoSuCo.mockClear();
      await khung("2026-10-26T09:30:00.000Z", async () => {
        await goiDoc("incidents", { than: chiDoc("inc-r3", "2026-10-26T09:20:00.000Z", "HIGH") });
      });
      expect(mk.baoSuCo).not.toHaveBeenCalled();
      // đóng lại rồi tái diễn với mức THẤP ⇒ mở lại nhưng không rung chuông
      await db.aiLeadIncident.updateMany({ where: { agentId: AGENT_TEST }, data: { state: "RESOLVED" } });
      await khung("2026-10-26T10:00:00.000Z", async () => {
        await goiDoc("incidents", { than: chiDoc("inc-r4", "2026-10-26T09:50:00.000Z", "LOW") });
      });
      expect((await db.aiLeadIncident.findFirstOrThrow({ where: { agentId: AGENT_TEST } })).state).toBe("OPEN");
      expect(mk.baoSuCo).not.toHaveBeenCalled();
      await db.auditLog.deleteMany({ where: { entityType: "AiLeadIncident", action: "AI_LEAD_SU_CO_TU_MO_LAI" } });
    });

    it("cùng key ⇒ phát lại, KHÔNG tăng count", async () => {
      await khung("2026-10-26T08:00:00.000Z", async () => {
        const than = chiDoc("dt10b", "2026-10-26T07:30:00.000Z", "MEDIUM");
        await goiDoc("incidents", { than });
        const b = await goiDoc("incidents", { than });
        expect(b.header["idempotent-replay"]).toBe("true");
      });
      expect((await db.aiLeadIncident.findFirstOrThrow({ where: { agentId: AGENT_TEST } })).count).toBe(1);
    });

    it("23:30 UTC (= 06:30 sáng hôm sau giờ VN) gộp vào NGÀY VN KẾ TIẾP; 16:59 UTC vẫn là ngày VN đó", async () => {
      await khung("2026-10-26T23:30:00.000Z", () => goiDoc("incidents", { than: chiDoc("dt10c-1", "2026-10-26T23:00:00.000Z", "MEDIUM") }));
      await khung("2026-10-26T16:59:00.000Z", () => goiDoc("incidents", { than: chiDoc("dt10c-2", "2026-10-26T16:00:00.000Z", "MEDIUM") }));
      await khung("2026-10-26T17:00:00.000Z", () => goiDoc("incidents", { than: chiDoc("dt10c-3", "2026-10-26T16:30:00.000Z", "MEDIUM") }));
      const ngay = (await db.aiLeadIncident.findMany({ where: { agentId: AGENT_TEST }, orderBy: { day: "asc" } })).map((i) => [i.day.toISOString().slice(0, 10), i.count]);
      expect(ngay).toEqual([
        ["2026-10-26", 1],
        ["2026-10-27", 2],
      ]);
    });

    it("không gắn Page ⇒ pageId '' (gộp được); và khác pageId/category/detailCode ⇒ dòng RIÊNG", async () => {
      await khung("2026-10-26T08:00:00.000Z", async () => {
        const khongPage = (seed: string, sev = "LOW") =>
          chiDoc(seed, "2026-10-26T07:40:00.000Z", sev, (b) => {
            delete b.pageId;
          });
        await goiDoc("incidents", { than: khongPage("dt10d-1") });
        await goiDoc("incidents", { than: khongPage("dt10d-2") });
        await goiDoc("incidents", { than: chiDoc("dt10d-3", "2026-10-26T07:41:00.000Z", "LOW") });
        await goiDoc("incidents", { than: chiDoc("dt10d-4", "2026-10-26T07:42:00.000Z", "LOW", (b) => void (b.detailCode = "WEBHOOK_TIMEOUT")) });
      });
      const ds = await db.aiLeadIncident.findMany({ where: { agentId: AGENT_TEST }, orderBy: [{ pageId: "asc" }, { detailCode: "asc" }] });
      expect(ds.map((d) => [d.pageId, d.detailCode, d.count])).toEqual([
        ["", "SIGNATURE_MISMATCH", 2],
        [PAGE, "SIGNATURE_MISMATCH", 1],
        [PAGE, "WEBHOOK_TIMEOUT", 1],
      ]);
    });

    it("severity chỉ TĂNG: báo CRITICAL rồi LOW ⇒ vẫn CRITICAL; leo thang MEDIUM→CRITICAL ⇒ báo (dedupe theo id sự cố)", async () => {
      await khung("2026-10-26T08:00:00.000Z", async () => {
        await goiDoc("incidents", { than: chiDoc("dt10e-1", "2026-10-26T07:40:00.000Z", "MEDIUM") });
        expect(mk.baoSuCo).not.toHaveBeenCalled();
        await goiDoc("incidents", { than: chiDoc("dt10e-2", "2026-10-26T07:41:00.000Z", "CRITICAL") });
        expect(mk.baoSuCo).toHaveBeenCalledTimes(1);
        expect(mk.baoSuCo.mock.calls[0]![0]).toMatchObject({ severity: "CRITICAL" });
        await goiDoc("incidents", { than: chiDoc("dt10e-3", "2026-10-26T07:42:00.000Z", "LOW") });
      });
      const d = await db.aiLeadIncident.findFirstOrThrow({ where: { agentId: AGENT_TEST } });
      expect(d).toMatchObject({ severity: "CRITICAL", count: 3 });
    });

    it("lastCorrelationId ghi lại; không có PII nào trong dòng sự cố", async () => {
      await khung("2026-10-26T08:00:00.000Z", () => goiDoc("incidents", { than: chiDoc("dt10f", "2026-10-26T07:40:00.000Z", "LOW") }));
      const d = await db.aiLeadIncident.findFirstOrThrow({ where: { agentId: AGENT_TEST } });
      expect(d.lastCorrelationId).toBe("3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a23");
    });
  });

  describe("[AIL-DT-11] /heartbeats: nhịp sống + thăm dò", () => {
    const hb = (sua?: (b: Th) => void): Th => {
      const b = JSON.parse(JSON.stringify(docFixture("40").request.body)) as Th;
      sua?.(b);
      return b;
    };
    const lenh = (agentId: string, probeId: string, nonce: string, tre = 600_000) =>
      db.aiLeadProbe.create({ data: { agentId, probeId, nonce, expiresAt: new Date(Date.now() + tre) } });

    it("ghi dấu nhịp sống của agent (không PII); pageId LẠ trong pages[] bị bỏ qua, phản hồi chỉ liệt kê Page được cấp", async () => {
      const r = await goiDoc("heartbeats", { than: hb((b) => void (b.pages = [{ pageId: "666666666666666", lastWebhookEventAt: null }, { pageId: PAGE, lastWebhookEventAt: null }])) });
      expect((r.body as { data: { pages: Th[] } }).data.pages).toEqual([{ pageId: PAGE, state: "ENABLED" }]);
      const a = await db.aiLeadAgent.findUniqueOrThrow({ where: { id: AGENT_TEST } });
      expect(a).toMatchObject({ lastAgentVersion: "0.3.0", lastBuildSha: "9f2c1ab", lastContractHash: "0".repeat(64) });
      expect(a.lastHeartbeatAt).not.toBeNull();
      expect(JSON.stringify(a.lastHeartbeatPayload)).not.toMatch(/nonce|psid|fbName|phone/i);
    });

    it("probe CHƯA ack ⇒ được trả lại mỗi heartbeat tới khi ack; probe HẾT HẠN và probe của agent KHÁC không trả", async () => {
      await lenh(AGENT_TEST, "prb_hethan0000000001", "n".repeat(20), -1_000);
      await lenh(AGENT_KHAC, "prb_khac00000000001", "m".repeat(20));
      expect(((await goiDoc("heartbeats", { than: hb() })).body as { data: Th }).data.probe).toBeNull();
      await lenh(AGENT_TEST, "prb_ok00000000000001", "k".repeat(20));
      const p1 = ((await goiDoc("heartbeats", { than: hb() })).body as { data: { probe: Th } }).data.probe;
      const p2 = ((await goiDoc("heartbeats", { than: hb() })).body as { data: { probe: Th } }).data.probe;
      expect(p1).toMatchObject({ probeId: "prb_ok00000000000001", nonce: "k".repeat(20) });
      expect(p2).toEqual(p1);
    });

    it("ack ĐÚNG ⇒ đóng lệnh + 1 bằng chứng L2/PROBE/PASS (hai ack SONG SONG vẫn chỉ 1 bằng chứng); lệnh đã ack không trả lại", async () => {
      await lenh(AGENT_TEST, "prb_ack0000000000001", "a".repeat(20));
      const ds = await Promise.all(Array.from({ length: 6 }, () => goiDoc("heartbeats", { than: hb((b) => void (b.probeAck = { probeId: "prb_ack0000000000001", nonce: "a".repeat(20) })) })));
      expect(ds.map((p) => p.status)).toEqual(Array(6).fill(200));
      expect(await db.aiLeadVerificationRun.count({ where: { agentId: AGENT_TEST, kind: "PROBE" } })).toBe(1);
      for (const p of ds) expect((p.body as { data: Th }).data.probe, "lệnh vừa ack không được trả lại").toBeNull();
    });

    it("ack SAI nonce / SAI agent / HẾT HẠN ⇒ bỏ qua im lặng (200, không bằng chứng, không lộ lệnh nào tồn tại)", async () => {
      await lenh(AGENT_TEST, "prb_sai00000000000001", "a".repeat(20));
      await lenh(AGENT_KHAC, "prb_cua000000000khac1", "c".repeat(20));
      await lenh(AGENT_TEST, "prb_het00000000000001", "h".repeat(20), -1_000);
      for (const ack of [
        { probeId: "prb_sai00000000000001", nonce: "z".repeat(20) },
        { probeId: "prb_cua000000000khac1", nonce: "c".repeat(20) },
        { probeId: "prb_het00000000000001", nonce: "h".repeat(20) },
        { probeId: "prb_khongco0000000001", nonce: "q".repeat(20) },
      ]) {
        const r = await goiDoc("heartbeats", { than: hb((b) => void (b.probeAck = ack)) });
        expect(r.status).toBe(200);
      }
      expect(await db.aiLeadVerificationRun.count({ where: { kind: "PROBE", agentId: { in: [AGENT_TEST, AGENT_KHAC] } } })).toBe(0);
      expect((await db.aiLeadProbe.findUniqueOrThrow({ where: { probeId: "prb_cua000000000khac1" } })).ackedAt).toBeNull();
    });

    it("contractStatus của agent được phản ánh; nhịp tiếp theo nằm trong biên hợp đồng", async () => {
      await db.aiLeadAgent.update({ where: { id: AGENT_TEST }, data: { contractStatus: "DEPRECATED" } });
      const d = ((await goiDoc("heartbeats", { than: hb() })).body as { data: Th }).data;
      expect(d.contractStatus).toBe("DEPRECATED");
      expect(d.nextHeartbeatSeconds as number).toBeGreaterThanOrEqual(15);
      expect(d.nextHeartbeatSeconds as number).toBeLessThanOrEqual(90);
      expect(d.latestCatalogVersion).toBe(7);
    });

    it("agent INCOMPATIBLE vẫn gửi heartbeat được (công tắc chỉ chặn /lead-intakes)", async () => {
      await db.aiLeadAgent.update({ where: { id: AGENT_TEST }, data: { contractStatus: "INCOMPATIBLE" } });
      expect((await goiDoc("heartbeats", { than: hb() })).status).toBe(200);
      expect((await goiDoc("leadIntakes", { than: thanIntake("dt11-inc") })).status).toBe(400);
    });
  });

  describe("[AIL-DT-12] /catalog: ETag · 304 · lọc Page", () => {
    it("If-None-Match khớp ⇒ 304 thân rỗng, đủ ETag + Cache-Control + X-Server-Time; đổi allowlist ⇒ 200 ETag mới", async () => {
      const a = await goiDoc("catalog", {});
      expect(a.status).toBe(200);
      const etag = a.header.etag!;
      expect(etag).toBe((a.body as { data: { etag: string } }).data.etag);
      expect(a.header["cache-control"]).toMatch(/^private, max-age=\d+$/);
      const b = await goiDoc("catalog", { header: { "if-none-match": etag } });
      expect(b.status).toBe(304);
      expect(b.thoRaw).toBe("");
      expect(b.header.etag).toBe(etag);
      expect(b.header["x-server-time"]).toMatch(/^[0-9]{13}$/);
      expect(b.header["cache-control"]).toBe(a.header["cache-control"]);
      const bo = await goiDoc("catalog", { header: { "if-none-match": `W/"${etag}"` } });
      expect(bo.status).toBe(304);
      await db.aiLeadAgentPage.create({ data: { agentId: AGENT_TEST, pageId: PAGE_THEM } });
      const c = await goiDoc("catalog", { header: { "if-none-match": etag } });
      expect(c.status).toBe(200);
      expect(c.header.etag).not.toBe(etag);
      expect((c.body as { data: { pages: { pageId: string }[] } }).data.pages.map((p) => p.pageId).sort()).toEqual([PAGE, PAGE_THEM].sort());
    });

    it("xuất bản bản MỚI ⇒ ETag đổi, catalogVersion tăng; chưa có bản nào ⇒ 503 TEMP_UNAVAILABLE + Retry-After", async () => {
      const a = await goiDoc("catalog", {});
      await db.aiLeadCatalogSnapshot.create({ data: { version: 9, publishedById: "ailtg", etag: "cat-9-zzz", payload: { pages: [{ pageId: PAGE, campuses: [] }] } } });
      const b = await goiDoc("catalog", { header: { "if-none-match": a.header.etag! } });
      expect(b.status).toBe(200);
      expect((b.body as { data: { catalogVersion: number } }).data.catalogVersion).toBe(9);
      await db.aiLeadCatalogSnapshot.deleteMany({ where: { publishedById: "ailtg" } });
      const c = await goiDoc("catalog", {});
      expect(c.status).toBe(503);
      expect(Number(c.header["retry-after"])).toBeGreaterThanOrEqual(1);
    });
  });

  describe("[CAT-TV] toàn vẹn snapshot khi PHỤC VỤ", () => {
    it("snapshot đúng khuôn xuất bản ⇒ 200; sửa tay payload mà giữ etag ⇒ 503 TEMP_UNAVAILABLE (không phát nội dung nghi ngờ); xuất bản lại đúng ⇒ 200", async () => {
      await db.aiLeadCatalogSnapshot.deleteMany({ where: { publishedById: "ailtg" } });
      const payload = { pages: [{ pageId: PAGE, campuses: [{ campusCode: "CS1", name: "Cơ sở 1", address: "1 Đường Thử", acceptingLeads: true }] }] };
      const etag = tinhEtag(11, payload);
      await db.aiLeadCatalogSnapshot.create({ data: { version: 11, publishedById: "ailtg", etag, payload } });
      try {
        expect((await goiDoc("catalog", {})).status).toBe(200);
        await db.aiLeadCatalogSnapshot.update({ where: { version: 11 }, data: { payload: { pages: [{ pageId: PAGE, campuses: [{ campusCode: "CS1", name: "Cơ sở 1", address: "Địa chỉ bị sửa tay", acceptingLeads: true }] }] } } });
        const hong = await goiDoc("catalog", {});
        expect([hong.status, (hong.body as { error?: { code?: string } }).error?.code]).toEqual([503, "TEMP_UNAVAILABLE"]);
        await db.aiLeadCatalogSnapshot.create({ data: { version: 12, publishedById: "ailtg", etag: tinhEtag(12, payload), payload } });
        expect((await goiDoc("catalog", {})).status).toBe(200);
      } finally {
        await db.aiLeadCatalogSnapshot.deleteMany({ where: { publishedById: "ailtg" } });
      }
    });
  });

  describe("[AIL-DT-13] cron dọn", () => {
    const NOW = new Date("2026-10-27T12:00:00.000Z");
    const gio = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    const lamCu = (id: string, at: Date) => db.$executeRaw`UPDATE "AiLeadDraft" SET "updatedAt" = ${at} WHERE "id" = ${id}`;
    const taoHoSo = async (psid: string, data: Partial<{ state: string; claimedById: string; leadId: string; slaClaimDueAt: Date; slaResolveDueAt: Date }> = {}) => {
      const hoi = await db.aiLeadConversation.create({ data: { agentId: AGENT_TEST, pageId: PAGE, psid } });
      return db.aiLeadDraft.create({
        data: { conversationId: hoi.id, intent: "CONSULTATION_REQUEST", centerId: coSo.CS1, ...(data as object) } as never,
      });
    };

    it("xoá nonce quá hạn HIỆU LỰC (max(ai.nonceTtlMinutes, 2×ai.clockSkewMs)), giữ nonce còn hạn; xoá idempotency quá 7 ngày", async () => {
      await db.aiLeadNonce.createMany({
        data: [
          { agentId: AGENT_TEST, nonce: "nonce-cu-0000000000001", createdAt: new Date(NOW.getTime() - 16 * 60_000) },
          { agentId: AGENT_TEST, nonce: "nonce-moi-000000000001", createdAt: new Date(NOW.getTime() - 14 * 60_000) },
        ],
      });
      await db.aiLeadRequest.createMany({
        data: [
          { agentId: AGENT_TEST, idempotencyKey: "HANDOFF:" + "a".repeat(40) + ":v1", endpoint: "handoffs", requestHash: "h", responseStatus: 200, responseBody: {}, createdAt: new Date(NOW.getTime() - 8 * 86_400_000) },
          { agentId: AGENT_TEST, idempotencyKey: "HANDOFF:" + "b".repeat(40) + ":v1", endpoint: "handoffs", requestHash: "h", responseStatus: 200, responseBody: {}, createdAt: new Date(NOW.getTime() - 6 * 86_400_000) },
        ],
      });
      const kq = await chayDonDep({ dongHo: () => NOW });
      expect(kq).toMatchObject({ ok: true, nonceXoa: 1, requestXoa: 1, loi: [] });
      expect((await db.aiLeadNonce.findMany({ where: { agentId: AGENT_TEST } })).map((n) => n.nonce)).toEqual(["nonce-moi-000000000001"]);
      expect(await db.aiLeadRequest.count({ where: { agentId: AGENT_TEST } })).toBe(1);
    });

    it("[RET-CFG] thời gian giữ idempotency theo ai.requestRetentionDays (không còn hằng 7 ngày): đặt 2 ngày ⇒ bản ghi 3 ngày tuổi bị xoá, 1 ngày tuổi giữ", async () => {
      await db.systemSetting.upsert({ where: { key: "ai.requestRetentionDays" }, update: { valueJson: 2 }, create: { key: "ai.requestRetentionDays", valueJson: 2, updatedByName: "dt" } });
      const { clearSettingsCache } = await import("@/lib/settings/service");
      clearSettingsCache();
      try {
        await db.aiLeadRequest.createMany({
          data: [3, 1].map((ngay, i) => ({ agentId: AGENT_TEST, idempotencyKey: `HANDOFF:${String(i).repeat(40)}:v1`, endpoint: "handoffs", requestHash: "h", responseStatus: 200, responseBody: {}, createdAt: new Date(NOW.getTime() - ngay * 86_400_000) })),
        });
        const kq = await chayDonDep({ dongHo: () => NOW });
        expect(kq.requestXoa).toBe(1);
        const con = await db.aiLeadRequest.findMany({ where: { agentId: AGENT_TEST } });
        expect(con.map((r) => r.idempotencyKey)).toEqual([`HANDOFF:${"1".repeat(40)}:v1`]);
      } finally {
        await db.systemSetting.deleteMany({ where: { key: "ai.requestRetentionDays" } });
        clearSettingsCache();
      }
    });

    it("EXPIRED: CHỈ hồ sơ COLLECTING bỏ dở quá ai.draftExpireHours (72h, theo updatedAt, chưa ai nhận, chưa ra lead) ⇒ EXPIRED + AUDIT hệ thống; hồ sơ đã giao người (PENDING_INFO…) và mọi hồ sơ khác GIỮ NGUYÊN", async () => {
      const cu = await taoHoSo("p1", { state: "COLLECTING" });
      const cuPending = await taoHoSo("p2", { state: "PENDING_INFO" });
      const daNhan = await taoHoSo("p3", { state: "PENDING_INFO", claimedById: "u1" });
      const daLead = await taoHoSo("p4", { state: "READY_FOR_REVIEW", leadId: "lead1" });
      const moi = await taoHoSo("p5", { state: "COLLECTING" });
      const bien = await taoHoSo("p6", { state: "COLLECTING" });
      const dangXuLy = await taoHoSo("p7", { state: "IN_PROGRESS" });
      const hetNhungDong = await taoHoSo("p8", { state: "REJECTED" });
      for (const d of [cu, cuPending, daNhan, daLead, dangXuLy, hetNhungDong]) await lamCu(d.id, gio(100));
      await lamCu(moi.id, gio(71));
      await lamCu(bien.id, gio(72.01));
      const kq = await chayDonDep({ dongHo: () => NOW });
      expect(kq.hetHan).toBe(2);
      const st = Object.fromEntries((await db.aiLeadDraft.findMany({ where: { conversation: { agentId: AGENT_TEST } } })).map((d) => [d.id, d.state]));
      expect(st[cu.id]).toBe("EXPIRED");
      expect(st[cuPending.id], "đã giao người ⇒ không tự đóng, chỉ nhắc SLA").toBe("PENDING_INFO");
      expect(st[bien.id]).toBe("EXPIRED");
      expect(st[daNhan.id]).toBe("PENDING_INFO");
      expect(st[daLead.id]).toBe("READY_FOR_REVIEW");
      expect(st[moi.id]).toBe("COLLECTING");
      expect(st[dangXuLy.id]).toBe("IN_PROGRESS");
      expect(st[hetNhungDong.id]).toBe("REJECTED");
      const audit = await db.auditLog.findMany({ where: { entityType: "AiLeadDraft", entityId: { in: [cu.id, cuPending.id, bien.id] }, action: "EXPIRE" } });
      expect(audit.length).toBe(2);
      expect(audit[0]).toMatchObject({ actorId: null, module: "ai-lead" });
      await db.auditLog.deleteMany({ where: { entityType: "AiLeadDraft", entityId: { in: [cu.id, cuPending.id, bien.id] } } });
    });

    it("nhắc SLA: chỉ hồ sơ CẦN NGƯỜI, chưa ai nhận, chưa ra lead, đã quá slaClaimDueAt", async () => {
      const qua = await taoHoSo("s1", { state: "PENDING_INFO", slaClaimDueAt: new Date(NOW.getTime() - 60_000) });
      await taoHoSo("s2", { state: "PENDING_INFO", slaClaimDueAt: new Date(NOW.getTime() + 60_000) });
      await taoHoSo("s3", { state: "PENDING_INFO", slaClaimDueAt: new Date(NOW.getTime() - 60_000), claimedById: "u1" });
      await taoHoSo("s4", { state: "COLLECTING", slaClaimDueAt: new Date(NOW.getTime() - 60_000) });
      await taoHoSo("s5", { state: "READY_FOR_REVIEW", slaClaimDueAt: new Date(NOW.getTime() - 60_000), leadId: "l1" });
      const kq = await chayDonDep({ dongHo: () => NOW });
      expect(kq.slaNhac).toBe(1);
      expect(mk.baoSla).toHaveBeenCalledTimes(1);
      expect(mk.baoSla).toHaveBeenCalledWith({ draftId: qua.id, centerId: coSo.CS1, event: "SLA_CLAIM_OVERDUE", bac: { afterMinutes: 0, to: ["CENTER_MANAGER"] }, now: NOW });
    });

    it("[SLA-RS] quá hạn XỬ LÝ: hồ sơ ĐÃ nhận (IN_PROGRESS) mà quá slaResolveDueAt chưa ra lead ⇒ báo SLA_RESOLVE_OVERDUE; đã ra lead / chưa tới hạn / chưa ai nhận thì không", async () => {
      const cu = await taoHoSo("r1", { state: "IN_PROGRESS", claimedById: "u1", slaResolveDueAt: new Date(NOW.getTime() - 60_000) });
      await taoHoSo("r2", { state: "IN_PROGRESS", claimedById: "u1", slaResolveDueAt: new Date(NOW.getTime() + 60_000) });
      await taoHoSo("r3", { state: "IN_PROGRESS", claimedById: "u1", slaResolveDueAt: new Date(NOW.getTime() - 60_000), leadId: "l1" });
      await taoHoSo("r4", { state: "COMPLETED", claimedById: "u1", slaResolveDueAt: new Date(NOW.getTime() - 60_000) });
      const kq = await chayDonDep({ dongHo: () => NOW });
      expect(kq.slaNhac).toBe(1);
      expect(mk.baoSla).toHaveBeenCalledTimes(1);
      expect(mk.baoSla).toHaveBeenCalledWith({ draftId: cu.id, centerId: coSo.CS1, event: "SLA_RESOLVE_OVERDUE", bac: { afterMinutes: 0, to: ["CENTER_MANAGER"] }, now: NOW });
    });

    it("[SLA-LT] LEO THANG: bậc +60′ chỉ đến hạn SAU 60 phút kể từ hạn nhận; chưa tới ⇒ chỉ bậc 0; chạy lặp không thêm bậc nào mới (khoá bậc làm phần còn lại)", async () => {
      await db.aiLeadRuleSet.deleteMany({});
      await db.aiLeadRuleSet.create({
        data: {
          version: 1, reason: "kiểm thử leo thang", publishedById: "dt", hash: "h",
          payload: { rules: [
            { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: null, afterMinutes: 0, to: ["CENTER_MANAGER"] },
            { kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId: null, afterMinutes: 60, to: ["HO_REVIEWERS"] },
          ] },
        },
      });
      try {
        const cu = await taoHoSo("l1", { state: "PENDING_INFO", slaClaimDueAt: new Date(NOW.getTime() - 30 * 60_000) });
        await chayDonDep({ dongHo: () => NOW });
        expect(mk.baoSla.mock.calls.map((c) => (c[0] as { bac: { afterMinutes: number } }).bac.afterMinutes)).toEqual([0]);
        mk.baoSla.mockClear();
        await db.aiLeadDraft.update({ where: { id: cu.id }, data: { slaClaimDueAt: new Date(NOW.getTime() - 61 * 60_000) } });
        await chayDonDep({ dongHo: () => NOW });
        expect(mk.baoSla.mock.calls.map((c) => (c[0] as { bac: { afterMinutes: number; to: string[] } }).bac)).toEqual([
          { afterMinutes: 0, to: ["CENTER_MANAGER"] },
          { afterMinutes: 60, to: ["HO_REVIEWERS"] },
        ]);
      } finally {
        await db.aiLeadRuleSet.deleteMany({});
      }
    });

    it("[DRAFT-LT] LEO THANG «hồ sơ cần người»: bậc +45′ tính từ lúc hồ sơ VÀO trạng thái cần người (hạn nhận − hạn nhận theo quy tắc), chỉ khi chưa ai nhận / chưa ra lead; chưa tới ⇒ không báo; bao cả PENDING_INFO; hồ sơ tạo từ lâu nhưng vừa cần người thì KHÔNG leo thang ngay (review độc lập 28/10)", async () => {
      await db.aiLeadRuleSet.deleteMany({});
      await db.aiLeadRuleSet.create({
        data: {
          version: 1, reason: "kiểm thử leo thang hồ sơ", publishedById: "dt", hash: "h",
          payload: { rules: [{ kind: "NOTIFY", event: "DRAFT_NEEDS_STAFF", centerId: null, afterMinutes: 45, to: ["HO_REVIEWERS"] }] },
        },
      });
      // hạn nhận mặc định 30′ ⇒ mốc «vào trạng thái cần người» = hạn − 30′. Mốc cách NOW `phut` phút ⇒ hạn = NOW − phut + 30.
      const han = (phut: number) => new Date(NOW.getTime() + (30 - phut) * 60_000);
      try {
        const qua = await taoHoSo("dl1", { state: "READY_FOR_REVIEW", slaClaimDueAt: han(50) });
        const pending = await taoHoSo("dl7", { state: "PENDING_INFO", slaClaimDueAt: han(46) });
        await taoHoSo("dl2", { state: "WAITING_QLCS", slaClaimDueAt: han(30) });
        await taoHoSo("dl3", { state: "READY_FOR_REVIEW", claimedById: "u1", slaClaimDueAt: han(50) });
        await taoHoSo("dl4", { state: "READY_FOR_REVIEW", leadId: "l1", slaClaimDueAt: han(50) });
        await taoHoSo("dl5", { state: "COLLECTING", slaClaimDueAt: han(50) });
        const cu = await taoHoSo("dl8", { state: "READY_FOR_REVIEW", slaClaimDueAt: han(5) }); // vừa cần người 5′ trước…
        await db.aiLeadDraft.update({ where: { id: cu.id }, data: { createdAt: new Date(NOW.getTime() - 5 * 3_600_000) } }); // …dù tạo từ 5 giờ trước (COLLECTING lâu)
        const kq = await chayDonDep({ dongHo: () => NOW });
        const ids = mk.baoHoSo.mock.calls.map((c) => (c[0] as { draftId: string }).draftId).sort();
        expect(ids).toEqual([qua.id, pending.id].sort());
        expect(mk.baoHoSo.mock.calls[0]![0]).toMatchObject({ centerId: coSo.CS1, bac: { afterMinutes: 45, to: ["HO_REVIEWERS"] } });
        expect(kq.slaNhac).toBeGreaterThanOrEqual(2);
      } finally {
        await db.aiLeadRuleSet.deleteMany({});
      }
    });

    it("[DRAFT-LT-0] không có dòng NOTIFY nào cho DRAFT_NEEDS_STAFF với afterMinutes > 0 ⇒ cron KHÔNG gọi báo hồ sơ (bậc 0 là việc của lúc hồ sơ vừa cần người)", async () => {
      const cu = await taoHoSo("dl6", { state: "READY_FOR_REVIEW" });
      await db.aiLeadDraft.update({ where: { id: cu.id }, data: { createdAt: new Date(NOW.getTime() - 600 * 60_000) } });
      await chayDonDep({ dongHo: () => NOW });
      expect(mk.baoHoSo).not.toHaveBeenCalled();
    });

    it("[SLA-WIN] hồ sơ quá hạn nhận LÂU hơn cửa sổ quét (bậc lớn nhất + 24 giờ) rời khỏi truy vấn: 200 hồ sơ cũ KHÔNG chiếm hết chỗ của hồ sơ mới quá hạn (review độc lập 28/10)", async () => {
      const cu = new Date(NOW.getTime() - 3 * 86_400_000); // quá hạn 3 ngày > 24 giờ
      await db.aiLeadConversation.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ agentId: AGENT_TEST, pageId: PAGE, psid: `win-cu-${i}` })) });
      const hoi = await db.aiLeadConversation.findMany({ where: { agentId: AGENT_TEST, psid: { startsWith: "win-cu-" } }, select: { id: true } });
      await db.aiLeadDraft.createMany({ data: hoi.map((h) => ({ conversationId: h.id, intent: "CONSULTATION_REQUEST" as const, state: "PENDING_INFO" as const, centerId: coSo.CS1, slaClaimDueAt: cu })) });
      const moi = await taoHoSo("win-moi", { state: "PENDING_INFO", slaClaimDueAt: new Date(NOW.getTime() - 60_000) });
      await chayDonDep({ dongHo: () => NOW });
      const ids = mk.baoSla.mock.calls.map((c) => (c[0] as { draftId: string }).draftId);
      expect(ids).toEqual([moi.id]); // chỉ hồ sơ MỚI; 200 hồ sơ cũ đã ra khỏi cửa sổ
    });

    const taoNhieuHoSoQuaHan = async (n: number, tien: string) => {
      const tg = new Date(NOW.getTime() - 60_000);
      await db.aiLeadConversation.createMany({ data: Array.from({ length: n }, (_, i) => ({ agentId: AGENT_TEST, pageId: PAGE, psid: `${tien}-${i}` })) });
      const hoi = await db.aiLeadConversation.findMany({ where: { agentId: AGENT_TEST, psid: { startsWith: `${tien}-` } }, select: { id: true } });
      await db.aiLeadDraft.createMany({ data: hoi.map((h) => ({ conversationId: h.id, intent: "CONSULTATION_REQUEST" as const, state: "PENDING_INFO" as const, centerId: coSo.CS1, slaClaimDueAt: tg })) });
    };

    it("[SLA-PAGE] hàng đợi ứ > 200 hồ sơ cùng quá hạn TRONG cửa sổ: quét NHIỀU TRANG bằng con trỏ nên hồ sơ nào cũng được xét (trước: take 200 ⇒ phần sau bị bỏ sót); không chạm trần ⇒ catNgan 0", async () => {
      await taoNhieuHoSoQuaHan(450, "pg");
      const kq = await chayDonDep({ dongHo: () => NOW });
      const ids = mk.baoSla.mock.calls.map((c) => (c[0] as { draftId: string }).draftId);
      expect(ids).toHaveLength(450);
      expect(new Set(ids).size).toBe(450); // không hồ sơ nào bị xét hai lần giữa các trang
      expect(kq.catNgan).toBe(0);
    }, 120_000);

    it("[SLA-PAGE-CAP] chạm trần 10 trang × 200 = 2000 ⇒ KHÔNG cắt im lặng: catNgan = 1 (phần còn lại để lượt sau); đúng 2000 hồ sơ được xét", async () => {
      await taoNhieuHoSoQuaHan(2050, "pc");
      const kq = await chayDonDep({ dongHo: () => NOW });
      expect(mk.baoSla.mock.calls).toHaveLength(2000);
      expect(kq.catNgan).toBe(1);
    }, 240_000);

    it("[SLA-PAGE-EXACT] ĐÚNG 2000 hồ sơ (trang thứ 10 vừa đầy, không còn gì sau) ⇒ catNgan = 0 — không báo cắt oan mỗi lượt cron", async () => {
      await taoNhieuHoSoQuaHan(2000, "px");
      const kq = await chayDonDep({ dongHo: () => NOW });
      expect(mk.baoSla.mock.calls).toHaveLength(2000);
      expect(kq.catNgan).toBe(0);
    }, 240_000);

    it("[SU-CO-MOLAI] leo thang sự cố MỞ LẠI tính từ lần mở lại (không từ firstSeenAt): mở lại 10′ trước ⇒ chưa leo thang; mở lại 70′ trước ⇒ leo thang bậc +60′ với khoá theo lần mở lại; chưa từng mở lại ⇒ mốc firstSeenAt như cũ", async () => {
      await db.aiLeadRuleSet.deleteMany({});
      await db.aiLeadRuleSet.create({
        data: {
          version: 1, reason: "kiểm thử leo thang sự cố mở lại", publishedById: "dt", hash: "h",
          payload: { rules: [{ kind: "NOTIFY", event: "INCIDENT", centerId: null, afterMinutes: 60, to: ["HO_CONFIGURERS"] }] },
        },
      });
      const phutTruoc = (p: number) => new Date(NOW.getTime() - p * 60_000);
      const tao = (detailCode: string, o: { moLai?: number; soLan?: number }) =>
        db.aiLeadIncident.create({
          data: { agentId: AGENT_TEST, category: "WEBHOOK_FAILURE", detailCode, day: new Date("2026-10-27"), severity: "HIGH", state: "OPEN", firstSeenAt: phutTruoc(300), lastSeenAt: phutTruoc(5), ...(o.moLai !== undefined ? { moLaiLuc: phutTruoc(o.moLai), soLanMoLai: o.soLan ?? 1 } : {}) },
        });
      try {
        const moiMoLai = await tao("M1", { moLai: 10 });
        const cuMoLai = await tao("M2", { moLai: 70, soLan: 2 });
        const chuaMoLai = await tao("M3", {});
        await chayDonDep({ dongHo: () => NOW });
        const goi = mk.baoSuCo.mock.calls.map((c) => c[0] as { incidentId: string; lanMoLai?: number });
        expect(goi.find((g) => g.incidentId === moiMoLai.id), "mở lại 10′ trước ⇒ chưa tới bậc +60′").toBeUndefined();
        expect(goi.find((g) => g.incidentId === cuMoLai.id)).toMatchObject({ lanMoLai: 2 });
        const g3 = goi.find((g) => g.incidentId === chuaMoLai.id)!;
        expect(g3, "chưa từng mở lại ⇒ mốc firstSeenAt (300′ trước) ⇒ đã tới bậc +60′").toBeDefined();
        expect(g3).not.toHaveProperty("lanMoLai");
      } finally {
        await db.aiLeadRuleSet.deleteMany({});
        await db.aiLeadIncident.deleteMany({ where: { agentId: AGENT_TEST } });
      }
    });

    it("[SU-CO-LT] sự cố HIGH/CRITICAL còn OPEN quá bậc leo thang ⇒ báo bậc đó (không báo lại bậc 0); đã ACK / mức thấp ⇒ không", async () => {
      await db.aiLeadRuleSet.deleteMany({});
      await db.aiLeadRuleSet.create({
        data: {
          version: 1, reason: "kiểm thử leo thang sự cố", publishedById: "dt", hash: "h",
          payload: { rules: [
            { kind: "NOTIFY", event: "INCIDENT", centerId: null, afterMinutes: 0, to: ["INTEGRATION_VIEWERS"] },
            { kind: "NOTIFY", event: "INCIDENT", centerId: null, afterMinutes: 60, to: ["HO_CONFIGURERS"] },
          ] },
        },
      });
      const moc = new Date(NOW.getTime() - 120 * 60_000);
      const tao = (detailCode: string, o: { state?: "OPEN" | "ACKED"; severity?: "HIGH" | "LOW" | "CRITICAL" } = {}) =>
        db.aiLeadIncident.create({ data: { agentId: AGENT_TEST, category: "WEBHOOK_FAILURE", detailCode, day: new Date("2026-10-27"), severity: o.severity ?? "HIGH", state: o.state ?? "OPEN", firstSeenAt: moc, lastSeenAt: moc } });
      try {
        const mo = await tao("A1");
        await tao("A2", { state: "ACKED" });
        await tao("A3", { severity: "LOW" });
        const kq = await chayDonDep({ dongHo: () => NOW });
        expect(kq.suCoNhac).toBe(1);
        expect(mk.baoSuCo).toHaveBeenCalledTimes(1);
        expect(mk.baoSuCo.mock.calls[0]![0]).toMatchObject({ incidentId: mo.id, severity: "HIGH", bac: { afterMinutes: 60, to: ["HO_CONFIGURERS"] } });
      } finally {
        await db.aiLeadRuleSet.deleteMany({});
        await db.aiLeadIncident.deleteMany({ where: { agentId: AGENT_TEST } });
      }
    });

    it("idempotent: chạy lại ngay ⇒ không xoá/đóng thêm gì", async () => {
      const cu = await taoHoSo("i1", { state: "COLLECTING" });
      await lamCu(cu.id, gio(100));
      const a = await chayDonDep({ dongHo: () => NOW });
      const b = await chayDonDep({ dongHo: () => NOW });
      expect(a.hetHan).toBe(1);
      expect(b).toMatchObject({ hetHan: 0, nonceXoa: 0, requestXoa: 0 });
      await db.auditLog.deleteMany({ where: { entityType: "AiLeadDraft", entityId: cu.id } });
    });
  });
});

const PAGE_THEM = "104500000000009";
