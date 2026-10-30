// tests/ai-lead/_nen.ts — NỀN dùng chung của các bộ test AI Lead Gateway trên Postgres THẬT (lát G).
//
// Dọn THEO TIỀN TỐ (không `resetDb()`): bộ này chạy chung DB với các bộ khác, nên chỉ xoá đúng thứ nó tạo (agent `ailtg…`, snapshot `publishedById = 'ailtg'`,
// cơ sở `slug ailtg-…`). Cổng `RUN_DB_TESTS` + `assertTenDbTest()` (tests/_helpers/db-gate.ts) đứng trước mọi thao tác ghi.
//
// ⚠️ Bộ này TỰ SKIP khi không có Postgres test. Thấy SKIP trong log nghĩa là CHƯA KIỂM ĐƯỢC GÌ, không phải "xanh".
import { request as httpRequest } from "node:http";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { daoKhoaAgent } from "@/lib/ai-lead/khoa";
import { docFixture } from "@/lib/ai-lead/ho-tro-test";
import { taoYeuCauKy } from "@/lib/ai-lead/ho-tro-yeu-cau-test";
import type { TenEndpoint } from "@/lib/ai-lead/hop-dong";
import * as rCatalog from "@/app/api/ai-lead-agent/v1/catalog/route";
import * as rLeadIntakes from "@/app/api/ai-lead-agent/v1/lead-intakes/route";
import * as rHandoffs from "@/app/api/ai-lead-agent/v1/handoffs/route";
import * as rIncidents from "@/app/api/ai-lead-agent/v1/incidents/route";
import * as rHeartbeats from "@/app/api/ai-lead-agent/v1/heartbeats/route";

export const MASTER = "master-key-test-ai-lead-db-0123456789abcdef-xyz";
/** Tiền tố id agent: 20–40 ký tự [a-z0-9] theo hợp đồng. KHÔNG dùng `cm9ailagenttest…` (danh tính của FIXTURE — bị chặn cứng lúc cấp khoá). */
export const TIEN_TO = "ailtg";
export const AGENT_TEST = `${TIEN_TO}agenttest000001`;
export const AGENT_PROD = `${TIEN_TO}agentprod000001`;
export const AGENT_KHAC = `${TIEN_TO}agentkhac000001`;
export const PAGE = "104500000000001";
export const PAGE_KHAC = "104500000000002";

export function batMoiTruong(): () => void {
  const cu = { m: process.env.AI_LEAD_AGENT_MASTER_KEY, f: process.env.AI_LEAD_GATEWAY_ENABLED };
  process.env.AI_LEAD_AGENT_MASTER_KEY = MASTER;
  process.env.AI_LEAD_GATEWAY_ENABLED = "true";
  return () => {
    if (cu.m === undefined) delete process.env.AI_LEAD_AGENT_MASTER_KEY;
    else process.env.AI_LEAD_AGENT_MASTER_KEY = cu.m;
    if (cu.f === undefined) delete process.env.AI_LEAD_GATEWAY_ENABLED;
    else process.env.AI_LEAD_GATEWAY_ENABLED = cu.f;
  };
}

export const khoaCua = (agentId: string, v = 1): string => daoKhoaAgent(agentId, v)!;

/** Payload catalog = đúng `pages` của fixture 01 (CS1/CS2 nhận khách, CS3 ngừng). */
export function payloadCatalogFixture(): { pages: unknown[] } {
  const f = docFixture("01");
  const data = (f.response.body as { data: { pages: unknown[] } }).data;
  return { pages: data.pages };
}

