// @vitest-environment node
// lib/ai-lead/xac-thuc.test.ts — XÁC THỰC máy của cổng AI Lead: error-codes.md §3 ĐÚNG THỨ TỰ, từng cặp bước.
//
// Mã ca: [AIL-XT-01..]. DB giả (không Postgres) — tầng DB thật ở tests/ai-lead/*.spec.ts.
//
// CÁCH ĐO THỨ TỰ (luật 14 — một ca "mỗi bước một lỗi" KHÔNG chứng minh thứ tự): với MỌI cặp lỗi (i < j) cho cùng một request, mã trả về phải là mã của bước i.
// Danh sách lỗi `LOI` dưới đây được so với `THU_TU_KIEM` của hợp đồng ([AIL-XT-02]) — thêm/đổi bước mà quên cập nhật là đỏ.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAC_DINH_CAI_DAT, THU_TU_KIEM, type MaLoi } from "./hop-dong";
import { docFixture, docHmacVectors } from "./ho-tro-test";
import { docPhanHoi, taoYeuCauKy } from "./ho-tro-yeu-cau-test";

const mk = vi.hoisted(() => ({
  flag: true,
  agent: null as null | Record<string, unknown>,
  nonceTrung: false,
  nonceLoi: null as unknown,
  agentLoi: null as unknown,
  rateNhomHong: false,
  ratePsidHong: false,
  rateIpHong: false,
  congProdMo: true,
  cai: {} as Record<string, unknown>,
  findAgent: vi.fn(),
  createNonce: vi.fn(),
  rateLimit: vi.fn(),
  congProd: vi.fn(),
  khoaGhiDe: null as null | ((id: string, v: number) => string | null),
  ghiTuChoi: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { aiLeadAgent: { findUnique: mk.findAgent }, aiLeadNonce: { create: mk.createNonce } } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mk.rateLimit }));
vi.mock("@/lib/flags", () => ({ isAiLeadGatewayEnabled: () => mk.flag }));
vi.mock("@/lib/security/safe-equal", async () => {
  const that = await vi.importActual<typeof import("@/lib/security/safe-equal")>("@/lib/security/safe-equal");
  return { safeEqual: vi.fn(that.safeEqual) };
});
vi.mock("./cai-dat", async (goc) => {
  const that = await goc<typeof import("./cai-dat")>();
  return { ...that, docCaiDat: async () => mk.cai, congProd: mk.congProd };
});
vi.mock("./tu-choi", () => ({ ghiNhanTuChoi: mk.ghiTuChoi }));
vi.mock("./khoa", async (goc) => {
  const that = await goc<typeof import("./khoa")>();
  return { ...that, daoKhoaAgent: (id: string, v: number) => (mk.khoaGhiDe ? mk.khoaGhiDe(id, v) : that.daoKhoaAgent(id, v)) };
});

import { safeEqual } from "@/lib/security/safe-equal";
import { daoKhoaAgent } from "./khoa";
import { tranIpTruocXacThuc, xacThucYeuCauAgent, chuanHoaEtag } from "./xac-thuc";
import type { TenEndpoint } from "./hop-dong";

const AGENT_ID = "ailtgagenttest000001";
const PAGE = "104500000000001";
const NOW = 1_793_000_000_000;
const MASTER = "master-key-cho-test-ai-lead-0123456789abcdef";
let master0: string | undefined;

function agentMacDinh(): Record<string, unknown> {
  return {
    id: AGENT_ID,
    name: "agent-test",
    environment: "TEST",
    secretVersion: 1,
    active: true,
    contractStatus: "COMPATIBLE",
    pages: [{ pageId: PAGE, state: "ENABLED", routingCenterId: null }],
  };
}
const khoaThat = () => daoKhoaAgent(AGENT_ID, 1)!;
const fx = (so: string) => docFixture(so).request.body as Record<string, unknown>;
const THAN_INTAKE = () => fx("10");
const THAN_HANDOFF = () => fx("20");
const THAN_INCIDENT = () => fx("30");
const THAN_HEARTBEAT = () => fx("40");

beforeEach(() => {
  master0 = process.env.AI_LEAD_AGENT_MASTER_KEY;
  process.env.AI_LEAD_AGENT_MASTER_KEY = MASTER;
  mk.flag = true;
  mk.agent = agentMacDinh();
  mk.nonceTrung = false;
  mk.nonceLoi = null;
  mk.agentLoi = null;
  mk.rateNhomHong = false;
  mk.ratePsidHong = false;
  mk.rateIpHong = false;
  mk.congProdMo = true;
  mk.khoaGhiDe = null;
  mk.cai = { ...MAC_DINH_CAI_DAT, inboxLinkTemplate: "" };
  mk.findAgent.mockReset();
  mk.findAgent.mockImplementation(async () => {
    if (mk.agentLoi) throw mk.agentLoi;
    return mk.agent;
  });
  mk.createNonce.mockReset();
  mk.createNonce.mockImplementation(async () => {
    if (mk.nonceLoi) throw mk.nonceLoi;
    if (mk.nonceTrung) throw Object.assign(new Error("Unique constraint failed on (agentId, nonce)"), { code: "P2002" });
    return {};
  });
  mk.rateLimit.mockReset();
  mk.rateLimit.mockImplementation(async (a: { key: string }) => {
    const hong =
      (mk.rateIpHong && a.key.startsWith("ai-lead:ip:")) ||
      (mk.rateNhomHong && /^ai-lead:(catalog|intake|control):/.test(a.key)) ||
      (mk.ratePsidHong && a.key.startsWith("ai-lead:psid:"));
    return { success: !hong, remaining: hong ? 0 : 10, resetAt: NOW + 12_000 };
  });
  mk.congProd.mockReset();
  mk.congProd.mockImplementation(async () => ({ allowed: mk.congProdMo, reason: mk.congProdMo ? "OK" : "PROD_CHUA_BAT", thieu: [] }));
  vi.mocked(safeEqual).mockClear();
  mk.ghiTuChoi.mockReset();
});

afterEach(() => {
  if (master0 === undefined) delete process.env.AI_LEAD_AGENT_MASTER_KEY;
  else process.env.AI_LEAD_AGENT_MASTER_KEY = master0;
  vi.restoreAllMocks();
});

type Kich = {
  endpoint: TenEndpoint;
  than: unknown;
  khoa: string;
  agentId: string;
  ts: number;
  req: Parameters<typeof taoYeuCauKy>[0] extends infer T ? Partial<T> : never;
};

