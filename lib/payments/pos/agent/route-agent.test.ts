// Ca [POS4-RT-02] · [POS4-RT-03] · [POS4-RT-04] — VỎ HTTP của bốn endpoint POS Agent (GĐ4). THUẦN: gọi
// HANDLER THẬT (`app/api/pos-agent/*/route.ts`) với request dựng tay và chữ ký từ test vector; tầng nghiệp
// vụ (phien / job / nhận giao dịch) + DB được giả lập — bộ này chỉ canh hợp đồng vỏ (thứ tự kiểm, mã lỗi,
// trần thân, header phản hồi). Hành vi chữ ký / nonce / active trên Postgres THẬT ở
// `tests/finance/pos-gd4.test.ts` ([POS4-AUTH-01]).
//
// Đồng hồ ĐÓNG BĂNG (luật 19): route đọc `new Date()` — ca đặt giờ hệ thống bằng `vi.setSystemTime` (chỉ
// giả `Date`, không giả bộ hẹn giờ).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";

const V = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/pos/agent-hmac-vectors.json"), "utf8")) as {
  masterKey: string;
  agentId: string;
  agentSecret: string;
};

const h = vi.hoisted(() => ({
  agentFind: vi.fn(),
  nonceCreate: vi.fn(),
  nhanHeartbeat: vi.fn(),
  nhanStatus: vi.fn(),
  chamSong: vi.fn(),
  docJob: vi.fn(),
  docNhip: vi.fn(),
  nhanGiaoDich: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    posAgent: { findUnique: h.agentFind },
    posAgentNonce: { create: h.nonceCreate },
  },
}));
vi.mock("@/lib/payments/pos/agent/phien", () => ({
  chamSong: h.chamSong,
  nhanHeartbeat: h.nhanHeartbeat,
  nhanStatus: h.nhanStatus,
}));
vi.mock("@/lib/payments/pos/agent/job", () => ({ docJobChoAgent: h.docJob }));
vi.mock("@/lib/payments/pos/agent/nhip-doc", () => ({ docNextPollMs: h.docNhip }));
vi.mock("@/lib/payments/pos/agent/nhan-giao-dich", () => ({ nhanGiaoDichAgent: h.nhanGiaoDich }));

import { createHash, createHmac } from "node:crypto";
import { POST as heartbeat } from "@/app/api/pos-agent/heartbeat/route";
import { POST as status } from "@/app/api/pos-agent/status/route";
import { GET as jobs } from "@/app/api/pos-agent/jobs/route";
import { POST as transactions } from "@/app/api/pos-agent/transactions/route";

const NOW_MS = 1_791_343_200_000; // 2026-10-07T10:20:00+07:00
let soNonce = 0;
const nonceMoi = () => `nonce${String(++soNonce).padStart(16, "0")}`;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

type Req = {
  method: "GET" | "POST";
  path: string;
  body?: string;
  headers?: Record<string, string | null>;
  ts?: string;
  nonce?: string;
  secret?: string;
  query?: string;
  stream?: boolean;
};

/** Dựng request ĐÃ KÝ đúng hợp đồng §3 (khoá = UTF-8 của chuỗi bí mật). `headers` đè/xoá từng header. */
function req(o: Req): NextRequest {
  const body = o.body ?? "";
  const byte = new TextEncoder().encode(body);
  const ts = o.ts ?? String(NOW_MS);
  const nonce = o.nonce ?? nonceMoi();
  const ck = `${o.method}\n${o.path}\n${ts}\n${nonce}\n${sha(byte)}`;
  const sig = createHmac("sha256", Buffer.from(o.secret ?? V.agentSecret, "utf8")).update(ck, "utf8").digest("hex");
  const hd: Record<string, string> = {
    "x-agent-contract": "1",
    "x-agent-id": V.agentId,
    "x-agent-ts": ts,
    "x-agent-nonce": nonce,
    "x-agent-sig": sig,
    ...(o.method === "POST" ? { "content-type": "application/json" } : {}),
  };
  for (const [k, v] of Object.entries(o.headers ?? {})) {
    if (v === null) delete hd[k];
    else hd[k] = v;
  }
  const url = `http://localhost${o.path}${o.query ?? ""}`;
  if (o.method === "GET") return new NextRequest(url, { method: "GET", headers: hd });
  if (o.stream) {
    const s = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < byte.length; i += 65_536) c.enqueue(byte.slice(i, i + 65_536));
        c.close();
      },
    });
    // `duplex` (thân dạng luồng) có ở undici nhưng chưa có trong kiểu RequestInit của Next.
    const init = { method: "POST", headers: hd, body: s, duplex: "half" };
    return new NextRequest(url, init as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
  }
  return new NextRequest(url, { method: "POST", headers: hd, body });
}

