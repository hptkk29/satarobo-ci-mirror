// @vitest-environment node
/**
 * AI LEAD GATEWAY — PROVIDER CONTRACT QUA HTTP THẬT (L1 phía Admin), chỉ chạy khi `AI_LEAD_HTTP_BASE` trỏ một `next` đang chạy (scripts/ai-lead/chay-contract-http.mjs).
 *
 * Vì sao có tệp này: `provider-contract.spec.ts` gọi thẳng route handler trong tiến trình — nó KHÔNG chứng minh được: matcher của `proxy.ts`, byte thân THẬT đi vào HMAC, header thật,
 * XFF qua proxy, 304 trên dây, HEAD/PUT/405, Host của ba host (admin · giaovien · public). Các ca dưới đây chạy trên dây và KÝ BẰNG BỘ KÝ ĐỘC LẬP (node:crypto, đặc tả ở
 * authentication-guide.md) — không import `ky.ts`, vì bộ ký chung tự khớp với chính nó: lỗi ở ky.ts sẽ làm cả hai phía cùng sai và test vẫn xanh.
 *
 * Mã ca [AIL-HTTP-*]. SKIP khi không có `AI_LEAD_HTTP_BASE` — thấy SKIP nghĩa là CHƯA KIỂM ĐƯỢC GÌ.
 */
import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertTenDbTest, RUN_DB_TESTS } from "../_helpers/db-gate";
import { db } from "@/lib/db";
import { docFixture } from "@/lib/ai-lead/ho-tro-test";
import { AGENT_PROD, AGENT_TEST, batMoiTruong, CHAY_QUA_HTTP, don, dung, HTTP_BASE, khoaCua } from "./_nen";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 }); // 120 s: dư địa cho biên dịch nguội của `next dev` dưới tải (runner còn làm nóng trước)

const RUN = RUN_DB_TESTS && CHAY_QUA_HTTP;
if (!RUN) console.warn("[ai-lead-http] SKIP: thiếu AI_LEAD_HTTP_BASE (chạy qua `pnpm test:ai-lead-http`).");

const P = "/api/ai-lead-agent/v1";
let dem = 0;
const nonceMoi = () => `http-nonce-${String(++dem).padStart(10, "0")}-${Date.now().toString(36)}`;

/** BỘ KÝ ĐỘC LẬP — chuỗi ký = METHOD\nPATH\nTS\nNONCE\nSHA256(body) (đúng 4 dấu \n); khoá = các byte UTF-8 của chuỗi agentSecret. */
function ky(khoa: string, method: string, path: string, ts: string, nonce: string, than: Buffer): string {
  const chuoi = `${method}\n${path}\n${ts}\n${nonce}\n${createHash("sha256").update(than).digest("hex")}`;
  return createHmac("sha256", Buffer.from(khoa, "utf8")).update(Buffer.from(chuoi, "utf8")).digest("hex");
}

type Phan = { status: number; header: Record<string, string>; text: string; json: unknown };
function gui(x: { method: string; path: string; query?: string; header?: Record<string, string>; than?: Buffer }): Promise<Phan> {
  const base = new URL(HTTP_BASE);
  return new Promise((xong, loi) => {
    const header = { ...(x.than ? { "content-length": String(x.than.length) } : {}), ...(x.header ?? {}) };
    const r = httpRequest({ host: base.hostname, port: Number(base.port || 80), path: `${x.path}${x.query ?? ""}`, method: x.method, headers: header }, (res) => {
      const m: Buffer[] = [];
      res.on("data", (c: Buffer) => m.push(c));
      res.on("end", () => {
        const text = Buffer.concat(m).toString("utf8");
        const h: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h[k] = Array.isArray(v) ? v.join(", ") : v;
        let json: unknown;
        try {
          json = text === "" ? null : JSON.parse(text);
        } catch {
          json = null;
        }
        xong({ status: res.statusCode ?? 0, header: h, text, json });
      });
    });
    r.on("error", loi);
    if (x.than) r.write(x.than);
    r.end();
  });
}

type Endpoint = "catalog" | "lead-intakes" | "handoffs" | "incidents" | "heartbeats";
/** Gọi một endpoint đã ký bằng bộ ký độc lập. `than` là BYTE thật sẽ nằm trên dây (và được băm). */
function goi(x: { endpoint: Endpoint; agentId?: string; than?: Buffer; header?: Record<string, string>; query?: string; method?: string; sigGhiDe?: string }): Promise<Phan> {
  const agentId = x.agentId ?? AGENT_TEST;
  const method = x.method ?? (x.endpoint === "catalog" ? "GET" : "POST");
  const path = `${P}/${x.endpoint}`;
  const than = x.than ?? Buffer.alloc(0);
  const ts = String(Date.now());
  const nonce = nonceMoi();
  return gui({
    method,
    path,
    ...(x.query ? { query: x.query } : {}),
    ...(than.length ? { than } : {}),
    header: {
      "x-ailead-contract": "1",
      "x-ailead-agent": agentId,
      "x-ailead-ts": ts,
      "x-ailead-nonce": nonce,
      "x-ailead-sig": x.sigGhiDe ?? ky(khoaCua(agentId), method, path, ts, nonce, than),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      ...(x.header ?? {}),
    },
  });
}