/** Một request HỢP LỆ cho endpoint (mọi lỗi sinh ra bằng cách làm hỏng đúng một chỗ). */
function hopLe(endpoint: TenEndpoint): Kich {
  const than = endpoint === "leadIntakes" ? THAN_INTAKE() : endpoint === "handoffs" ? THAN_HANDOFF() : endpoint === "incidents" ? THAN_INCIDENT() : endpoint === "heartbeats" ? THAN_HEARTBEAT() : undefined;
  return { endpoint, than, khoa: khoaThat(), agentId: AGENT_ID, ts: NOW, req: {} };
}
async function chay(k: Kich) {
  const req = taoYeuCauKy({ endpoint: k.endpoint, agentId: k.agentId, khoa: k.khoa, than: k.than, ts: k.ts, ...k.req });
  const kq = await xacThucYeuCauAgent(req, { endpoint: k.endpoint, nowMs: NOW });
  if (kq.ok) return { ok: true as const, ctx: kq.ctx };
  const p = await docPhanHoi(kq.res);
  const ma = (p.body as { error?: { code?: string } } | null)?.error?.code ?? null;
  return { ok: false as const, status: p.status, ma, p };
}

// ─── Mỗi lỗi: bước của hợp đồng + cách làm hỏng một request leadIntakes hợp lệ ──────────────────────────────────────────────
type Loi = { buoc: number; ma: MaLoi; tenCa: string; hong: (k: Kich) => void };
const LOI: Loi[] = [
  { buoc: 1, ma: "NOT_CONFIGURED", tenCa: "thiếu master key", hong: () => void delete process.env.AI_LEAD_AGENT_MASTER_KEY },
  { buoc: 2, ma: "UNSUPPORTED_CONTRACT", tenCa: "X-AiLead-Contract = 2", hong: (k) => void (k.req.contract = "2") },
  { buoc: 3, ma: "BAD_REQUEST", tenCa: "có query string", hong: (k) => void (k.req.query = "?a=1") },
  { buoc: 4, ma: "BODY_TOO_LARGE", tenCa: "thân vượt trần", hong: (k) => void (k.than = JSON.stringify({ pad: "x".repeat(9_000) })) },
  { buoc: 5, ma: "UNSUPPORTED_MEDIA_TYPE", tenCa: "Content-Type text/plain", hong: (k) => void (k.req.contentType = "text/plain") },
  { buoc: 6, ma: "BAD_SIGNATURE", tenCa: "chữ ký sai", hong: (k) => void (k.req.sigGhiDe = "0".repeat(64)) },
  { buoc: 7, ma: "CLOCK_SKEW", tenCa: "lệch giờ 400 s", hong: (k) => void (k.ts = NOW - 400_000) },
  { buoc: 8, ma: "AGENT_DISABLED", tenCa: "agent bị tắt", hong: () => void (mk.agent!.active = false) },
  { buoc: 9, ma: "RATE_LIMITED", tenCa: "vượt hạn mức nhóm", hong: () => void (mk.rateNhomHong = true) },
  { buoc: 10, ma: "NONCE_REUSED", tenCa: "nonce đã dùng", hong: () => void (mk.nonceTrung = true) },
  { buoc: 11, ma: "PAYLOAD_INVALID", tenCa: "khoá lạ trong thân", hong: (k) => void (k.than = { ...(k.than as object), khoaLa: 1 }) },
  { buoc: 13, ma: "TEST_ONLY_FIELD", tenCa: "testRunId trên agent PROD", hong: () => void (mk.agent!.environment = "PROD") },
  { buoc: 14, ma: "PAGE_NOT_ALLOWED", tenCa: "Page ngoài allowlist", hong: (k) => void (k.than = { ...(k.than as { conversation: object }), conversation: { ...(k.than as { conversation: object }).conversation, pageId: "999999999999999" } }) },
  { buoc: 15, ma: "UNSUPPORTED_CONTRACT", tenCa: "công tắc INCOMPATIBLE", hong: () => void (mk.agent!.contractStatus = "INCOMPATIBLE") },
  { buoc: 16, ma: "RATE_LIMITED", tenCa: "vượt hạn mức theo psid", hong: () => void (mk.ratePsidHong = true) },
];

describe("[AIL-XT-01] đối chứng dương: request hợp lệ qua cả 16 bước", () => {
  it.each([
    ["leadIntakes"],
    ["handoffs"],
    ["incidents"],
    ["heartbeats"],
    ["catalog"],
  ] as const)("%s", async (endpoint) => {
    const r = await chay(hopLe(endpoint));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) {
      expect(r.ctx.agent.id).toBe(AGENT_ID);
      expect(r.ctx.requestId).toMatch(/^req_[0-9a-f]{24}$/);
      expect(r.ctx.nowMs).toBe(NOW);
    }
    expect(mk.createNonce).toHaveBeenCalledTimes(1);
  });
});

describe("[AIL-XT-02] danh sách lỗi của test KHỚP THU_TU_KIEM của hợp đồng", () => {
  it("cùng chuỗi (bước, mã) — trừ bước 12 (chỉ heartbeat, test riêng) và 14b PAGE_PAUSED (đứng chung bước 14)", () => {
    const hopDong = THU_TU_KIEM.filter((t) => !(t.buoc === 12) && !(t.buoc === 14 && t.ma === "PAGE_PAUSED")).map((t) => `${t.buoc}:${t.ma}`);
    // Bước 17/18 (idempotency, lỗi lạ) không thuộc xác thực — test riêng.
    const trongXacThuc = hopDong.filter((s) => Number(s.split(":")[0]) <= 16);
    expect(LOI.map((l) => `${l.buoc}:${l.ma}`)).toEqual(trongXacThuc);
  });
});

describe("[AIL-XT-02b] vị trí BỐN bước phụ (0 · 5b · 8a · 8b) trong xac-thuc.ts và thứ tự các bước đánh số", () => {
  it("bước đánh số 1…16 xuất hiện ĐÚNG thứ tự; mỗi bước phụ nằm giữa đúng hai bước kề nó (đổi chỗ ⇒ đổi mã người gọi thấy)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const ma = readFileSync(resolve(process.cwd(), "lib/ai-lead/xac-thuc.ts"), "utf8").split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
    const than = ma.slice(ma.indexOf("export async function xacThucYeuCauAgent"));
    const vt = (s: string) => {
      const i = than.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    // các dòng chú thích bước đánh số trong thân hàm
    const buoc = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((n) => vt(`    // ${n}. `));
    expect([...buoc].sort((a, b) => a - b)).toEqual(buoc);
    expect(vt("if (!isAiLeadGatewayEnabled())")).toBeLessThan(buoc[1]!); // (0) cờ tắt ⇒ 404 trước mọi bước (kể cả bước 2)
    expect(vt("tranIpTruocXacThuc(cai)")).toBeGreaterThan(buoc[4]!); // (5b) sau bước 5…
    expect(vt("tranIpTruocXacThuc(cai)")).toBeLessThan(buoc[5]!); // …và TRƯỚC bước 6 (tra DB)
    expect(vt("agentTestDuocChayTrenMayChu()")).toBeGreaterThan(buoc[7]!); // (8a) sau bước 8…
    expect(vt("agentTestDuocChayTrenMayChu()")).toBeLessThan(vt("(await congProd()).allowed")); // …và trước 8b
    expect(vt("(await congProd()).allowed")).toBeLessThan(buoc[8]!); // (8b) TRƯỚC bước 9
  });
});