const AGENT = {
  id: V.agentId,
  centerId: "cs1",
  orgUnitId: null,
  merchantCode: "NCCPH6KE",
  secretVersion: 1,
  active: true,
  lastHeartbeatAt: new Date(NOW_MS - 30_000),
  matKetNoiTuLuc: null,
  sessionState: "READY",
  sessionExpiresAt: null,
  extensionVersion: "0.1.0",
  profileName: "CS1",
  lastSyncedAt: null,
  center: { code: "CS1", name: "Cơ sở 1" },
};

const HB = JSON.stringify({
  extensionVersion: "0.1.0",
  sessionState: "READY",
  sessionExpiresAt: "2026-10-08T08:15:00+07:00",
  lastSyncedAt: "2026-10-07T10:19:30+07:00",
  profileName: "CS1",
});

function dongTx(i: number): Record<string, unknown> {
  return {
    transaction_id: `TXN2026100700${String(i).padStart(4, "0")}`,
    transaction_type: "PAYMENT",
    transaction_detail_status: "SUCCESS",
    order_amount: 1_000,
    transaction_time: "2026/10/07 10:18:42",
    merchant_code: "NCCPH6KE",
  };
}
const lo = (rows: unknown[], them: Record<string, unknown> = {}) =>
  JSON.stringify({
    syncId: "sync-1",
    batchIndex: 0,
    final: true,
    windowFrom: "2026-10-07 08:20:00",
    windowTo: "2026-10-07 10:20:00",
    jobIds: [],
    transactions: rows,
    ...them,
  });

async function json(res: Response): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string; field?: string; requestId?: string } }> {
  return (await res.json()) as never;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_MS + 1_000));
  vi.stubEnv("POS_AGENT_MASTER_KEY", V.masterKey);
  vi.clearAllMocks();
  h.agentFind.mockResolvedValue({ ...AGENT });
  h.nonceCreate.mockResolvedValue({});
  h.chamSong.mockResolvedValue(undefined);
  h.nhanHeartbeat.mockResolvedValue({ nextPollMs: 60_000, serverTime: NOW_MS, merchantCode: "NCCPH6KE", sessionState: "READY" });
  h.nhanStatus.mockResolvedValue({ sessionState: "READY", nextPollMs: 60_000, serverTime: NOW_MS });
  h.docJob.mockResolvedValue([]);
  h.docNhip.mockResolvedValue(60_000);
  h.nhanGiaoDich.mockResolvedValue({ received: 0, unchanged: 0, created: 0, updated: 0, matched: 0, needsReview: 0, ignored: 0, rejected: [], errors: [], jobsDone: 0, nextPollMs: 60_000, serverTime: NOW_MS });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const ENDPOINT = [
  ["heartbeat", () => heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB }))],
  ["status", () => status(req({ method: "POST", path: "/api/pos-agent/status", body: JSON.stringify({ state: "SESSION_READY", reason: "USER_PRESENT", occurredAt: "2026-10-07T10:19:00+07:00" }) }))],
  ["jobs", () => jobs(req({ method: "GET", path: "/api/pos-agent/jobs" }))],
  ["transactions", () => transactions(req({ method: "POST", path: "/api/pos-agent/transactions", body: lo([]) }))],
] as const;

