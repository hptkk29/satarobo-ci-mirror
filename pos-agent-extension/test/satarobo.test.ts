/**
 * Lớp gọi satarobo (`src/lib/satarobo.ts`): chốt chặn khoá cấm TRƯỚC khi ký/gửi, hình dạng
 * request đúng hợp đồng §3, thử lại đúng MỘT lần cho CLOCK_SKEW / NONCE_REUSED (§3.6–§3.7), không
 * thử lại khi BAD_SIGNATURE, phân loại lỗi mạng / hết giờ.
 */
import { describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { LoiBaoMat, goiSatarobo, type FetchSatarobo } from "../src/lib/satarobo";
import { AGENT_ID, BI_MAT, GOC_PROD, T0 } from "./ho-tro/du-lieu";

interface Goi {
  url: string;
  init: RequestInit;
}

function fetchKichBan(kichBan: Array<(g: Goi) => Response | Promise<Response>>) {
  const goi: Goi[] = [];
  const fetch: FetchSatarobo = async (url, init) => {
    const g = { url, init };
    goi.push(g);
    const f = kichBan[Math.min(goi.length - 1, kichBan.length - 1)];
    return f(g);
  };
  return { goi, fetch };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const CH = { agentId: AGENT_ID, biMat: BI_MAT, goc: GOC_PROD };
const hdr = (g: Goi) => new Headers(g.init.headers);

describe("Gọi satarobo có ký", () => {
  it("[EXT-SAT-01] thân có khoá CẤM (lồng sâu, mọi kiểu chữ) ⇒ NÉM, KHÔNG gọi mạng", async () => {
    const f = fetchKichBan([() => json(200, { ok: true, data: {} })]);
    for (const than of [
      { transactions: [{ transaction_id: "TXN1", sender_card_name: "NGUYEN VAN A" }] },
      { transactions: [{ device_id: "V9E1013322" }] },
      { accessToken: "x" },
      { a: { "X-API-Auth": "x" } },
    ]) {
      await expect(
        goiSatarobo({ fetch: f.fetch, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "POST", duongDan: "/api/pos-agent/transactions", than, timeoutMs: 1000 } }),
      ).rejects.toBeInstanceOf(LoiBaoMat);
    }
    expect(f.goi).toHaveLength(0);
  });

  it("[EXT-SAT-02] hình dạng request: đúng URL, thân là ĐÚNG chuỗi đã băm, header ký kiểm được bằng node:crypto, không cookie, không đi theo redirect", async () => {
    const f = fetchKichBan([() => json(200, { ok: true, data: { nextPollMs: 60000 } }, { "x-server-time": String(T0) })]);
    const than = { extensionVersion: "0.1.0", sessionState: "READY" };
    const kq = await goiSatarobo({
      fetch: f.fetch,
      dongHo: () => T0,
      lechGioMs: 0,
      cauHinh: CH,
      yc: { phuongThuc: "POST", duongDan: "/api/pos-agent/heartbeat", than, timeoutMs: 1000 },
    });
    expect(kq).toEqual({ ok: true, httpStatus: 200, data: { nextPollMs: 60000 }, lechGioMs: 0 });
    const g = f.goi[0];
    expect(g.url).toBe(`${GOC_PROD}/api/pos-agent/heartbeat`);
    expect(g.init.method).toBe("POST");
    expect(g.init.body).toBe(JSON.stringify(than));
    expect(g.init.credentials).toBe("omit");
    expect(g.init.redirect).toBe("error");
    const h = hdr(g);
    expect(h.get("content-type")).toBe("application/json");
    expect(h.get("x-agent-contract")).toBe("1");
    expect(h.get("x-agent-ts")).toBe(String(T0));
    const bam = createHash("sha256").update(String(g.init.body), "utf8").digest("hex");
    const sig = createHmac("sha256", BI_MAT)
      .update(`POST\n/api/pos-agent/heartbeat\n${T0}\n${h.get("x-agent-nonce")}\n${bam}`)
      .digest("hex");
    expect(h.get("x-agent-sig")).toBe(sig);
    expect(h.get("cookie")).toBeNull();
  });

  it("[EXT-SAT-03] 401 CLOCK_SKEW ⇒ ký lại với nonce MỚI + giờ máy chủ, gửi lại MỘT lần", async () => {
    const lech = 7 * 60_000;
    const f = fetchKichBan([
      () => json(401, { ok: false, error: { code: "CLOCK_SKEW" } }, { "x-server-time": String(T0 + lech) }),
      () => json(200, { ok: true, data: { jobs: [] } }, { "x-server-time": String(T0 + lech) }),
    ]);
    const kq = await goiSatarobo({ fetch: f.fetch, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } });
    expect(kq.ok).toBe(true);
    expect(kq.lechGioMs).toBe(lech);
    expect(f.goi).toHaveLength(2);
    expect(hdr(f.goi[1]).get("x-agent-ts")).toBe(String(T0 + lech));
    expect(hdr(f.goi[1]).get("x-agent-nonce")).not.toBe(hdr(f.goi[0]).get("x-agent-nonce"));
    expect(f.goi[0].init.body).toBeUndefined();
  });

  it("[EXT-SAT-04] NONCE_REUSED ⇒ thử lại MỘT lần với nonce mới; lần hai vẫn lỗi ⇒ trả lỗi, không lặp", async () => {
    const f = fetchKichBan([() => json(401, { ok: false, error: { code: "NONCE_REUSED" } })]);
    const kq = await goiSatarobo({ fetch: f.fetch, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } });
    expect(kq).toMatchObject({ ok: false, loai: "HTTP", httpStatus: 401, ma: "NONCE_REUSED" });
    expect(f.goi).toHaveLength(2);
    expect(hdr(f.goi[1]).get("x-agent-nonce")).not.toBe(hdr(f.goi[0]).get("x-agent-nonce"));
  });

  it("[EXT-SAT-05] BAD_SIGNATURE / AGENT_DISABLED ⇒ KHÔNG thử lại", async () => {
    for (const code of ["BAD_SIGNATURE", "AGENT_DISABLED"]) {
      const f = fetchKichBan([() => json(401, { ok: false, error: { code } })]);
      const kq = await goiSatarobo({ fetch: f.fetch, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } });
      expect(kq).toMatchObject({ ok: false, loai: "HTTP", ma: code });
      expect(f.goi).toHaveLength(1);
    }
  });

  it("[EXT-SAT-06] lỗi mạng ⇒ MANG/NETWORK; quá thời gian ⇒ huỷ request, MANG/TIMEOUT", async () => {
    const hong: FetchSatarobo = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(
      await goiSatarobo({ fetch: hong, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } }),
    ).toMatchObject({ ok: false, loai: "MANG", chiTiet: "NETWORK" });
    const treo: FetchSatarobo = (_url, init) =>
      new Promise((_, tuChoi) => {
        init.signal?.addEventListener("abort", () => tuChoi(new DOMException("aborted", "AbortError")));
      });
    expect(
      await goiSatarobo({ fetch: treo, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 5 } }),
    ).toMatchObject({ ok: false, loai: "MANG", chiTiet: "TIMEOUT" });
  });

  it("[EXT-SAT-07] 429 ⇒ trả Retry-After (giây); 5xx thân không phải JSON ⇒ mã HTTP_5xx", async () => {
    const f = fetchKichBan([() => json(429, { ok: false, error: { code: "RATE_LIMITED" } }, { "retry-after": "17" })]);
    expect(
      await goiSatarobo({ fetch: f.fetch, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } }),
    ).toMatchObject({ ok: false, httpStatus: 429, ma: "RATE_LIMITED", retryAfterS: 17 });
    const g = fetchKichBan([() => new Response("<html>Bad gateway</html>", { status: 502 })]);
    expect(
      await goiSatarobo({ fetch: g.fetch, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } }),
    ).toMatchObject({ ok: false, httpStatus: 502, ma: "HTTP_502" });
  });

  it("[EXT-SAT-08] lệch giờ đã biết > 60 giây ⇒ cộng vào X-Agent-Ts; ≤ 60 giây ⇒ không cộng", async () => {
    const f = fetchKichBan([() => json(200, { ok: true, data: {} })]);
    await goiSatarobo({ fetch: f.fetch, dongHo: () => T0, lechGioMs: 90_000, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } });
    await goiSatarobo({ fetch: f.fetch, dongHo: () => T0, lechGioMs: 30_000, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } });
    expect(f.goi.map((g) => hdr(g).get("x-agent-ts"))).toEqual([String(T0 + 90_000), String(T0)]);
  });

  it("[EXT-SAT-09] RV5 — 429 KHÔNG kèm Retry-After (vd từ proxy/WAF) ⇒ retryAfterS = null (để mặc định 60 giây có tác dụng), KHÔNG phải 0", async () => {
    const f = fetchKichBan([() => json(429, { ok: false, error: { code: "RATE_LIMITED" } })]);
    const kq = await goiSatarobo({ fetch: f.fetch, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } });
    expect(kq).toMatchObject({ ok: false, httpStatus: 429, retryAfterS: null });
    const g = fetchKichBan([() => json(429, { ok: false, error: { code: "RATE_LIMITED" } }, { "retry-after": "  " })]);
    const kq2 = await goiSatarobo({ fetch: g.fetch, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } });
    expect(kq2).toMatchObject({ retryAfterS: null });
    // đối chứng dương: header "0" hợp lệ vẫn đọc là 0
    const h = fetchKichBan([() => json(429, { ok: false, error: { code: "RATE_LIMITED" } }, { "retry-after": "0" })]);
    const kq3 = await goiSatarobo({ fetch: h.fetch, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "GET", duongDan: "/api/pos-agent/jobs", timeoutMs: 1000 } });
    expect(kq3).toMatchObject({ retryAfterS: 0 });
  });

  it("[EXT-SAT-10] RV5 — 400 PAYLOAD_INVALID ⇒ trả `field` của máy chủ (để nơi gọi bỏ đúng dòng hỏng thay vì gửi lại y hệt)", async () => {
    const f = fetchKichBan([() => json(400, { ok: false, error: { code: "PAYLOAD_INVALID", field: "transactions[3].currency" } })]);
    const kq = await goiSatarobo({ fetch: f.fetch, dongHo: () => T0, lechGioMs: 0, cauHinh: CH, yc: { phuongThuc: "POST", duongDan: "/api/pos-agent/transactions", than: { a: 1 }, timeoutMs: 1000 } });
    expect(kq).toMatchObject({ ok: false, httpStatus: 400, ma: "PAYLOAD_INVALID", field: "transactions[3].currency" });
  });
});