describe("[AIL-XT-03] từng lỗi ĐƠN: đúng mã + đúng HTTP + đúng điều kiện (đã/chưa chạm DB)", () => {
  it.each(LOI.map((l) => [l.buoc, l.tenCa, l] as const))("bước %i · %s", async (_b, _t, l) => {
    const k = hopLe("leadIntakes");
    l.hong(k);
    const r = await chay(k);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe(l.ma);
    // Nonce CHỈ được ghi khi đã qua bước 6–9 (bước 10 là bước ghi; lỗi từ bước 11 trở đi nonce đã ghi).
    expect(mk.createNonce.mock.calls.length, "nonce ghi sau xác thực").toBe(l.buoc >= 10 ? 1 : 0);
    // Trước bước 6 không tra agent.
    expect(mk.findAgent.mock.calls.length > 0, "tra agent từ bước 6").toBe(l.buoc >= 6);
  });
});

describe("[AIL-XT-04] THỨ TỰ: với MỌI cặp lỗi (i<j) cùng lúc, mã trả về là mã của bước đứng TRƯỚC", () => {
  const cap: [Loi, Loi][] = [];
  for (let i = 0; i < LOI.length; i++) for (let j = i + 1; j < LOI.length; j++) cap.push([LOI[i]!, LOI[j]!]);
  it.each(cap.map(([a, b]) => [`${a.buoc}/${a.ma} < ${b.buoc}/${b.ma}`, a, b] as const))("%s", async (_ten, truoc, sau) => {
    const k = hopLe("leadIntakes");
    truoc.hong(k);
    sau.hong(k);
    const r = await chay(k);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe(truoc.ma);
  });

  it("bước 16 (psid) nằm SAU nonce: lượt RATE_LIMITED theo psid đã ghi nonce (error-codes §3)", async () => {
    const k = hopLe("leadIntakes");
    mk.ratePsidHong = true;
    const r = await chay(k);
    expect(r.ok).toBe(false);
    expect(mk.createNonce).toHaveBeenCalledTimes(1);
  });

  it("PAGE_NOT_ALLOWED đứng trước PAGE_PAUSED ở cùng bước 14 (Page lạ không thể 'tạm dừng')", async () => {
    const k = hopLe("leadIntakes");
    (mk.agent!.pages as { state: string }[])[0]!.state = "PAUSED";
    k.than = { ...(k.than as { conversation: object }), conversation: { ...(k.than as { conversation: object }).conversation, pageId: "999999999999999" } };
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("PAGE_NOT_ALLOWED");
  });
});

describe("[AIL-XT-05] bước 12 ENVIRONMENT_MISMATCH (chỉ heartbeat): sau PAYLOAD_INVALID, trước mọi bước còn lại", () => {
  it("agent TEST gửi environment=PROD ⇒ ENVIRONMENT_MISMATCH 403 field=environment", async () => {
    const k = hopLe("heartbeats");
    k.than = { ...(k.than as object), environment: "PROD" };
    const r = await chay(k);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.ma).toBe("ENVIRONMENT_MISMATCH");
      expect(r.status).toBe(403);
      expect((r.p.body as { error: { field?: string } }).error.field).toBe("environment");
    }
  });
  it("khoá lạ (bước 11) thắng environment sai (bước 12)", async () => {
    const k = hopLe("heartbeats");
    k.than = { ...(k.than as object), environment: "PROD", khoaLa: 1 };
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("PAYLOAD_INVALID");
  });
  it("lỗi sớm hơn (chữ ký sai) thắng environment sai", async () => {
    const k = hopLe("heartbeats");
    k.than = { ...(k.than as object), environment: "PROD" };
    k.req.sigGhiDe = "1".repeat(64);
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("BAD_SIGNATURE");
  });
});

describe("[AIL-XT-06] BAD_SIGNATURE: agent LẠ và chữ ký SAI không phân biệt được", () => {
  it("cùng status · cùng tên header · cùng thân (trừ requestId) · cùng chuỗi lời gọi (tra 1, so 1, không ghi nonce)", async () => {
    // (a) agent có thật, chữ ký sai.
    const a = hopLe("leadIntakes");
    a.req.sigGhiDe = "a".repeat(64);
    const ra = await chay(a);
    const goiA = { tra: mk.findAgent.mock.calls.length, so: vi.mocked(safeEqual).mock.calls.length, nonce: mk.createNonce.mock.calls.length };

    mk.findAgent.mockClear();
    mk.createNonce.mockClear();
    vi.mocked(safeEqual).mockClear();
    // (b) agent không tồn tại — ký bằng một khoá bất kỳ.
    mk.agent = null;
    const b = hopLe("leadIntakes");
    b.agentId = "ailtgagentkhongco0001";
    const rb = await chay(b);
    const goiB = { tra: mk.findAgent.mock.calls.length, so: vi.mocked(safeEqual).mock.calls.length, nonce: mk.createNonce.mock.calls.length };

    expect(ra.ok || rb.ok).toBe(false);
    if (ra.ok || rb.ok) return;
    expect(ra.status).toBe(401);
    expect(rb.status).toBe(ra.status);
    expect(Object.keys(rb.p.header).sort()).toEqual(Object.keys(ra.p.header).sort());
    const bo = (p: typeof ra.p) => {
      const e = (p.body as { error: { requestId: string } & Record<string, unknown> }).error;
      return { ...e, requestId: "X" };
    };
    expect(bo(rb.p)).toEqual(bo(ra.p));
    expect(rb.p.header["cache-control"]).toBe(ra.p.header["cache-control"]);
    expect(goiA).toEqual({ tra: 1, so: 1, nonce: 0 });
    expect(goiB).toEqual(goiA);
  });

  it("agent lạ ký ĐÚNG bằng khoá dẫn xuất v1 của chính id đó vẫn bị từ chối (chữ ký đúng KHÔNG đủ khi agent không tồn tại)", async () => {
    mk.agent = null;
    const b = hopLe("leadIntakes");
    b.agentId = "ailtgagentkhongco0002";
    b.khoa = daoKhoaAgent(b.agentId, 1)!;
    const r = await chay(b);
    expect(r.ok === false && r.ma).toBe("BAD_SIGNATURE");
  });

  it("chữ ký viết HOA vẫn khớp (so không phân biệt hoa/thường) — và KHÔNG làm đổi kết quả với chữ ký sai", async () => {
    const k = hopLe("catalog");
    const req0 = taoYeuCauKy({ endpoint: "catalog", agentId: k.agentId, khoa: k.khoa, ts: NOW, nonce: "nonce-hoa-0000000001" });
    const sig = req0.headers.get("x-ailead-sig")!;
    const req = taoYeuCauKy({ endpoint: "catalog", agentId: k.agentId, khoa: k.khoa, ts: NOW, nonce: "nonce-hoa-0000000001", sigGhiDe: sig.toUpperCase() });
    const kq = await xacThucYeuCauAgent(req, { endpoint: "catalog", nowMs: NOW });
    expect(kq.ok).toBe(true);
  });
});

