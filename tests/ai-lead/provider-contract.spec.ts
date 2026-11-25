// @vitest-environment node
/**
 * AI LEAD GATEWAY — PROVIDER CONTRACT TEST (L1 phía Admin), Postgres THẬT.
 *
 * Phát lại MỌI fixture của gói bàn giao (tests/fixtures/ai-lead/request-response-fixtures) qua CHÍNH các route handler thật
 * (xác thực HMAC → zod → idempotency → dịch vụ → DB) và so phản hồi với `response` của fixture:
 *   · so CẤU TRÚC — trừ `receiptId` · `requestId` · `serverTime` · `etag` · mốc thời gian (nhưng KHÔNG trừ `status` · `nextAction` · `askFields` · `refreshCatalog` · mã lỗi);
 *   · mọi phản hồi 200 còn phải hợp lệ theo SCHEMA hợp đồng (`validates.response`);
 *   · vector HMAC V1–V3 được xác thực ở `lib/ai-lead/xac-thuc.test.ts` [AIL-XT-16].
 *
 * Mã ca: [AIL-PV-*]. [AIL-PV-00] ép MỌI fixture phải có người phụ trách — thêm fixture mới mà quên viết ca là đỏ (không xanh câm).
 *
 * ⚠️ Bộ này TỰ SKIP khi không có Postgres test (db-gate). Thấy SKIP nghĩa là CHƯA KIỂM ĐƯỢC GÌ.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTenDbTest, RUN_DB_TESTS } from "../_helpers/db-gate";

const mk = vi.hoisted(() => ({ rateHong: false, auto: false }));
vi.mock("@/lib/rate-limit", async () => {
  const that = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return {
    ...that,
    rateLimit: async (a: { key: string; max: number; windowMs: number }) =>
      mk.rateHong && a.key.startsWith("ai-lead:intake:") ? { success: false, remaining: 0, resetAt: Date.now() + 12_000 } : that.rateLimit({ ...a, key: `${a.key}:${Math.random()}` }),
  };
});
vi.mock("@/lib/ai-lead/cai-dat", async (goc) => {
  const that = await goc<typeof import("@/lib/ai-lead/cai-dat")>();
  return { ...that, congProd: async () => ({ allowed: true, reason: "OK", thieu: [] }), docCaiDat: async () => ({ ...(await that.docCaiDat()), autoCreateEnabled: mk.auto }) };
});

import { db } from "@/lib/db";
import { SCHEMA_THEO_TEN } from "@/lib/ai-lead/schemas";
import { docFixture, tatCaFixture, type Fixture } from "@/lib/ai-lead/ho-tro-test";
import { docPhanHoi } from "@/lib/ai-lead/ho-tro-yeu-cau-test";
import { doiViecNen } from "@/lib/ai-lead/dich-vu/nen";
import { AGENT_KHAC, AGENT_PROD, AGENT_TEST, batMoiTruong, CHAY_QUA_HTTP, don, donHoiThoai, dung, goi, PAGE } from "./_nen";
import type { TenEndpoint } from "@/lib/ai-lead/hop-dong";

// Tranh chấp 20 yêu cầu trên pool 5 kết nối (lib/db.ts) chậm hơn mặc định 5 s của vitest.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 }); // 120 s: dư địa cho biên dịch nguội của `next dev` dưới tải (runner còn làm nóng trước)

const RUN = RUN_DB_TESTS;
if (!RUN) console.warn("[ai-lead-pv] SKIP: DATABASE_URL không trỏ Postgres test cục bộ / thiếu ALLOW_DB_RESET.");

const TEN_ENDPOINT: Record<string, TenEndpoint> = {
  "/api/ai-lead-agent/v1/catalog": "catalog",
  "/api/ai-lead-agent/v1/lead-intakes": "leadIntakes",
  "/api/ai-lead-agent/v1/handoffs": "handoffs",
  "/api/ai-lead-agent/v1/incidents": "incidents",
  "/api/ai-lead-agent/v1/heartbeats": "heartbeats",
};
const endpointCua = (f: Fixture): TenEndpoint => TEN_ENDPOINT[f.request.path]!;
const PSID = "7000000000000001";

// ─── So phản hồi với fixture ─────────────────────────────────────────────────────────────────────────────────────────────
type Cay = Record<string, unknown>;
function chuanHoa(body: unknown): unknown {
  const b = JSON.parse(JSON.stringify(body)) as Cay;
  const data = b.data as Cay | undefined;
  const meta = b.meta as Cay | undefined;
  const err = b.error as Cay | undefined;
  if (data) {
    if ("receiptId" in data) data.receiptId = "<rct>";
    if ("serverTime" in data) data.serverTime = 0;
    if ("etag" in data) data.etag = "<etag>";
    if ("publishedAt" in data) data.publishedAt = new Date(String(data.publishedAt)).toISOString();
    const probe = data.probe as Cay | null | undefined;
    if (probe && typeof probe === "object") probe.expiresAt = "<hạn>";
  }
  if (meta) {
    meta.requestId = "<req>";
    meta.serverTime = 0;
  }
  if (err) {
    err.requestId = "<req>";
    err.message = "<câu>";
  }
  return b;
}

type PhanHoi = Awaited<ReturnType<typeof docPhanHoi>>;
function soVoiFixture(thuc: PhanHoi, f: Fixture): void {
  expect(thuc.status, `${f.tep}: status (thân: ${JSON.stringify(thuc.body).slice(0, 200)})`).toBe(f.response.status);
  const mong = chuanHoa(f.response.body) as Cay;
  const co = chuanHoa(thuc.body) as Cay;
  if (mong.ok === false) {
    // Lỗi: bắt buộc đúng MÃ; `field` chỉ so khi fixture có khai (fixture 80–89 không khai field).
    const me = mong.error as Cay;
    const ce = co.error as Cay;
    expect(ce.code, `${f.tep}: mã lỗi`).toBe(me.code);
    if (me.field !== undefined) expect(ce.field, `${f.tep}: error.field`).toBe(me.field);
  } else {
    expect(co, `${f.tep}: thân`).toEqual(mong);
  }
  for (const [k, v] of Object.entries(f.response.headers)) {
    const thucV = thuc.header[k.toLowerCase()];
    if (k.toLowerCase() === "retry-after") expect(Number(thucV), `${f.tep}: Retry-After`).toBeGreaterThanOrEqual(1);
    else if (k.toLowerCase() === "etag") expect(thucV, `${f.tep}: ETag`).toBe((thuc.body as { data: { etag: string } }).data.etag);
    else if (k.toLowerCase() === "x-server-time") expect(thucV).toMatch(/^[0-9]+$/);
    else expect(thucV, `${f.tep}: header ${k}`).toBe(v);
  }
  // Khung chung: MỌI phản hồi có X-Server-Time; lỗi/200 không phải catalog thì `no-store`.
  expect(thuc.header["x-server-time"], `${f.tep}: X-Server-Time`).toMatch(/^[0-9]{13}$/);
  expect(thuc.header["cache-control"]).toBeTruthy();
  // Phản hồi 200 phải hợp lệ theo schema hợp đồng.
  const ten = f.validates.response;
  if (ten && f.response.status === 200 && f.validates.responseExpect === "VALID") {
    const kq = SCHEMA_THEO_TEN[ten as keyof typeof SCHEMA_THEO_TEN].safeParse(thuc.body);
    expect(kq.success, `${f.tep}: phản hồi thật vi phạm schema ${ten}: ${kq.success ? "" : JSON.stringify(kq.error.issues[0])}`).toBe(true);
  }
}

async function phat(f: Fixture, x?: Parameters<typeof goi>[1]): Promise<PhanHoi> {
  const res = await goi(endpointCua(f), { than: f.request.body ?? undefined, agentId: AGENT_TEST, ...x });
  await doiViecNen();
  // Qua HTTP thật, việc nền (`after()`) chạy ở TIẾN TRÌNH SERVER — không có hàng đợi nào để chờ từ đây ⇒ chờ ngắn trước khi đọc DB.
  if (CHAY_QUA_HTTP) await new Promise((r) => setTimeout(r, 250));
  return docPhanHoi(res);
}

async function datHoiThoai(ownerState: "AI_ACTIVE" | "HANDOFF_REQUESTED" | "HUMAN_ACTIVE" | "PAUSED", holding = false): Promise<void> {
  await db.aiLeadConversation.create({ data: { agentId: AGENT_TEST, pageId: PAGE, psid: PSID, ownerState, ...(holding ? { holdingSentAt: new Date() } : {}) } });
}

describe.skipIf(!RUN)("AI Lead Gateway — provider contract (Postgres thật)", () => {
  let khoiPhuc: () => void;
  beforeAll(async () => {
    assertTenDbTest();
    khoiPhuc = batMoiTruong();
    await dung();
  });
  afterAll(async () => {
    await don();
    khoiPhuc();
    await db.$disconnect();
  });
  beforeEach(async () => {
    mk.rateHong = false;
    mk.auto = false;
    await donHoiThoai();
    await db.aiLeadCatalogSnapshot.upsert({
      where: { version: 7 },
      update: {},
      create: { version: 7, publishedById: "ailtg", etag: "cat-7-a1b2c3", payload: (docFixture("01").response.body as { data: { pages: unknown[] } }).data as object, publishedAt: new Date("2026-10-26T02:00:00.000Z") },
    });
  });

  // Mỗi fixture → một hàm chạy ca. Fixture KHÔNG có trong bảng ⇒ [AIL-PV-00] đỏ.
  const CA: Record<string, (f: Fixture) => Promise<void>> = {
    "01": async (f) => soVoiFixture(await phat(f), f),
    "10": async (f) => soVoiFixture(await phat(f), f),
    "11": async (f) => soVoiFixture(await phat(f), f),
    "12": async (f) => soVoiFixture(await phat(f), f),
    "13": async (f) => soVoiFixture(await phat(f), f),
    "14": async (f) => soVoiFixture(await phat(f), f),
    "15": async (f) => soVoiFixture(await phat(f), f),
    "16": async (f) => {
      const goc = await phat(docFixture("10"));
      const lai = await phat(f);
      soVoiFixture(lai, f);
      // Phát lại = ĐÚNG phản hồi cũ, kể cả receiptId và meta.requestId (lead-intake-guide §7.4).
      expect(lai.body).toEqual(goc.body);
      expect(await db.aiLeadDraft.count({ where: { conversation: { agentId: AGENT_TEST } } })).toBe(1);
    },
    "17": async (f) => {
      soVoiFixture(await phat(f), f);
      const hs = await db.aiLeadDraft.findFirstOrThrow({ where: { conversation: { agentId: AGENT_TEST } } });
      expect(hs.consentAllowed).toBe(true);
      expect(hs.consentMid).toBe("m_TEST_consent_0007");
      expect(hs.phoneCanonical).toBe("84905123456");
    },
    "20": async (f) => soVoiFixture(await phat(f), f),
    "21": async (f) => {
      await datHoiThoai("HUMAN_ACTIVE");
      soVoiFixture(await phat(f), f);
    },
    "22": async (f) => {
      await datHoiThoai("HANDOFF_REQUESTED", true);
      soVoiFixture(await phat(f), f);
    },
    "23": async (f) => soVoiFixture(await phat(f), f),
    "30": async (f) => {
      // `occurredAt` của fixture là mốc CỐ ĐỊNH (26/10/2026 14:33 +07) và hợp đồng đòi lệch ≤ 24h so với giờ máy chủ ⇒ đóng băng đồng hồ gần mốc đó (luật 19).
      // Qua HTTP thật không đóng băng được đồng hồ của SERVER ⇒ thay `occurredAt` bằng giờ hiện tại (phần so sánh phản hồi không đổi).
      if (CHAY_QUA_HTTP) {
        soVoiFixture(await phat(f, { than: { ...(f.request.body as object), occurredAt: new Date().toISOString() } }), f);
      } else {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-26T08:00:00.000Z"));
        try {
          soVoiFixture(await phat(f), f);
        } finally {
          vi.useRealTimers();
        }
      }
      expect(await db.aiLeadIncident.count({ where: { agentId: AGENT_TEST } })).toBe(1);
    },
    "40": async (f) => soVoiFixture(await phat(f), f),
    "41": async (f) => {
      const b = (f.response.body as { data: { probe: { probeId: string; nonce: string } } }).data.probe;
      await db.aiLeadProbe.create({ data: { agentId: AGENT_TEST, probeId: b.probeId, nonce: b.nonce, expiresAt: new Date(Date.now() + 600_000) } });
      soVoiFixture(await phat(f), f);
    },
    "42": async (f) => {
      const ack = (f.request.body as { probeAck: { probeId: string; nonce: string } }).probeAck;
      await db.aiLeadProbe.create({ data: { agentId: AGENT_TEST, probeId: ack.probeId, nonce: ack.nonce, expiresAt: new Date(Date.now() + 600_000) } });
      soVoiFixture(await phat(f), f);
      const lenh = await db.aiLeadProbe.findUniqueOrThrow({ where: { probeId: ack.probeId } });
      expect(lenh.ackedAt).not.toBeNull();
      const run = await db.aiLeadVerificationRun.findFirstOrThrow({ where: { agentId: AGENT_TEST } });
      expect(run).toMatchObject({ level: "L2", kind: "PROBE", status: "PASS" });
      expect(run.evidence).toEqual({ nguon: "HE_THONG", agentId: AGENT_TEST, buildSha: "9f2c1ab", contractHash: "0".repeat(64), probeId: ack.probeId, environment: "TEST", pageIds: ["104500000000001"] });
    },
    "43": async (f) => {
      await db.aiLeadAgentPage.updateMany({ where: { agentId: AGENT_TEST, pageId: PAGE }, data: { state: "PAUSED" } });
      soVoiFixture(await phat(f), f);
    },
    "90": async (f) => soVoiFixture(await phat(f, { sigGhiDe: "0".repeat(64) }), f),
    "91": async (f) => soVoiFixture(await phat(f, { ts: Date.now() - 400_000 }), f),
    "92": async (f) => {
      const nonce = "nonce-dung-lai-0000000001";
      const a = await phat(docFixture("10"), { nonce });
      expect(a.status).toBe(200);
      soVoiFixture(await phat(f, { nonce }), f);
    },
    "93": async (f) => soVoiFixture(await phat(f), f),
    "94": async (f) => {
      await phat(docFixture("10"));
      soVoiFixture(await phat(f), f);
    },
    "95": async (f) => soVoiFixture(await phat(f), f),
    "96": async (f) => {
      await db.aiLeadAgentPage.updateMany({ where: { agentId: AGENT_TEST, pageId: PAGE }, data: { state: "PAUSED" } });
      soVoiFixture(await phat(f), f);
    },
    "97": async (f) => soVoiFixture(await phat(f, { agentId: AGENT_PROD }), f),
    "98": async (f) => {
      mk.rateHong = true;
      soVoiFixture(await phat(f), f);
    },
    "99": async (f) => {
      await db.aiLeadCatalogSnapshot.deleteMany({});
      soVoiFixture(await phat(f), f);
    },
  };
  // 77–79: PHẢN HỒI SAI dành cho test của provider (responseExpect INVALID); 80–89: request SAI.
  for (let i = 77; i <= 79; i++) {
    CA[String(i)] = async (f) => {
      expect(f.validates.responseExpect).toBe("INVALID");
      const ten = f.validates.response as keyof typeof SCHEMA_THEO_TEN;
      expect(SCHEMA_THEO_TEN[ten].safeParse(f.response.body).success, `${f.tep}: schema phải TỪ CHỐI phản hồi sai này`).toBe(false);
    };
  }
  for (let i = 80; i <= 89; i++) CA[String(i)] = async (f) => soVoiFixture(await phat(f), f);

  it("[AIL-PV-00] mọi fixture của gói đều có ca phụ trách (và không ca nào mồ côi)", () => {
    const so = tatCaFixture().map((f) => f.tep.slice(0, 2));
    expect([...new Set(so)].sort()).toEqual(Object.keys(CA).sort());
  });

  for (const f of tatCaFixture()) {
    const so = f.tep.slice(0, 2);
    // Fixture 98 (vượt hạn mức) cần mock `rateLimit` TRONG tiến trình — qua HTTP thật mock không xuyên được sang server ⇒ bỏ ở lượt HTTP (vẫn chạy in-process). Mọi ca khác chạy ở CẢ HAI đường vận chuyển.
    (CHAY_QUA_HTTP && so === "98" ? it.skip : it)(`[AIL-PV-${so}] ${f.tep}`, async () => {
      await CA[so]!(f);
    });
  }

  // ─── N1: TRUNG TÍNH — fixture 10 vs 15, hai trạng thái CRM khác nhau, TỪNG BYTE ───────────────────────────────────────────
  describe("[AIL-PV-N1] phản hồi KHÔNG phụ thuộc việc SĐT đã có trong CRM", () => {
    const mask = (t: string) =>
      t
        .replace(/"receiptId":"rct_[0-9a-f]{24}"/g, '"receiptId":"R"')
        .replace(/"requestId":"req_[0-9a-f]{24}"/g, '"requestId":"Q"')
        .replace(/"serverTime":\d+/g, '"serverTime":0');

    it("cùng dữ liệu Agent gửi: KHÔNG có lead ↔ CÓ lead trùng SĐT (cả dạng 0905… lẫn 84905…) ⇒ phản hồi giống nhau TỪNG BYTE (trừ receiptId/requestId/serverTime)", async () => {
      const k10 = await phat(docFixture("10"));
      await donHoiThoai();
      await db.lead.create({ data: { parentName: "AILTG_khach_cu", phone: "84905123456" } });
      await db.lead.create({ data: { parentName: "AILTG_khach_cu_2", phone: "0905123456" } });
      const k15 = await phat(docFixture("15"));
      expect(k10.status).toBe(200);
      expect(k15.status).toBe(k10.status);
      expect(mask(k15.thoRaw)).toBe(mask(k10.thoRaw));
      // Kể cả ĐỘ DÀI của chuỗi ngẫu nhiên và tập header: không có kênh phụ nào phân biệt hai nhánh.
      expect(k15.thoRaw.length).toBe(k10.thoRaw.length);
      const tenHeader = (p: PhanHoi) => Object.keys(p.header).filter((h) => h !== "x-server-time").sort();
      expect(tenHeader(k15)).toEqual(tenHeader(k10));
      expect(k15.header["cache-control"]).toBe(k10.header["cache-control"]);
      expect(k15.header["content-type"]).toBe(k10.header["content-type"]);
    });

    it("khách CÓ lead cũ vẫn tạo hồ sơ chờ bình thường (Gateway không đọc CRM để quyết định)", async () => {
      await db.lead.create({ data: { parentName: "AILTG_khach_cu", phone: "84905123456" } });
      const r = await phat(docFixture("15"));
      expect(r.status).toBe(200);
      expect(await db.aiLeadDraft.count({ where: { conversation: { agentId: AGENT_TEST } } })).toBe(1);
    });

    it("đã ghi nhận: thêm lead trùng SĐT GIỮA HAI LƯỢT của cùng hội thoại không đổi phản hồi lượt sau", async () => {
      const a = await phat(docFixture("11")); // NEED_INFO campus
      await db.lead.create({ data: { parentName: "AILTG_giua_chung", phone: "84905123456" } });
      const b = await phat(docFixture("10")); // gộp: đủ ⇒ ACCEPTED
      expect((a.body as { data: { status: string } }).data.status).toBe("NEED_INFO");
      expect((b.body as { data: { status: string } }).data.status).toBe("ACCEPTED");
    });
  });

  // ─── Bảo mật ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  describe("[AIL-PV-SEC] không phản hồi nào lộ dữ liệu nội bộ", () => {
    const KHOA_CAM = ["leadId", "saleId", "sourceId", "contactId", "studentId", "duplicate", "existing", "assignedTo", "ownerId", "orgUnitId", "centerId", "phoneCanonical", "draftId"];
    const KHOA_CHUOI = ["0905123456", "84905123456", "7000000000000001", "Phụ huynh Minh Anh"];

    it("quét mọi phản hồi của các fixture hợp lệ: không khoá cấm, không PII của chính request được dội lại", async () => {
      const thu: PhanHoi[] = [];
      for (const so of ["01", "10", "11", "13", "14", "17", "20", "30", "40"]) {
        await donHoiThoai();
        const f = docFixture(so);
        thu.push(await phat(f));
      }
      // Một lỗi mỗi loại (kể cả thân có PII).
      thu.push(await phat(docFixture("10"), { sigGhiDe: "0".repeat(64) }));
      thu.push(await phat(docFixture("93")));
      thu.push(await phat(docFixture("95")));
      thu.push(await phat(docFixture("82")));
      expect(thu.length).toBeGreaterThan(10);
      for (const p of thu) {
        for (const k of KHOA_CAM) expect(p.thoRaw, `lộ khoá "${k}": ${p.thoRaw.slice(0, 200)}`).not.toMatch(new RegExp(`"${k}"`, "i"));
        for (const g of KHOA_CHUOI) expect(p.thoRaw, `dội lại dữ liệu khách "${g}"`).not.toContain(g);
        expect(p.thoRaw).not.toMatch(/fbName|psid|phoneRaw/);
      }
    });

    it("agent KHÁC không thấy/đụng được hội thoại của agent này; Page của agent khác ⇒ PAGE_NOT_ALLOWED không kèm tên Page", async () => {
      const r = await phat(docFixture("10"), { agentId: AGENT_KHAC });
      expect(r.status).toBe(403);
      expect((r.body as { error: { code: string } }).error.code).toBe("PAGE_NOT_ALLOWED");
      expect(r.thoRaw).not.toContain(PAGE);
      expect(await db.aiLeadConversation.count({ where: { agentId: AGENT_KHAC } })).toBe(0);
    });

    it("catalog chỉ liệt kê Page được cấp cho agent đó", async () => {
      const a = await phat(docFixture("01"));
      const b = await phat(docFixture("01"), { agentId: AGENT_KHAC });
      const pa = (a.body as { data: { pages: { pageId: string }[] } }).data.pages.map((p) => p.pageId);
      const pb = (b.body as { data: { pages: { pageId: string; campuses: unknown[] }[] } }).data.pages;
      expect(pa).toEqual([PAGE]);
      expect(pb.map((p) => p.pageId)).toEqual(["104500000000002"]);
      expect(pb[0]!.campuses).toEqual([]); // được cấp Page nhưng chưa xuất bản cơ sở nào ⇒ danh sách rỗng, KHÔNG rò cơ sở của Page khác
    });
  });
});
