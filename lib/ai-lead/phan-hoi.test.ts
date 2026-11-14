// lib/ai-lead/phan-hoi.test.ts — KHUNG phản hồi của cổng AI Lead: `{ok,data,meta}` / `{ok:false,error}`, requestId độ dài CỐ ĐỊNH, header bắt buộc.
// Thuần (NextResponse chạy được trong vitest node). Mã ca: [AIL-PH-01..09].
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MA_LOI, RE, type MaLoi } from "./hop-dong";
import { dauChung, phanHoi304, phanHoiCatalog, phanHoiLoi, phanHoiOk, taoReceiptId, taoRequestId } from "./phan-hoi";
import { SCHEMA_THEO_TEN } from "./schemas";
import { boChuThich, docFixture, tatCaFixture } from "./ho-tro-test";

const NOW = 1_793_000_000_000;
const ctx = { requestId: "req_0123456789abcdef01234567", nowMs: NOW };

describe("[AIL-PH-01] requestId / receiptId", () => {
  it("đúng dạng hợp đồng và ĐỘ DÀI CỐ ĐỊNH 24 sau tiền tố (qua 500 lần sinh)", () => {
    const rq = new Set<string>();
    const rc = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const a = taoRequestId();
      const b = taoReceiptId();
      expect(a).toMatch(RE.requestId);
      expect(b).toMatch(RE.receipt);
      expect(a).toHaveLength(4 + 24);
      expect(b).toHaveLength(4 + 24);
      rq.add(a);
      rc.add(b);
    }
    expect(rq.size).toBe(500);
    expect(rc.size).toBe(500);
  });
  it("KHÔNG dẫn xuất từ đầu vào: hàm không nhận tham số nào (N1 — không mã hoá SĐT/hồ sơ vào định danh)", () => {
    expect(taoRequestId.length).toBe(0);
    expect(taoReceiptId.length).toBe(0);
  });
});

describe("[AIL-PH-02] header chung", () => {
  it("X-Server-Time + Cache-Control: no-store; header thêm ghi đè được", () => {
    expect(dauChung(NOW)).toEqual({ "X-Server-Time": String(NOW), "Cache-Control": "no-store" });
    expect(dauChung(NOW, { "Idempotent-Replay": "true" })["Idempotent-Replay"]).toBe("true");
  });
});