describe("[AIL-XT-07] biên lệch giờ: đúng 300000 ms qua, +1 rớt (cả hai phía)", () => {
  it.each([
    [-300_000, true],
    [300_000, true],
    [-300_001, false],
    [300_001, false],
    [0, true],
  ] as const)("lệch %i ms ⇒ qua=%s", async (lech, qua) => {
    const k = hopLe("leadIntakes");
    k.ts = NOW + lech;
    const r = await chay(k);
    expect(r.ok).toBe(qua);
    if (!r.ok) expect(r.ma).toBe("CLOCK_SKEW");
  });
  it("lệch giờ lấy từ THAM SỐ ai.clockSkewMs, không phải hằng", async () => {
    mk.cai = { ...mk.cai, clockSkewMs: 1_000 };
    const k = hopLe("leadIntakes");
    k.ts = NOW + 1_001;
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("CLOCK_SKEW");
    mk.createNonce.mockClear();
    const k2 = hopLe("leadIntakes");
    k2.ts = NOW + 1_000;
    expect((await chay(k2)).ok).toBe(true);
  });
});

describe("[AIL-XT-08] trần thân: đúng ai.bodyMaxBytes qua, +1 rớt; GET thân rỗng; trần tuyệt đối 65536", () => {
  const thanDai = (n: number) => {
    const goc = { ...THAN_INTAKE() } as Record<string, unknown>;
    // pad bằng chuỗi trong khoá lạ — thân sẽ PAYLOAD_INVALID nhưng ĐÃ qua cổng kích thước (bước 4) ⇒ phân biệt được với BODY_TOO_LARGE.
    // Tính THEO BYTE (thân có tiếng Việt: length ≠ byteLength).
    const co = Buffer.byteLength(JSON.stringify({ ...goc, p: "" }));
    return JSON.stringify({ ...goc, p: "x".repeat(Math.max(0, n - co)) });
  };
  it("đúng 8192 byte ⇒ KHÔNG phải BODY_TOO_LARGE", async () => {
    const k = hopLe("leadIntakes");
    k.than = thanDai(8_192);
    expect(Buffer.byteLength(k.than as string)).toBe(8_192);
    const r = await chay(k);
    expect(r.ok === false && r.ma).not.toBe("BODY_TOO_LARGE");
  });
  it("8193 byte ⇒ BODY_TOO_LARGE 413", async () => {
    const k = hopLe("leadIntakes");
    k.than = thanDai(8_193);
    const r = await chay(k);
    expect(r.ok === false && [r.ma, r.status]).toEqual(["BODY_TOO_LARGE", 413]);
  });
  it("content-length khai nhỏ nhưng gửi lớn vẫn bị chặn ở vòng đọc", async () => {
    const k = hopLe("leadIntakes");
    k.than = thanDai(9_000);
    k.req.header = { "content-length": "100" };
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("BODY_TOO_LARGE");
  });
  it("BODY_TOO_LARGE thắng UNSUPPORTED_MEDIA_TYPE (bước 4 trước bước 5)", async () => {
    const k = hopLe("leadIntakes");
    k.than = thanDai(9_000);
    k.req.contentType = "text/plain";
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("BODY_TOO_LARGE");
  });
  it("tham số ai.bodyMaxBytes vượt trần tuyệt đối ⇒ vẫn bị kẹp ở 65536", async () => {
    mk.cai = { ...mk.cai, bodyMaxBytes: 10_000_000 };
    const k = hopLe("leadIntakes");
    k.than = thanDai(65_537);
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("BODY_TOO_LARGE");
  });
  it("GET /catalog có thân ⇒ BAD_REQUEST field=body", async () => {
    const k = hopLe("catalog");
    // Web Request không cho GET mang thân ⇒ khai `content-length` > 0 (cổng kiểm cả header lẫn byte thật).
    k.req.header = { "content-length": "5" };
    const r = await chay(k);
    expect(r.ok === false && [r.ma, (r.p.body as { error: { field?: string } }).error.field]).toEqual(["BAD_REQUEST", "body"]);
  });
});

describe("[AIL-XT-09] bước 3: query · header sai định dạng · If-None-Match", () => {
  it("query ⇒ BAD_REQUEST field=query", async () => {
    const k = hopLe("catalog");
    k.req.query = "?x=1";
    const r = await chay(k);
    expect(r.ok === false && (r.p.body as { error: { field?: string } }).error.field).toBe("query");
  });
  it.each([
    ["x-ailead-agent", "TOO-SHORT"],
    ["x-ailead-ts", "12345"],
    ["x-ailead-nonce", "ngan"],
    ["x-ailead-sig", "zz"],
  ] as const)("header %s sai định dạng ⇒ BAD_REQUEST (field = tên header hiển thị, KHÔNG kèm giá trị)", async (ten, giaTri) => {
    const k = hopLe("catalog");
    k.req.header = { [ten]: giaTri };
    const r = await chay(k);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.ma).toBe("BAD_REQUEST");
    expect(r.p.thoRaw).not.toContain(giaTri === "zz" ? "\"zz\"" : giaTri);
  });
  it("If-None-Match dài hơn 128 ký tự ⇒ BAD_REQUEST", async () => {
    const k = hopLe("catalog");
    k.req.header = { "if-none-match": "a".repeat(129) };
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("BAD_REQUEST");
  });
  it("If-None-Match được chuẩn hoá (W/ và nháy kép)", async () => {
    expect(chuanHoaEtag('W/"cat-7-abc"')).toBe("cat-7-abc");
    expect(chuanHoaEtag("cat-7-abc")).toBe("cat-7-abc");
    const k = hopLe("catalog");
    k.req.header = { "if-none-match": '"cat-7-abc"' };
    const r = await chay(k);
    expect(r.ok && r.ctx.ifNoneMatch).toBe("cat-7-abc");
  });
});