describe("[POS4-RT-02] thứ tự kiểm của vỏ HTTP — fail-closed, lib không được gọi khi bị chặn", () => {
  it.each(ENDPOINT)("%s: request hợp lệ ⇒ 200 (đối chứng dương)", async (_t, goi) => {
    const res = await goi();
    expect(res.status).toBe(200);
    expect((await json(res)).ok).toBe(true);
  });

  it.each(ENDPOINT)("%s: thiếu POS_AGENT_MASTER_KEY ⇒ 503 NOT_CONFIGURED, KHÔNG chạm DB", async (_t, goi) => {
    vi.stubEnv("POS_AGENT_MASTER_KEY", "");
    const res = await goi();
    expect(res.status).toBe(503);
    expect((await json(res)).error?.code).toBe("NOT_CONFIGURED");
    expect(h.agentFind).not.toHaveBeenCalled();
    expect(h.nonceCreate).not.toHaveBeenCalled();
  });

  it("master key 31 ký tự ⇒ 503 (cùng ngưỡng 32)", async () => {
    vi.stubEnv("POS_AGENT_MASTER_KEY", "x".repeat(31));
    const res = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB }));
    expect(res.status).toBe(503);
  });

  it("X-Agent-Contract: 2 ⇒ 400 UNSUPPORTED_CONTRACT; thiếu ⇒ cũng vậy", async () => {
    for (const v of ["2", null]) {
      const res = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB, headers: { "x-agent-contract": v } }));
      expect(res.status).toBe(400);
      expect((await json(res)).error?.code).toBe("UNSUPPORTED_CONTRACT");
    }
    expect(h.agentFind).not.toHaveBeenCalled();
  });

  it("header thiếu / sai định dạng ⇒ 400 BAD_REQUEST, field = tên header", async () => {
    for (const [ten, v] of [
      ["x-agent-id", null],
      ["x-agent-ts", "1791343200"],
      ["x-agent-nonce", "ngan"],
      ["x-agent-sig", "khong-phai-hex"],
    ] as const) {
      const res = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB, headers: { [ten]: v } }));
      expect(res.status, ten).toBe(400);
      const b = await json(res);
      expect(b.error?.code, ten).toBe("BAD_REQUEST");
    }
    expect(h.agentFind).not.toHaveBeenCalled();
  });

  it("có query string ⇒ 400 BAD_REQUEST (chuỗi query không được ký)", async () => {
    const res = await jobs(req({ method: "GET", path: "/api/pos-agent/jobs", query: "?x=1" }));
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("BAD_REQUEST");
  });

  it("GET khai có thân ⇒ 400 BAD_REQUEST", async () => {
    const res = await jobs(req({ method: "GET", path: "/api/pos-agent/jobs", headers: { "content-length": "5" } }));
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("BAD_REQUEST");
    expect(h.agentFind).not.toHaveBeenCalled();
  });

  it("POST text/plain ⇒ 415; application/json; charset=utf-8 ⇒ qua", async () => {
    const sai = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB, headers: { "content-type": "text/plain" } }));
    expect(sai.status).toBe(415);
    expect((await json(sai)).error?.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    const dung = await heartbeat(
      req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB, headers: { "content-type": "application/json; charset=utf-8" } }),
    );
    expect(dung.status).toBe(200);
  });

  it("heartbeat khai Content-Length 4 097 ⇒ 413 NGAY (không đọc thân, không chạm DB)", async () => {
    const res = await heartbeat(
      req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB, headers: { "content-length": "4097" } }),
    );
    expect(res.status).toBe(413);
    expect((await json(res)).error?.code).toBe("BODY_TOO_LARGE");
    expect(h.agentFind).not.toHaveBeenCalled();
  });

  it("heartbeat thân THẬT 4 097 byte (không khai độ dài) ⇒ 413; 4 096 byte ⇒ qua tầng trần (rồi 400 vì schema)", async () => {
    const quaTran = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: " ".repeat(4_097), stream: true }));
    expect(quaTran.status).toBe(413);
    const vuaTran = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: " ".repeat(4_096), stream: true }));
    expect(vuaTran.status).toBe(400);
  });

  it("transactions 524 289 byte theo luồng (không Content-Length) ⇒ 413", async () => {
    const res = await transactions(req({ method: "POST", path: "/api/pos-agent/transactions", body: "x".repeat(524_289), stream: true }));
    expect(res.status).toBe(413);
    expect((await json(res)).error?.code).toBe("BODY_TOO_LARGE");
  });

  it("agent không tồn tại / chữ ký sai ⇒ CÙNG 401 BAD_SIGNATURE, KHÔNG ghi nonce", async () => {
    h.agentFind.mockResolvedValueOnce(null);
    const khongCo = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB }));
    const saiKy = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB, secret: "f".repeat(64) }));
    for (const res of [khongCo, saiKy]) {
      expect(res.status).toBe(401);
      expect((await json(res)).error?.code).toBe("BAD_SIGNATURE");
    }
    expect(h.nonceCreate).not.toHaveBeenCalled();
    expect(h.chamSong).not.toHaveBeenCalled();
  });

  it("lệch giờ 5′+1ms ⇒ 401 CLOCK_SKEW kèm X-Server-Time; đúng 5′ ⇒ qua", async () => {
    vi.setSystemTime(new Date(NOW_MS));
    const lech = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB, ts: String(NOW_MS - 300_001) }));
    expect(lech.status).toBe(401);
    expect((await json(lech)).error?.code).toBe("CLOCK_SKEW");
    expect(lech.headers.get("x-server-time")).toBe(String(NOW_MS));
    expect(h.nonceCreate).not.toHaveBeenCalled();
    const bien = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB, ts: String(NOW_MS - 300_000) }));
    expect(bien.status).toBe(200);
  });

  it("agent tắt ⇒ 401 AGENT_DISABLED, KHÔNG ghi nonce", async () => {
    h.agentFind.mockResolvedValueOnce({ ...AGENT, active: false });
    const res = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB }));
    expect(res.status).toBe(401);
    expect((await json(res)).error?.code).toBe("AGENT_DISABLED");
    expect(h.nonceCreate).not.toHaveBeenCalled();
  });

  it("nonce lặp (P2002 ở khoá nonce) ⇒ 401 NONCE_REUSED, lib nghiệp vụ không chạy", async () => {
    h.nonceCreate.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const res = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB }));
    expect(res.status).toBe(401);
    expect((await json(res)).error?.code).toBe("NONCE_REUSED");
    expect(h.nhanHeartbeat).not.toHaveBeenCalled();
  });

  it("lỗi DB khác khi ghi nonce ⇒ 500 INTERNAL (không nuốt thành 'nonce lặp')", async () => {
    h.nonceCreate.mockRejectedValueOnce(Object.assign(new Error("connection reset"), { code: "P1001" }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB }));
    expect(res.status).toBe(500);
    expect((await json(res)).error?.code).toBe("INTERNAL");
    spy.mockRestore();
  });
});