/** Xoá MỌI thứ do bộ test tạo (an toàn chạy nhiều lần). */
export async function don(): Promise<void> {
  const agents = (await db.aiLeadAgent.findMany({ where: { id: { startsWith: TIEN_TO } }, select: { id: true } })).map((a) => a.id);
  if (agents.length > 0) {
    const hoiThoai = (await db.aiLeadConversation.findMany({ where: { agentId: { in: agents } }, select: { id: true } })).map((h) => h.id);
    if (hoiThoai.length > 0) await db.aiLeadDraft.deleteMany({ where: { conversationId: { in: hoiThoai } } });
    await db.aiLeadConversation.deleteMany({ where: { agentId: { in: agents } } });
    await db.aiLeadVerificationRun.deleteMany({ where: { agentId: { in: agents } } });
    await db.aiLeadAgent.deleteMany({ where: { id: { in: agents } } }); // cascade: page · nonce · request · incident · probe
  }
  await db.aiLeadCampusPublication.deleteMany({ where: { pageId: { in: [PAGE, PAGE_KHAC] } } });
  await db.aiLeadCatalogSnapshot.deleteMany({ where: { publishedById: TIEN_TO } });
  await db.lead.deleteMany({ where: { parentName: { startsWith: "AILTG_" } } });
  await db.center.deleteMany({ where: { slug: { startsWith: "ailtg-" } } });
}

/** Chỉ xoá dữ liệu HỘI THOẠI/HỒ SƠ/idempotency/nonce/sự cố (giữ agent · Page · catalog) — dùng giữa các ca. */
export async function donHoiThoai(): Promise<void> {
  const agents = (await db.aiLeadAgent.findMany({ where: { id: { startsWith: TIEN_TO } }, select: { id: true } })).map((a) => a.id);
  if (agents.length === 0) return;
  const hoiThoai = (await db.aiLeadConversation.findMany({ where: { agentId: { in: agents } }, select: { id: true } })).map((h) => h.id);
  if (hoiThoai.length > 0) await db.aiLeadDraft.deleteMany({ where: { conversationId: { in: hoiThoai } } });
  await db.aiLeadConversation.deleteMany({ where: { agentId: { in: agents } } });
  await db.aiLeadRequest.deleteMany({ where: { agentId: { in: agents } } });
  await db.aiLeadNonce.deleteMany({ where: { agentId: { in: agents } } });
  await db.aiLeadIncident.deleteMany({ where: { agentId: { in: agents } } });
  await db.aiLeadProbe.deleteMany({ where: { agentId: { in: agents } } });
  await db.aiLeadVerificationRun.deleteMany({ where: { agentId: { in: agents } } });
  await db.lead.deleteMany({ where: { parentName: { startsWith: "AILTG_" } } });
  await db.aiLeadAgentPage.updateMany({ where: { agentId: { in: agents } }, data: { state: "ENABLED" } });
  await db.aiLeadAgent.updateMany({ where: { id: { in: agents } }, data: { active: true, contractStatus: "COMPATIBLE", secretVersion: 1 } });
}

async function layCoSo(code: string, ten: string): Promise<string> {
  const co = await db.center.findUnique({ where: { code }, select: { id: true } });
  if (co) return co.id;
  const moi = await db.center.create({ data: { code, name: ten, slug: `ailtg-${code.toLowerCase()}`, address: `Địa chỉ ${code}` }, select: { id: true } });
  return moi.id;
}

/** Dựng thế giới: 3 cơ sở (CS1/CS2/CS3), 3 xuất bản cho PAGE, snapshot v7, agent TEST (+PROD +KHAC) với allowlist. */
export async function dung(): Promise<{ coSo: Record<"CS1" | "CS2" | "CS3", string> }> {
  await don();
  const coSo = { CS1: await layCoSo("CS1", "Sata Robo CS1"), CS2: await layCoSo("CS2", "Sata Robo CS2"), CS3: await layCoSo("CS3", "Sata Robo CS3") };
  await db.aiLeadCampusPublication.createMany({
    data: [
      { pageId: PAGE, campusCenterId: coSo.CS1, acceptingLeads: true, displayOrder: 1 },
      { pageId: PAGE, campusCenterId: coSo.CS2, acceptingLeads: true, displayOrder: 2 },
      { pageId: PAGE, campusCenterId: coSo.CS3, acceptingLeads: false, displayOrder: 3 },
    ],
  });
  await db.aiLeadCatalogSnapshot.create({
    data: { version: 7, publishedById: TIEN_TO, etag: "cat-7-a1b2c3", payload: payloadCatalogFixture() as object, publishedAt: new Date("2026-10-26T02:00:00.000Z") },
  });
  for (const [id, env, pages] of [
    [AGENT_TEST, "TEST", [PAGE]],
    [AGENT_PROD, "PROD", [PAGE]],
    [AGENT_KHAC, "TEST", [PAGE_KHAC]],
  ] as const) {
    await db.aiLeadAgent.create({
      data: { id, name: `agent-${id}`, environment: env, pages: { create: pages.map((pageId) => ({ pageId })) } },
    });
  }
  return { coSo };
}