describe("[AIL-XT-10] cờ cổng · master key · cổng PROD", () => {
  it("cờ TẮT ⇒ 404 JSON khung chuẩn (không phải HTML), có X-Server-Time + no-store, KHÔNG chạm DB/hạn mức", async () => {
    mk.flag = false;
    const r = await chay(hopLe("leadIntakes"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
    expect(r.p.header["content-type"]).toContain("application/json");
    expect(r.p.header["x-server-time"]).toBe(String(NOW));
    expect(r.p.header["cache-control"]).toBe("no-store");
    expect(r.p.body).toMatchObject({ ok: false, error: { code: "NOT_FOUND", requestId: expect.stringMatching(/^req_[0-9a-f]{24}$/) } });
    expect(mk.findAgent).not.toHaveBeenCalled();
    expect(mk.rateLimit).not.toHaveBeenCalled();
    expect(mk.createNonce).not.toHaveBeenCalled();
  });
  it("master key NGẮN hơn 32 ký tự ⇒ coi như chưa cấu hình (503), không chạm DB", async () => {
    const k = hopLe("leadIntakes");
    process.env.AI_LEAD_AGENT_MASTER_KEY = "ngan-qua";
    const r = await chay(k);
    expect(r.ok === false && [r.status, r.ma]).toEqual([503, "NOT_CONFIGURED"]);
    expect(mk.findAgent).not.toHaveBeenCalled();
  });
  it("agent PROD + cổng PROD ĐÓNG ⇒ NOT_CONFIGURED 503, và KHÔNG ghi nonce", async () => {
    mk.agent!.environment = "PROD";
    mk.congProdMo = false;
    const r = await chay(hopLe("leadIntakes"));
    expect(r.ok === false && [r.status, r.ma]).toEqual([503, "NOT_CONFIGURED"]);
    expect(mk.createNonce).not.toHaveBeenCalled();
  });
  it("agent PROD + cổng MỞ ⇒ vào được tới bước testRunId (TEST_ONLY_FIELD vì thân fixture có testRunId)", async () => {
    mk.agent!.environment = "PROD";
    const r = await chay(hopLe("leadIntakes"));
    expect(r.ok === false && [r.status, r.ma]).toEqual([400, "TEST_ONLY_FIELD"]);
    expect(mk.congProd).toHaveBeenCalledTimes(1);
  });
  it("agent PROD + cổng MỞ + thân không có testRunId ⇒ qua", async () => {
    mk.agent!.environment = "PROD";
    const k = hopLe("leadIntakes");
    const { testRunId: _bo, ...khong } = k.than as Record<string, unknown>;
    void _bo;
    k.than = khong;
    expect((await chay(k)).ok).toBe(true);
  });
  it("agent TEST KHÔNG hỏi cổng PROD", async () => {
    await chay(hopLe("leadIntakes"));
    expect(mk.congProd).not.toHaveBeenCalled();
  });
  it("cổng PROD đứng SAU chữ ký: người lạ không dò được trạng thái cổng (chữ ký sai ⇒ BAD_SIGNATURE dù cổng đóng)", async () => {
    mk.agent!.environment = "PROD";
    mk.congProdMo = false;
    const k = hopLe("leadIntakes");
    k.req.sigGhiDe = "2".repeat(64);
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("BAD_SIGNATURE");
    expect(mk.congProd).not.toHaveBeenCalled();
  });
  it("agent bị tắt thắng cổng PROD (AGENT_DISABLED trước NOT_CONFIGURED của cổng)", async () => {
    mk.agent!.environment = "PROD";
    mk.agent!.active = false;
    mk.congProdMo = false;
    const r = await chay(hopLe("leadIntakes"));
    expect(r.ok === false && r.ma).toBe("AGENT_DISABLED");
  });
});

describe("[AIL-XT-FIX03] Agent TEST trên máy chủ PROD bị chặn theo môi trường MÁY CHỦ (fail-closed)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const TAT_CA = ["leadIntakes", "handoffs", "incidents", "heartbeats", "catalog"] as const;

  it.each(TAT_CA)("[FIX03-01] %s: VERCEL_ENV=production + agent TEST (khoá ĐÚNG, đang bật) ⇒ 401 AGENT_DISABLED, không lọt xuống nonce/xử lý", async (endpoint) => {
    vi.stubEnv("VERCEL_ENV", "production");
    const r = await chay(hopLe(endpoint));
    expect(r.ok === false && [r.status, r.ma]).toEqual([401, "AGENT_DISABLED"]);
    expect(mk.createNonce).not.toHaveBeenCalled();
  });
  it.each(TAT_CA)("[FIX03-02] %s: đối chứng dương — VERCEL_ENV=preview (máy chủ TEST) ⇒ cùng request hợp lệ qua", async (endpoint) => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await chay(hopLe(endpoint))).ok).toBe(true);
  });
  it("[FIX03-03] không có VERCEL_ENV: NODE_ENV=production thật (không CI) ⇒ chặn; NODE_ENV=development ⇒ qua (máy dev)", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("CI", "");
    vi.stubEnv("NODE_ENV", "production");
    const chan = await chay(hopLe("leadIntakes"));
    expect(chan.ok === false && chan.ma).toBe("AGENT_DISABLED");
    vi.stubEnv("NODE_ENV", "development");
    expect((await chay(hopLe("leadIntakes"))).ok).toBe(true);
  });
  it.each(["Production", "PRODUCTION", " production ", "prod", "live", "staging"])(
    "[FIX03-08] VERCEL_ENV khai SAI KIỂU hoặc LẠ (%j) ⇒ vẫn CHẶN agent TEST (danh sách cho phép, không phải phủ định `!== production`)",
    async (gia) => {
      vi.stubEnv("VERCEL_ENV", gia);
      const r = await chay(hopLe("leadIntakes"));
      expect(r.ok === false && r.ma).toBe("AGENT_DISABLED");
    },
  );
  it.each(["Preview", " development", "TEST"])("[FIX03-09] đối chứng dương: %j (ba giá trị không-phải-production, chuẩn hoá hoa/thường/khoảng trắng) ⇒ qua", async (gia) => {
    vi.stubEnv("VERCEL_ENV", gia);
    expect((await chay(hopLe("leadIntakes"))).ok).toBe(true);
  });
  it("[FIX03-04] một URL `test.*` lạc trên PROD KHÔNG mở cổng (cố ý không có vế 'host là test')", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://test.satarobo.vn");
    const r = await chay(hopLe("leadIntakes"));
    expect(r.ok === false && r.ma).toBe("AGENT_DISABLED");
  });
  it("[FIX03-05] không dựa vào trường client: heartbeat khai `environment: PROD` nhưng khoá là TEST ⇒ vẫn AGENT_DISABLED (chặn đứng TRƯỚC bước so environment)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const k = hopLe("heartbeats");
    k.than = { ...(k.than as object), environment: "PROD" };
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("AGENT_DISABLED");
  });
  it("[FIX03-06] người chưa ký đúng không dò được môi trường: chữ ký sai trên PROD ⇒ BAD_SIGNATURE, không phải AGENT_DISABLED", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const k = hopLe("leadIntakes");
    k.req.sigGhiDe = "3".repeat(64);
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("BAD_SIGNATURE");
  });
  it("[FIX03-07] agent PROD không bị vế này đụng tới: production + PROD + cổng mở ⇒ qua", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    mk.agent!.environment = "PROD";
    mk.congProdMo = true;
    const k = hopLe("leadIntakes");
    k.than = { ...(k.than as { testRunId?: string }), testRunId: undefined };
    delete (k.than as { testRunId?: string }).testRunId;
    expect((await chay(k)).ok).toBe(true);
  });
});