/** Thân /lead-intakes dựng từ fixture 10 của gói bàn giao (đúng schema hợp đồng), đổi khoá idempotency + tên Facebook. */
const THAN_INTAKE = (hex40: string, ten: string): Buffer => {
  const goc = docFixture("10").request.body as { conversation: Record<string, unknown> };
  return Buffer.from(JSON.stringify({ ...goc, idempotencyKey: `CONSULTATION_REQUEST:${hex40}:v1`, conversation: { ...goc.conversation, fbName: ten } }), "utf8");
};
const HEX = (n: number): string => n.toString(16).padStart(40, "0");

const maLoi = (p: Phan): string | undefined => (p.json as { error?: { code?: string } } | null)?.error?.code;

describe.skipIf(!RUN)("[AIL-HTTP] provider contract qua HTTP thật", () => {
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

  it("[AIL-HTTP-01] catalog: 200 + ETag; gửi lại If-None-Match (kể cả dạng có nháy kép) ⇒ 304 không thân", async () => {
    const a = await goi({ endpoint: "catalog" });
    expect(a.status, a.text.slice(0, 200)).toBe(200);
    const etag = (a.json as { data: { etag: string } }).data.etag;
    expect(a.header["etag"]).toBe(etag);
    for (const inm of [etag, `"${etag}"`]) {
      const b = await goi({ endpoint: "catalog", header: { "if-none-match": inm } });
      expect(b.status, inm).toBe(304);
      expect(b.text).toBe("");
    }
  });

  it("[AIL-HTTP-02] chữ ký sai ⇒ 401 BAD_SIGNATURE trong khung JSON; hợp đồng khác phiên bản ⇒ không 2xx", async () => {
    const r = await goi({ endpoint: "catalog", sigGhiDe: "0".repeat(64) });
    expect(r.status).toBe(401);
    expect(maLoi(r)).toBe("BAD_SIGNATURE");
    const t = await goi({ endpoint: "catalog", header: { "x-ailead-contract": "2" } });
    expect(t.status).toBeGreaterThanOrEqual(400);
  });

  it("[AIL-HTTP-03] thân UTF-8 CÓ DẤU giữ nguyên byte: ký trên byte thật ⇒ 200; sửa MỘT byte sau khi ký ⇒ BAD_SIGNATURE", async () => {
    const than = THAN_INTAKE(HEX(0x101), "Nguyễn Thị Lan — Đà Nẵng");
    const ok = await goi({ endpoint: "lead-intakes", than });
    expect(ok.status, ok.text.slice(0, 300)).toBe(200);
    const sua = Buffer.from(than);
    sua[sua.indexOf(Buffer.from("Nguyễn"))] = "M".charCodeAt(0);
    const path = `${P}/lead-intakes`;
    const ts = String(Date.now());
    const nonce = nonceMoi();
    const r = await gui({
      method: "POST",
      path,
      than: sua,
      header: { "x-ailead-contract": "1", "x-ailead-agent": AGENT_TEST, "x-ailead-ts": ts, "x-ailead-nonce": nonce, "x-ailead-sig": ky(khoaCua(AGENT_TEST), "POST", path, ts, nonce, than), "content-type": "application/json" },
    });
    expect(r.status).toBe(401);
    expect(maLoi(r)).toBe("BAD_SIGNATURE");
  });

  it("[AIL-HTTP-04] idempotency trên dây: gửi lại ĐÚNG thân (nonce mới) ⇒ cùng phản hồi + Idempotent-Replay", async () => {
    const than = THAN_INTAKE(HEX(0x102), "Trần Văn An");
    const a = await goi({ endpoint: "lead-intakes", than });
    const b = await goi({ endpoint: "lead-intakes", than });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.header["idempotent-replay"]).toBeTruthy();
    expect((b.json as { data: { receiptId: string } }).data.receiptId).toBe((a.json as { data: { receiptId: string } }).data.receiptId);
  });

  it("[AIL-HTTP-05] phương thức: GET có thân ⇒ 400 BAD_REQUEST; PUT/DELETE ⇒ 405; HEAD không thân; query string ⇒ 400", async () => {
    const getThan = await goi({ endpoint: "catalog", than: Buffer.from("{}") });
    expect(getThan.status).toBe(400);
    expect(maLoi(getThan)).toBe("BAD_REQUEST");
    for (const method of ["PUT", "DELETE"]) expect((await goi({ endpoint: "lead-intakes", method })).status, method).toBe(405);
    // HEAD không nằm trong hợp đồng: dù kết quả là gì (405, hay 401 nếu Agent ký sai phương thức) thì KHÔNG được 5xx và KHÔNG có thân.
    const h = await goi({ endpoint: "catalog", method: "HEAD" });
    expect(h.status, `HEAD trả ${h.status}`).toBeLessThan(500);
    expect(h.text).toBe("");
    expect((await goi({ endpoint: "catalog", query: "?x=1" })).status).toBe(400);
  });

  it("[AIL-HTTP-06] Host của cả ba host (admin · giaovien · public) đều tới Gateway (đường hạ tầng /api/ai-lead-agent không bị route-policy chặn)", async () => {
    for (const host of ["admin.satarobo.vn", "giaovien.satarobo.vn", "satarobo.vn"]) {
      const r = await goi({ endpoint: "catalog", header: { host } });
      expect(r.status, host).toBe(200);
    }
  });

  it("[AIL-HTTP-07] XFF nhiều phần tử: server vẫn trả lời bình thường (hạn mức tính theo phần tử CUỐI — đã ghim ở lib/security/client-ip)", async () => {
    const r = await goi({ endpoint: "catalog", header: { "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" } });
    expect(r.status).toBe(200);
  });

  // Cổng PROD được runner MỞ sẵn (ai.prodEnabled + consentPolicyStatus trong DB nháp) để fixture 97 (agent PROD) tới được bước 13; trạng thái ĐÓNG của cổng đã có ca in-process.
  it("[AIL-HTTP-08] Agent PROD qua cổng đã mở ⇒ 200; chữ ký sai vẫn là BAD_SIGNATURE (cổng PROD đứng SAU chữ ký)", async () => {
    expect((await goi({ endpoint: "catalog", agentId: AGENT_PROD })).status).toBe(200);
    expect(maLoi(await goi({ endpoint: "catalog", agentId: AGENT_PROD, sigGhiDe: "1".repeat(64) }))).toBe("BAD_SIGNATURE");
  });

  // Chỉ chạy ở lượt server giả lập PROD (`VERCEL_ENV=production`, runner đặt AI_LEAD_HTTP_SERVER_PROD=1). Hai lượt loại trừ nhau vì hành vi của cùng một Agent TEST đổi theo MÔI TRƯỜNG MÁY CHỦ.
  it.skipIf(process.env.AI_LEAD_HTTP_SERVER_PROD !== "1")("[AIL-HTTP-FIX03] máy chủ PROD: Agent TEST (khoá ĐÚNG) ⇒ 401 AGENT_DISABLED trên cả năm endpoint; Agent PROD vẫn phục vụ", async () => {
    for (const endpoint of ["catalog", "lead-intakes", "handoffs", "incidents", "heartbeats"] as const) {
      const r = await goi({ endpoint, ...(endpoint === "catalog" ? {} : { than: Buffer.from("{}") }) });
      expect([r.status, maLoi(r)], endpoint).toEqual([401, "AGENT_DISABLED"]);
    }
    expect((await goi({ endpoint: "catalog", agentId: AGENT_PROD })).status).toBe(200);
  });

  it("[AIL-HTTP-A12] ký như Agent gọi các đường NGOÀI /api/ai-lead-agent/v1/: không đường nào trả 2xx (trừ health công khai), không lộ dữ liệu nội bộ của cổng", async () => {
    const duong = [
      "/api/ai-lead-agent",
      "/api/ai-lead-agent/v1",
      "/api/ai-lead-agent/v2/catalog",
      "/api/ai-lead-agent/v1/leads",
      "/api/ai-lead-agent/v1/drafts",
      "/api/ai-lead-agent/v1/conversations",
      "/api/ai-lead-agent/v1/crm",
      "/api/ai-lead-agent/v1/admin",
      "/api/ai-lead",
      "/api/ai-lead/leads",
      "/api/admin/leads",
      "/api/leads",
      "/api/crm/leads",
      "/api/ai-lead-agent/v1/%2e%2e/leads",
      "/ai-lead",
      "/admin/ai-lead",
      "/admin/leads",
    ];
    for (const path of duong) {
      for (const method of ["GET", "POST"]) {
        const than = method === "POST" ? Buffer.from("{}") : Buffer.alloc(0);
        const ts = String(Date.now());
        const nonce = nonceMoi();
        const r = await gui({
          method,
          path,
          ...(than.length ? { than } : {}),
          header: { "x-ailead-contract": "1", "x-ailead-agent": AGENT_TEST, "x-ailead-ts": ts, "x-ailead-nonce": nonce, "x-ailead-sig": ky(khoaCua(AGENT_TEST), method, path, ts, nonce, than), "content-type": "application/json" },
        });
        const nhan = `${method} ${path}`;
        expect(r.status >= 200 && r.status < 300, `${nhan} trả ${r.status}`).toBe(false);
        expect(r.text, nhan).not.toMatch(/agentSecret|phoneCanonical|"leads?":\s*\[/);
      }
    }
  });
});