describe("[AIL-PH-03] phanHoiOk: khung {ok,data,meta:{requestId,serverTime}}", () => {
  it("thân + header + status 200, và hợp lệ theo schema phản hồi của hợp đồng", async () => {
    const r = phanHoiOk({ receiptId: "rct_a1b2c3d4e5f6a1", status: "ACCEPTED", nextAction: "ACKNOWLEDGE_GENERIC" }, ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-server-time")).toBe(String(NOW));
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(body).toEqual({
      ok: true,
      data: { receiptId: "rct_a1b2c3d4e5f6a1", status: "ACCEPTED", nextAction: "ACKNOWLEDGE_GENERIC" },
      meta: { requestId: ctx.requestId, serverTime: NOW },
    });
    expect(SCHEMA_THEO_TEN.LeadIntakeResponse.safeParse(body).success).toBe(true);
  });
  it("Idempotent-Replay chỉ có khi truyền", async () => {
    const a = phanHoiOk({}, ctx);
    const b = phanHoiOk({}, ctx, { "Idempotent-Replay": "true" });
    expect(a.headers.get("idempotent-replay")).toBeNull();
    expect(b.headers.get("idempotent-replay")).toBe("true");
  });
});

describe("[AIL-PH-04] phanHoiLoi: cả 18 mã", () => {
  const MA = Object.keys(MA_LOI) as MaLoi[];
  it.each(MA)("%s: status, thân ErrorEnvelope hợp lệ, header", async (ma) => {
    const r = phanHoiLoi(ma, ctx);
    expect(r.status).toBe(MA_LOI[ma].status);
    const body = (await r.json()) as { ok: boolean; error: { code: string; message: string; requestId: string; field?: string } };
    expect(body.ok).toBe(false);
    expect(body.error).toEqual({ code: ma, message: MA_LOI[ma].message, requestId: ctx.requestId });
    expect(SCHEMA_THEO_TEN.ErrorEnvelope.safeParse(body).success).toBe(true);
    expect(r.headers.get("x-server-time")).toBe(String(NOW));
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("Retry-After: LUÔN có (số nguyên ≥ 1) với RATE_LIMITED / TEMP_UNAVAILABLE; KHÔNG BAO GIỜ có với 16 mã còn lại", () => {
    for (const ma of MA) {
      const ra = phanHoiLoi(ma, ctx, { retryAfterS: 12.2 }).headers.get("retry-after");
      if (ma === "RATE_LIMITED" || ma === "TEMP_UNAVAILABLE") expect(ra, ma).toBe("13");
      else expect(ra, ma).toBeNull();
    }
    expect(phanHoiLoi("RATE_LIMITED", ctx).headers.get("retry-after")).toBe("1");
    expect(phanHoiLoi("TEMP_UNAVAILABLE", ctx, { retryAfterS: 0 }).headers.get("retry-after")).toBe("1");
    expect(phanHoiLoi("RATE_LIMITED", ctx, { retryAfterS: -5 }).headers.get("retry-after")).toBe("1");
  });
  it("`field` chỉ xuất hiện khi truyền", async () => {
    const a = (await phanHoiLoi("PAYLOAD_INVALID", ctx).json()) as { error: Record<string, unknown> };
    const b = (await phanHoiLoi("PAYLOAD_INVALID", ctx, { field: "candidate.sourceId" }).json()) as { error: Record<string, unknown> };
    expect("field" in a.error).toBe(false);
    expect(b.error.field).toBe("candidate.sourceId");
  });
  it("BAD_SIGNATURE: thân GIỐNG HỆT nhau dù lý do nội bộ là 'sai chữ ký' hay 'agent không tồn tại' (không lộ agent nào có thật)", async () => {
    const a = await phanHoiLoi("BAD_SIGNATURE", ctx).text();
    const b = await phanHoiLoi("BAD_SIGNATURE", ctx).text();
    expect(a).toBe(b);
    expect(a).not.toMatch(/không tồn tại|không tìm thấy|unknown/i);
  });
});

describe("[AIL-PH-05] phản hồi lỗi khớp từng fixture 90–99 (trừ requestId)", () => {
  const loi = tatCaFixture().filter((f) => /^9\d-/.test(f.tep));
  it("có đủ 10 fixture", () => expect(loi).toHaveLength(10));
  it.each(loi.map((f) => [f.tep, f] as const))("%s", async (_t, f) => {
    const e = (f.response.body as { error: { code: MaLoi; field?: string } }).error;
    const retry = f.response.headers["Retry-After"];
    const r = phanHoiLoi(e.code, ctx, { ...(e.field ? { field: e.field } : {}), ...(retry ? { retryAfterS: Number(retry) } : {}) });
    expect(r.status).toBe(f.response.status);
    const body = (await r.json()) as { error: Record<string, unknown> };
    const mong = structuredClone(f.response.body) as { error: Record<string, unknown> };
    delete mong.error.requestId;
    delete body.error.requestId;
    expect(body).toEqual(mong);
    for (const [k, v] of Object.entries(f.response.headers)) {
      expect(r.headers.get(k.toLowerCase()), `${f.tep} header ${k}`).toBe(k === "X-Server-Time" ? String(NOW) : v);
    }
  });
});

describe("[AIL-PH-06] catalog: 200 mang ETag + Cache-Control private; 304 thân rỗng", () => {
  it("200", async () => {
    const f = docFixture("01");
    const data = (f.response.body as { data: unknown }).data;
    const r = phanHoiCatalog(data, ctx, { etag: "cat-7-a1b2c3", maxAgeSeconds: 300 });
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toBe("cat-7-a1b2c3");
    expect(r.headers.get("cache-control")).toBe("private, max-age=300");
    expect(r.headers.get("x-server-time")).toBe(String(NOW));
    expect(SCHEMA_THEO_TEN.CatalogResponse.safeParse(await r.json()).success).toBe(true);
  });
  it("304: không thân, vẫn mang X-Server-Time + Cache-Control + ETag", async () => {
    const r = phanHoi304(NOW, { etag: "cat-7-a1b2c3", maxAgeSeconds: 300 });
    expect(r.status).toBe(304);
    expect(await r.text()).toBe("");
    expect(r.headers.get("x-server-time")).toBe(String(NOW));
    expect(r.headers.get("cache-control")).toBe("private, max-age=300");
    expect(r.headers.get("etag")).toBe("cat-7-a1b2c3");
  });
});

describe("[AIL-PH-W1] lưới dây nối: dùng lib/api/response.ts, KHÔNG NextResponse.json trần (lint `no-bare-next-response` áp cho app/api/ai-lead-agent)", () => {
  it("tệp nguồn không chứa `NextResponse.json(` ngoài chú thích, và có import ok/fail", () => {
    const src = boChuThich(readFileSync(resolve(process.cwd(), "lib/ai-lead/phan-hoi.ts"), "utf8"));
    expect(src).not.toMatch(/NextResponse\s*\.\s*json\s*\(/);
    expect(src).toMatch(/from "@\/lib\/api\/response"/);
  });
});