describe("[AIL-XT-11] phạm vi từng bước 14/15 theo endpoint", () => {
  it("PAGE_PAUSED chặn /lead-intakes nhưng KHÔNG chặn /handoffs (Page tạm dừng vẫn cho xin gặp người)", async () => {
    (mk.agent!.pages as { state: string }[])[0]!.state = "PAUSED";
    const a = await chay(hopLe("leadIntakes"));
    expect(a.ok === false && [a.status, a.ma]).toEqual([403, "PAGE_PAUSED"]);
    const b = await chay(hopLe("handoffs"));
    expect(b.ok).toBe(true);
  });
  it("INCOMPATIBLE chặn /lead-intakes (400) nhưng /handoffs và /incidents vẫn qua", async () => {
    mk.agent!.contractStatus = "INCOMPATIBLE";
    const a = await chay(hopLe("leadIntakes"));
    expect(a.ok === false && [a.status, a.ma]).toEqual([400, "UNSUPPORTED_CONTRACT"]);
    expect((await chay(hopLe("handoffs"))).ok).toBe(true);
    expect((await chay(hopLe("incidents"))).ok).toBe(true);
    expect((await chay(hopLe("heartbeats"))).ok).toBe(true);
  });
  it("/handoffs với Page ngoài allowlist ⇒ PAGE_NOT_ALLOWED", async () => {
    const k = hopLe("handoffs");
    k.than = { ...(k.than as { conversation: object }), conversation: { ...(k.than as { conversation: object }).conversation, pageId: "888888888888888" } };
    expect((await chay(k)).ok).toBe(false);
  });
  it("/incidents: pageId ngoài allowlist ⇒ PAGE_NOT_ALLOWED; KHÔNG có pageId ⇒ qua", async () => {
    const k = hopLe("incidents");
    k.than = { ...(k.than as object), pageId: "777777777777777" };
    const a = await chay(k);
    expect(a.ok === false && a.ma).toBe("PAGE_NOT_ALLOWED");
    const k2 = hopLe("incidents");
    const { pageId: _p, ...khong } = k2.than as Record<string, unknown>;
    void _p;
    k2.than = khong;
    expect((await chay(k2)).ok).toBe(true);
  });
  it("/heartbeats: pageId lạ trong pages[] KHÔNG bị chặn (P5: bỏ qua im lặng)", async () => {
    const k = hopLe("heartbeats");
    k.than = { ...(k.than as { pages: object[] }), pages: [{ pageId: "666666666666666", lastWebhookEventAt: null }] };
    expect((await chay(k)).ok).toBe(true);
  });
  it("PAGE_NOT_ALLOWED KHÔNG lộ Page có tồn tại ở agent khác: thân lỗi giống hệt cho Page 'có thật' và Page 'bịa'", async () => {
    const ket: string[] = [];
    for (const pageId of ["999999999999999", "104599999999999"]) {
      const k = hopLe("leadIntakes");
      k.than = { ...(k.than as { conversation: object }), conversation: { ...(k.than as { conversation: object }).conversation, pageId } };
      const r = await chay(k);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const e = (r.p.body as { error: Record<string, unknown> }).error;
        ket.push(JSON.stringify({ ...e, requestId: "X", status: r.status }));
        expect(r.p.thoRaw).not.toContain(pageId);
      }
    }
    expect(ket[0]).toBe(ket[1]);
  });
  it("/incidents occurredAt lệch > 24h ⇒ PAYLOAD_INVALID field=occurredAt; đúng 24h vẫn qua", async () => {
    const k = hopLe("incidents");
    k.than = { ...(k.than as object), occurredAt: new Date(NOW - 24 * 3_600_000 - 1_000).toISOString() };
    const a = await chay(k);
    expect(a.ok === false && [a.ma, (a.p.body as { error: { field?: string } }).error.field]).toEqual(["PAYLOAD_INVALID", "occurredAt"]);
    const k2 = hopLe("incidents");
    k2.than = { ...(k2.than as object), occurredAt: new Date(NOW - 24 * 3_600_000).toISOString() };
    expect((await chay(k2)).ok).toBe(true);
  });
});

describe("[AIL-XT-12] JSON strict + zod: field chỉ là ĐƯỜNG DẪN, không bao giờ là giá trị", () => {
  it("JSON hỏng ⇒ PAYLOAD_INVALID (không field)", async () => {
    const k = hopLe("leadIntakes");
    k.than = "{không phải json";
    const r = await chay(k);
    expect(r.ok === false && [r.ma, (r.p.body as { error: { field?: string } }).error.field]).toEqual(["PAYLOAD_INVALID", undefined]);
  });
  it("UTF-8 hỏng ⇒ PAYLOAD_INVALID (TextDecoder fatal)", async () => {
    const k = hopLe("leadIntakes");
    const hong = Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}')]).toString("latin1");
    // taoYeuCauKy ghi chuỗi bằng utf8 — dựng request thô để giữ đúng byte hỏng.
    void hong;
    k.than = "\ud800";
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("PAYLOAD_INVALID");
  });
  it("khoá lạ trong candidate ⇒ field=candidate.sourceId, không chứa giá trị khách gửi", async () => {
    const k = hopLe("leadIntakes");
    const b = k.than as { candidate: object };
    k.than = { ...b, candidate: { ...b.candidate, sourceId: "GIA-TRI-BI-MAT-0905123456" } };
    const r = await chay(k);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect((r.p.body as { error: { field?: string } }).error.field).toBe("candidate.sourceId");
    expect(r.p.thoRaw).not.toContain("GIA-TRI-BI-MAT");
    expect(r.p.thoRaw).not.toContain("0905");
  });
  it("thân thiếu evidence khi có phoneRaw (fixture 80) ⇒ PAYLOAD_INVALID", async () => {
    const f = docFixture("80");
    const k = hopLe("leadIntakes");
    k.than = f.request.body;
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("PAYLOAD_INVALID");
  });
});