/** Có đang chạy phát lại QUA HTTP THẬT (tới một `next` đang chạy) không — `scripts/ai-lead/chay-contract-http.mjs` đặt biến này. Không đặt ⇒ gọi thẳng handler như cũ. */
export const HTTP_BASE = process.env.AI_LEAD_HTTP_BASE ?? "";
export const CHAY_QUA_HTTP = HTTP_BASE !== "";

/**
 * Gửi NGUYÊN request đã dựng (method · path · query · header · byte thân) tới server thật bằng `node:http` (không `fetch`: `fetch` cấm GET có thân, cấm ghi đè Host, và tự đổi vài header).
 * Mọi phản hồi trả về thành `Response` để các hàm so sánh dùng chung với đường handler.
 */
export async function guiQuaHttp(req: NextRequest): Promise<Response> {
  const base = new URL(HTTP_BASE);
  const url = new URL(req.url);
  const than = req.method === "GET" || req.method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await req.arrayBuffer());
  const header: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    header[k] = v;
  });
  if (than.length > 0) header["content-length"] = String(than.length);
  return await new Promise<Response>((xong, loi) => {
    const r = httpRequest({ host: base.hostname, port: Number(base.port || 80), path: `${url.pathname}${url.search}`, method: req.method, headers: header }, (res) => {
      const manh: Buffer[] = [];
      res.on("data", (c: Buffer) => manh.push(c));
      res.on("end", () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : v);
        const s = res.statusCode ?? 0;
        xong(new Response([204, 205, 304].includes(s) || req.method === "HEAD" ? null : Buffer.concat(manh), { status: s, headers: h }));
      });
    });
    r.on("error", loi);
    if (than.length > 0) r.write(than);
    r.end();
  });
}

/** Gửi một request ký thẳng vào handler của route (hoặc qua HTTP thật khi `AI_LEAD_HTTP_BASE` được đặt). */
export async function goi(
  endpoint: TenEndpoint,
  x: { than?: unknown; agentId?: string; khoa?: string; ts?: number; nonce?: string; header?: Record<string, string | null>; sigGhiDe?: string; contentType?: string | null; query?: string },
): Promise<Response> {
  const agentId = x.agentId ?? AGENT_TEST;
  const req = taoYeuCauKy({
    endpoint,
    agentId,
    khoa: x.khoa ?? khoaCua(agentId),
    than: x.than,
    ...(x.ts !== undefined ? { ts: x.ts } : {}),
    ...(x.nonce !== undefined ? { nonce: x.nonce } : {}),
    ...(x.header ? { header: x.header } : {}),
    ...(x.sigGhiDe ? { sigGhiDe: x.sigGhiDe } : {}),
    ...(x.contentType !== undefined ? { contentType: x.contentType } : {}),
    ...(x.query ? { query: x.query } : {}),
  });
  if (CHAY_QUA_HTTP) return guiQuaHttp(req);
  switch (endpoint) {
    case "catalog":
      return rCatalog.GET(req);
    case "leadIntakes":
      return rLeadIntakes.POST(req);
    case "handoffs":
      return rHandoffs.POST(req);
    case "incidents":
      return rIncidents.POST(req);
    case "heartbeats":
      return rHeartbeats.POST(req);
  }
}