describe("[POS4-RT-03] header phản hồi + tập export của route", () => {
  it("mọi phản hồi (thành công lẫn lỗi) có X-Server-Time + Cache-Control: no-store, KHÔNG có Access-Control-Allow-*", async () => {
    const ds: Response[] = [];
    for (const [, goi] of ENDPOINT) ds.push(await goi());
    vi.stubEnv("POS_AGENT_MASTER_KEY", "");
    ds.push(await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB })));
    vi.stubEnv("POS_AGENT_MASTER_KEY", V.masterKey);
    ds.push(await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB, secret: "0".repeat(64) })));
    for (const res of ds) {
      expect(res.headers.get("x-server-time")).toBe(String(NOW_MS + 1_000));
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect([...res.headers.keys()].filter((k) => k.startsWith("access-control-"))).toEqual([]);
    }
  });

  it("mọi lỗi mang requestId (khuôn lib/api/response.ts)", async () => {
    const res = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: HB, secret: "0".repeat(64) }));
    const b = await json(res);
    expect(b.ok).toBe(false);
    expect(b.error?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ["heartbeat", "POST"],
    ["status", "POST"],
    ["jobs", "GET"],
    ["transactions", "POST"],
  ])("app/api/pos-agent/%s/route.ts chỉ export {%s, dynamic, runtime, maxDuration}", (ten, method) => {
    const ma = readFileSync(resolve(process.cwd(), `app/api/pos-agent/${ten}/route.ts`), "utf8");
    const xuat = [
      ...[...ma.matchAll(/^export const (\w+)/gm)].map((m) => m[1]!),
      ...[...ma.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]!),
    ].sort();
    expect(xuat).toEqual([method, "dynamic", "maxDuration", "runtime"].sort());
    expect(ma).toMatch(/export const dynamic = "force-dynamic";/);
    expect(ma).toMatch(/export const runtime = "nodejs";/);
  });
});