describe("[AIL-XT-13] hạn mức: khoá, nhóm, IP, Retry-After", () => {
  it("khoá hạn mức theo NHÓM endpoint + agent; psid KHÔNG xuất hiện thô trong khoá", async () => {
    await chay(hopLe("leadIntakes"));
    const khoa = mk.rateLimit.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(khoa).toContain(`ai-lead:intake:${AGENT_ID}`);
    expect(khoa.some((s) => s.startsWith(`ai-lead:psid:${AGENT_ID}:`))).toBe(true);
    expect(khoa.some((s) => s.startsWith("ai-lead:ip:"))).toBe(true);
    for (const s of khoa) expect(s).not.toContain("7000000000000001");
  });
  it.each([
    ["catalog", "ai-lead:catalog:", "rateCatalogPerMin"],
    ["handoffs", "ai-lead:control:", "rateControlPerMin"],
    ["incidents", "ai-lead:control:", "rateControlPerMin"],
    ["heartbeats", "ai-lead:control:", "rateControlPerMin"],
  ] as const)("%s dùng nhóm đúng (%s) và đúng tham số %s", async (endpoint, tienTo, thamSo) => {
    mk.cai = { ...mk.cai, [thamSo]: 17 };
    await chay(hopLe(endpoint));
    const goi = mk.rateLimit.mock.calls.map((c) => c[0] as { key: string; max: number }).find((a) => a.key.startsWith(tienTo))!;
    expect(goi.key).toBe(`${tienTo}${AGENT_ID}`);
    expect(goi.max).toBe(17);
  });
  it("nhóm dùng nhau độc lập: heartbeat/handoff/incident dùng CHUNG khoá nhóm control; intake và catalog khoá riêng", async () => {
    const khoaCua = async (e: TenEndpoint) => {
      mk.rateLimit.mockClear();
      await chay(hopLe(e));
      return mk.rateLimit.mock.calls.map((c) => (c[0] as { key: string }).key).find((s) => /^ai-lead:(catalog|intake|control):/.test(s));
    };
    const [h, o, i, c, l] = [await khoaCua("heartbeats"), await khoaCua("handoffs"), await khoaCua("incidents"), await khoaCua("catalog"), await khoaCua("leadIntakes")];
    expect(new Set([h, o, i]).size).toBe(1);
    expect(new Set([h, c, l]).size).toBe(3);
  });
  it("RATE_LIMITED có Retry-After = ceil((resetAt − now)/1000) ≥ 1", async () => {
    mk.rateNhomHong = true;
    const r = await chay(hopLe("leadIntakes"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(429);
      expect(r.p.header["retry-after"]).toBe("12");
    }
  });
  it("hạn mức theo IP chạy TRƯỚC khi tra agent (người lạ không đốt DB) và trả RATE_LIMITED", async () => {
    mk.rateIpHong = true;
    const r = await chay(hopLe("leadIntakes"));
    expect(r.ok === false && r.ma).toBe("RATE_LIMITED");
    expect(mk.findAgent).not.toHaveBeenCalled();
  });
  it("trần IP ≥ tổng ba nhóm (một agent đứng sau MỘT IP gửi cả ba nhóm)", () => {
    const c = MAC_DINH_CAI_DAT;
    expect(tranIpTruocXacThuc(c)).toBeGreaterThanOrEqual(c.rateCatalogPerMin + c.rateIntakePerMin + c.rateControlPerMin);
  });
});

describe("[AIL-XT-14] lỗi lạ: 500/503 có cấu trúc, log CHỈ mã + requestId", () => {
  it("lỗi bất kỳ khi tra agent ⇒ 500 INTERNAL_ERROR; console.error KHÔNG chứa message/PII/secret", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mk.agentLoi = new Error("Invalid `prisma.aiLeadAgent.findUnique()` phoneRaw=0905123456 secret=abc");
    const r = await chay(hopLe("leadIntakes"));
    expect(r.ok === false && [r.status, r.ma]).toEqual([500, "INTERNAL_ERROR"]);
    const log = spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(log).not.toContain("0905123456");
    expect(log).not.toContain("secret=abc");
    expect(log).toMatch(/requestId=req_[0-9a-f]{24}/);
    for (const c of spy.mock.calls) for (const a of c) expect(typeof a).toBe("string"); // không bao giờ in nguyên đối tượng lỗi
  });
  it.each(["P1001", "P2024", "P2028", "P1017"])("lỗi hạ tầng Prisma %s ⇒ 503 TEMP_UNAVAILABLE + Retry-After (không phải 500)", async (code) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mk.agentLoi = Object.assign(new Error("db"), { code });
    const r = await chay(hopLe("leadIntakes"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect([r.status, r.ma]).toEqual([503, "TEMP_UNAVAILABLE"]);
      expect(Number(r.p.header["retry-after"])).toBeGreaterThanOrEqual(1);
    }
  });
  it("lỗi DB khi ghi nonce KHÔNG bị nuốt thành NONCE_REUSED", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mk.nonceLoi = Object.assign(new Error("boom"), { code: "P2010" });
    const r = await chay(hopLe("leadIntakes"));
    expect(r.ok === false && r.ma).toBe("INTERNAL_ERROR");
  });
});

describe("[AIL-XT-15] mọi phản hồi lỗi mang X-Server-Time + Cache-Control: no-store + khung chuẩn", () => {
  it.each(LOI.map((l) => [l.buoc, l.ma, l] as const))("bước %i %s", async (_b, _m, l) => {
    const k = hopLe("leadIntakes");
    l.hong(k);
    const r = await chay(k);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.p.header["x-server-time"]).toBe(String(NOW));
    expect(r.p.header["cache-control"]).toBe("no-store");
    expect(r.p.body).toMatchObject({ ok: false, error: { code: l.ma, message: expect.any(String), requestId: expect.stringMatching(/^req_[0-9a-f]{24}$/) } });
  });
});

