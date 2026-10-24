/**
 * [BT-*] `POST /api/public/affiliate/v1/click` (AFF-P1) — Response THẬT, lõi `xuLyBeacon` THẬT, DB giả.
 *
 *   [BT-01] cờ TẮT ⇒ 404 trống, không chạm DB
 *   [BT-02] LUÔN 204 không thân (hợp lệ · token lạ · URL ngoài danh sách · thân hỏng) — không lộ lý do
 *   [BT-03] CORS: ACAO phản chiếu CHỈ origin ∈ allowedDomains của website của link; không bao giờ `*`; Vary: Origin; origin lạ ⇒ không có header
 *   [BT-04] beacon chấp nhận URL ngoài danh sách? KHÔNG — không ghi click; URL đúng ⇒ ghi
 *   [BT-05] OPTIONS ⇒ 204 không ACAO (client phải gửi text/plain / sendBeacon)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const MOI = vi.hoisted(() => ({ co: true, hang: null as unknown, findUnique: null as unknown as ReturnType<typeof vi.fn>, create: null as unknown as ReturnType<typeof vi.fn> }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/affiliate/feature", () => ({ laAffiliateBatTho: async () => true, hopCoAffiliate: () => true }));
vi.mock("@/lib/nguon/feature", () => ({ laQuanLyNguonBat: async () => true }));
vi.mock("@/lib/security/signing-key", () => ({ getSigningSecret: () => "khoa-hmac-chi-dung-trong-test-32-ky-tu!" }));
vi.mock("@/lib/affiliate/theo-doi-cong-khai", async (goc) => {
  const that = await goc<typeof import("@/lib/affiliate/theo-doi-cong-khai")>();
  return {
    ...that,
    docCoTheoDoi: async () => MOI.co,
    phuThuocThat: () => ({
      ...that.phuThuocThat(),
      client: { affiliateTrackingAsset: { findUnique: MOI.findUnique }, referralClick: { create: MOI.create } },
      now: () => new Date("2026-10-13T03:00:00.000Z"),
    }),
  };
});

import { NextRequest } from "next/server";
import { OPTIONS, POST } from "./route";

const TOKEN = "K8F29XQ47M";
const hang = () => ({
  id: "asset-1",
  publicToken: TOKEN,
  partyId: "party-1",
  campaignId: "camp-1",
  membershipId: "mem-1",
  status: "ACTIVE",
  landingPath: "/khoa-hoc/robot",
  landingHost: null,
  siteId: "site-1",
  party: { status: "ACTIVE" },
  membership: { status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: null },
  campaign: { code: "TET_2027", status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: null, cookieWindowDays: 30, sites: [{ siteId: "site-1" }], landings: [] },
  site: { baseUrl: "https://quatang.edu.vn", allowedDomains: ["quatang.edu.vn"], status: "ACTIVE", trackingEnabled: true, landingPages: [{ id: "lp-1", host: null, label: null, trackingEnabled: true, pathPattern: "/khoa-hoc/*", isActive: true }] },
});

const than = (p: Record<string, unknown> = {}) => JSON.stringify({ v: 1, token: TOKEN, landingUrl: "https://quatang.edu.vn/khoa-hoc/robot", ...p });
const goi = (body: string, origin: string | null = "https://quatang.edu.vn") =>
  POST(
    new NextRequest("https://satarobo.vn/api/public/affiliate/v1/click", {
      method: "POST",
      body,
      headers: { "content-type": "text/plain;charset=UTF-8", ...(origin ? { origin } : {}) },
    }),
  );

beforeEach(() => {
  MOI.co = true;
  MOI.hang = hang();
  MOI.findUnique = vi.fn(async () => MOI.hang);
  MOI.create = vi.fn(async () => ({ id: "cm1abcdefghijklmnopqrstuv" }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("[BT-01] cờ tắt", () => {
  it("404 trống, không chạm DB; đối chứng dương: bật ⇒ 204", async () => {
    MOI.co = false;
    const res = await goi(than());
    expect(res.status).toBe(404);
    expect(MOI.findUnique).not.toHaveBeenCalled();
    MOI.co = true;
    expect((await goi(than())).status).toBe(204);
  });
});

describe("[BT-02] luôn 204, không lộ lý do", () => {
  it.each([
    ["hợp lệ", than()],
    ["token hỏng", than({ token: "abc" })],
    ["URL ngoài danh sách", than({ landingUrl: "https://evil.com/x" })],
    ["thân hỏng", "xin chào"],
    ["thân rỗng", ""],
  ])("%s ⇒ 204 không thân", async (_t, body) => {
    const res = await goi(body);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
  it("token lạ ⇒ 204 y như token đúng", async () => {
    MOI.findUnique = vi.fn(async () => null);
    const res = await goi(than());
    expect(res.status).toBe(204);
    expect(MOI.create).not.toHaveBeenCalled();
  });
});

describe("[BT-03] CORS", () => {
  it("origin ∈ allowedDomains ⇒ phản chiếu đúng origin + Vary: Origin; không `*`", async () => {
    const res = await goi(than());
    expect(res.headers.get("access-control-allow-origin")).toBe("https://quatang.edu.vn");
    expect(res.headers.get("vary")).toContain("Origin");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
  it.each(["https://evil.com", "https://www.quatang.edu.vn", "null", "*", "http://quatang.edu.vn"])("origin %s ⇒ KHÔNG có ACAO (vẫn 204 + Vary)", async (origin) => {
    const res = await goi(than(), origin);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toContain("Origin");
  });
  it("không Origin ⇒ không ACAO", async () => {
    expect((await goi(than(), null)).headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("[BT-04] URL nơi bấm", () => {
  it("URL ngoài danh sách ⇒ KHÔNG ghi; URL đúng ⇒ ghi", async () => {
    await goi(than({ landingUrl: "https://evil.com/khoa-hoc/robot" }));
    await goi(than({ landingUrl: "https://quatang.edu.vn/admin" }));
    expect(MOI.create).not.toHaveBeenCalled();
    await goi(than());
    expect(MOI.create).toHaveBeenCalledTimes(1);
  });
});

describe("[BT-05] OPTIONS", () => {
  it("204 không ACAO", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