describe("[POS4-RT-04] thân strict — khoá lạ / khoá cấm ⇒ 400, lib không chạy", () => {
  it("transactions 201 dòng ⇒ 400 TOO_MANY_ROWS", async () => {
    const res = await transactions(
      req({ method: "POST", path: "/api/pos-agent/transactions", body: lo(Array.from({ length: 201 }, (_x, i) => dongTx(i))) }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("TOO_MANY_ROWS");
    expect(h.nhanGiaoDich).not.toHaveBeenCalled();
  });

  it("200 dòng ⇒ qua (đối chứng dương)", async () => {
    const res = await transactions(
      req({ method: "POST", path: "/api/pos-agent/transactions", body: lo(Array.from({ length: 200 }, (_x, i) => dongTx(i))) }),
    );
    expect(res.status).toBe(200);
    expect(h.nhanGiaoDich).toHaveBeenCalledTimes(1);
  });

  // Chốt hợp đồng 1.1 (07/10/2026, RV5.4 #2): mã TRƯỚC — `z.string().max(n)` trong schema lô ⇒ một dòng dài là 400
  // CẢ LÔ, agent gửi lại y hệt mỗi phút ⇒ đường agent tê liệt. Nay từ chối DÒNG ở tầng nhận (`FIELD_TOO_LONG`).
  it("[POS4-HD-RT] dòng có trường VƯỢT TRẦN §6.1 (currency 17 · store_code 129 · tiền chuỗi 33 · giờ 41) ⇒ KHÔNG 400 cả lô; lô tới tầng nhận", async () => {
    const dai = { ...dongTx(1), currency: "V".repeat(17), store_code: "S".repeat(129), order_amount: "1".repeat(33), transaction_time: "T".repeat(41) };
    const res = await transactions(req({ method: "POST", path: "/api/pos-agent/transactions", body: lo([dongTx(0), dai]) }));
    expect(res.status).toBe(200);
    expect(h.nhanGiaoDich).toHaveBeenCalledTimes(1);
    const than = (h.nhanGiaoDich.mock.calls[0]![0] as { than: { transactions: unknown[] } }).than;
    expect(than.transactions).toHaveLength(2);
  });

  it("dòng có sender_card_name ⇒ 400 PAYLOAD_INVALID, field = transactions[0].sender_card_name", async () => {
    const res = await transactions(
      req({ method: "POST", path: "/api/pos-agent/transactions", body: lo([{ ...dongTx(0), sender_card_name: "NGUYEN VAN A" }]) }),
    );
    expect(res.status).toBe(400);
    const b = await json(res);
    expect(b.error?.code).toBe("PAYLOAD_INVALID");
    expect(b.error?.field).toBe("transactions[0].sender_card_name");
    expect(h.nhanGiaoDich).not.toHaveBeenCalled();
  });

  it.each(["device_id", "accessToken", "refreshToken", "deviceId", "x-api-auth"])("dòng có `%s` ⇒ 400 PAYLOAD_INVALID", async (khoa) => {
    const res = await transactions(
      req({ method: "POST", path: "/api/pos-agent/transactions", body: lo([dongTx(0), { ...dongTx(1), [khoa]: "x" }]) }),
    );
    expect(res.status).toBe(400);
    const b = await json(res);
    expect(b.error?.code).toBe("PAYLOAD_INVALID");
    expect(b.error?.field).toBe(`transactions[1].${khoa}`);
  });

  it("lô final:false mang jobIds ⇒ 400 PAYLOAD_INVALID field jobIds", async () => {
    const res = await transactions(
      req({ method: "POST", path: "/api/pos-agent/transactions", body: lo([], { final: false, jobIds: ["cm9posjob0000000000000001"] }) }),
    );
    expect(res.status).toBe(400);
    const b = await json(res);
    expect(b.error?.code).toBe("PAYLOAD_INVALID");
    expect(b.error?.field).toBe("jobIds");
  });

  it("khoá lạ trong heartbeat / status ⇒ 400 PAYLOAD_INVALID (token cũng là khoá lạ)", async () => {
    const hb = await heartbeat(
      req({ method: "POST", path: "/api/pos-agent/heartbeat", body: JSON.stringify({ ...JSON.parse(HB), accessToken: "eyJ…" }) }),
    );
    expect(hb.status).toBe(400);
    const b = await json(hb);
    expect(b.error?.code).toBe("PAYLOAD_INVALID");
    expect(b.error?.field).toBe("accessToken");
    expect(h.nhanHeartbeat).not.toHaveBeenCalled();
    const st = await status(
      req({
        method: "POST",
        path: "/api/pos-agent/status",
        body: JSON.stringify({ state: "ERROR", reason: "HEADER_NOT_CAPTURED", occurredAt: "2026-10-07T10:19:00+07:00", url: "https://x" }),
      }),
    );
    expect(st.status).toBe(400);
    expect(h.nhanStatus).not.toHaveBeenCalled();
  });

  it("thân không phải JSON / không phải UTF-8 ⇒ 400 BAD_REQUEST", async () => {
    const res = await heartbeat(req({ method: "POST", path: "/api/pos-agent/heartbeat", body: "{khong-phai-json" }));
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("BAD_REQUEST");
  });

  it("status `reason` chữ tự do ⇒ 400 PAYLOAD_INVALID field reason", async () => {
    const res = await status(
      req({ method: "POST", path: "/api/pos-agent/status", body: JSON.stringify({ state: "SESSION_EXPIRED", reason: "het phien roi", occurredAt: "2026-10-07T10:19:00+07:00" }) }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.field).toBe("reason");
  });

  it("mốc thời gian không offset ⇒ 400 PAYLOAD_INVALID", async () => {
    const res = await heartbeat(
      req({ method: "POST", path: "/api/pos-agent/heartbeat", body: JSON.stringify({ ...JSON.parse(HB), sessionExpiresAt: "2026-10-08 08:15:00" }) }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.field).toBe("sessionExpiresAt");
  });
});