describe("[AIL-XT-16] vector HMAC V1–V3 của hợp đồng xác thực qua CHÍNH xacThucYeuCauAgent", () => {
  const vec = docHmacVectors();
  const tenEndpoint: Record<string, TenEndpoint> = { "/api/ai-lead-agent/v1/catalog": "catalog", "/api/ai-lead-agent/v1/heartbeats": "heartbeats", "/api/ai-lead-agent/v1/lead-intakes": "leadIntakes" };
  it.each(["V1", "V2", "V3"])("%s: chữ ký của hợp đồng được chấp nhận (khoá = secret của vector)", async (ten) => {
    const v = vec.vectors.find((x) => x.ten === ten)!;
    const endpoint = tenEndpoint[v.path]!;
    mk.khoaGhiDe = (id) => (id === vec.agentId ? vec.agentSecret : null);
    mk.agent = { ...agentMacDinh(), id: vec.agentId };
    const req = taoYeuCauKy({ endpoint, agentId: vec.agentId, khoa: vec.agentSecret, than: v.body === "" ? undefined : v.body, ts: v.ts, nonce: v.nonce, sigGhiDe: v.sig });
    const kq = await xacThucYeuCauAgent(req, { endpoint, nowMs: Number(v.ts) });
    expect(kq.ok, "chữ ký trong vector phải được chấp nhận").toBe(true);
    expect(mk.createNonce.mock.calls[0]![0]).toMatchObject({ data: { agentId: vec.agentId, nonce: v.nonce } });
  });
  it.each([0, 1, 2, 3])("đối chứng ÂM NEG-%i bị từ chối BAD_SIGNATURE", async (i) => {
    if (i === 0) return;
    const neg = vec.negatives[i - 1]!;
    const v = vec.vectors.find((x) => x.ten === (i === 4 ? "V2" : "V1"))!;
    const endpoint = tenEndpoint[v.path]!;
    mk.khoaGhiDe = (id) => (id === vec.agentId ? vec.agentSecret : null);
    mk.agent = { ...agentMacDinh(), id: vec.agentId };
    const req = taoYeuCauKy({ endpoint, agentId: vec.agentId, khoa: vec.agentSecret, than: v.body === "" ? undefined : v.body, ts: v.ts, nonce: v.nonce, sigGhiDe: neg.sig });
    const kq = await xacThucYeuCauAgent(req, { endpoint, nowMs: Number(v.ts) });
    expect(kq.ok).toBe(false);
    if (!kq.ok) expect((await docPhanHoi(kq.res)).body).toMatchObject({ error: { code: "BAD_SIGNATURE" } });
  });
  it("thân gửi KHÁC thân đã ký (1 byte) ⇒ BAD_SIGNATURE", async () => {
    const k = hopLe("leadIntakes");
    k.req.thanDeKy = JSON.stringify(k.than) + " ";
    const r = await chay(k);
    expect(r.ok === false && r.ma).toBe("BAD_SIGNATURE");
  });
});


describe("[AIL-XT-RL] bộ đếm từ chối: bật theo ai.rejectLogEnabled; agentId CHỈ sau khi chữ ký đúng; không lọt dữ liệu nào khác", () => {
  const lanGhi = () => mk.ghiTuChoi.mock.calls.map((c) => c[0] as { batGhi: boolean; endpoint: string; ma: string; agentId: string | null; nowMs: number });

  it("[AIL-XT-RL-01] cờ TẮT (mặc định) ⇒ mọi lời ghi nhận mang batGhi=false", async () => {
    const k = hopLe("leadIntakes");
    k.req.sigGhiDe = "a".repeat(64);
    await chay(k);
    expect(lanGhi()).toHaveLength(1);
    expect(lanGhi()[0]!.batGhi).toBe(false);
  });
  it("[AIL-XT-RL-02] cờ BẬT + chữ ký SAI của agent có thật ⇒ ghi BAD_SIGNATURE với agentId = null (không bao giờ tin id kẻ gọi khai)", async () => {
    mk.cai = { ...mk.cai, rejectLogEnabled: true };
    const k = hopLe("leadIntakes");
    k.req.sigGhiDe = "a".repeat(64);
    await chay(k);
    expect(lanGhi()).toEqual([{ batGhi: true, endpoint: "leadIntakes", ma: "BAD_SIGNATURE", agentId: null, nowMs: NOW }]);
  });
  it("[AIL-XT-RL-03] cờ BẬT + agent LẠ ⇒ agentId = null (cùng dạng với chữ ký sai — không phân biệt được)", async () => {
    mk.cai = { ...mk.cai, rejectLogEnabled: true };
    mk.agent = null;
    const k = hopLe("leadIntakes");
    k.agentId = "ailtgagentkhongco0001";
    await chay(k);
    expect(lanGhi().map((g) => [g.ma, g.agentId])).toEqual([["BAD_SIGNATURE", null]]);
  });
  it("[AIL-XT-RL-04] cờ BẬT + chữ ký ĐÚNG rồi bị CLOCK_SKEW ⇒ agentId = id Agent (đã xác thực)", async () => {
    mk.cai = { ...mk.cai, rejectLogEnabled: true };
    const k = hopLe("leadIntakes");
    k.ts = NOW - 400_000;
    await chay(k);
    expect(lanGhi().map((g) => [g.ma, g.agentId])).toEqual([["CLOCK_SKEW", AGENT_ID]]);
  });
  it("[AIL-XT-RL-05] hạn mức theo IP (trước chữ ký) ⇒ agentId = null; hạn mức theo nhóm (sau chữ ký) ⇒ agentId = id", async () => {
    mk.cai = { ...mk.cai, rejectLogEnabled: true };
    mk.rateIpHong = true;
    await chay(hopLe("leadIntakes"));
    mk.rateIpHong = false;
    mk.rateNhomHong = true;
    await chay(hopLe("leadIntakes"));
    expect(lanGhi().map((g) => [g.ma, g.agentId])).toEqual([["RATE_LIMITED", null], ["RATE_LIMITED", AGENT_ID]]);
  });
  it("[AIL-XT-RL-06] lời ghi nhận mang ĐÚNG năm khoá {batGhi, endpoint, ma, agentId, nowMs} — không IP/header/thân/chữ ký", async () => {
    mk.cai = { ...mk.cai, rejectLogEnabled: true };
    const k = hopLe("leadIntakes");
    k.req.sigGhiDe = "b".repeat(64);
    await chay(k);
    for (const g of lanGhi()) expect(Object.keys(g).sort()).toEqual(["agentId", "batGhi", "endpoint", "ma", "nowMs"]);
  });
  it("[AIL-XT-RL-07] request hợp lệ KHÔNG ghi gì; cờ cổng TẮT (404) và thiếu master key (chưa đọc cài đặt) cũng không ghi", async () => {
    mk.cai = { ...mk.cai, rejectLogEnabled: true };
    await chay(hopLe("leadIntakes"));
    mk.flag = false;
    await chay(hopLe("leadIntakes"));
    mk.flag = true;
    const khongKhoa = hopLe("leadIntakes"); // dựng (ký) khi master key còn
    delete process.env.AI_LEAD_AGENT_MASTER_KEY;
    await chay(khongKhoa);
    // NOT_CONFIGURED (thiếu master key) đứng TRƯỚC khi đọc cài đặt ⇒ batGhi=false; 404 (cờ cổng tắt) không đi qua `loi` ⇒ không có lời ghi nào.
    expect(lanGhi().filter((g) => g.batGhi)).toEqual([]);
  });
});
