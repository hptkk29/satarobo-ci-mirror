/**
 * [RT-*] `GET /r/:token` (AFF-P1) — trên Response THẬT của route, lõi `xuLyBamLink` THẬT, DB giả.
 *
 *   [RT-01] cờ TẮT ⇒ 302 trang đích sạch (không aff/cmp/clk), không cookie, không ghi lượt bấm (R5)
 *   [RT-02] link hợp lệ ⇒ 302 tới đích dựng từ DB; cookie sr_aff HttpOnly · SameSite=Lax · Path=/ · Max-Age = cookieWindowDays CỦA CAMPAIGN · Secure CHỈ ở production; Cache-Control no-store
 *   [RT-03] open-redirect: `?clk=x&aff=y&redirect=https://evil.com` và Host giả KHÔNG ảnh hưởng điểm đến
 *   [RT-04] token hỏng / lạ ⇒ 302 về trang chủ theo gốc ĐÃ CẤU HÌNH (`AFFILIATE_PUBLIC_ORIGIN`), KHÔNG cookie nào, cùng một phản hồi; CHƯA cấu hình ⇒ `Location: /` tương đối (không tên miền cứng)
 *   [RT-05] link thu hồi ⇒ KHÔNG set sr_aff (đối chứng dương: link sống ⇒ có); đích sạch
 *   [RT-06] decideRoute: `/r/*` và `/api/public/affiliate/*` đi qua trên host công khai, không cần đăng nhập
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { decideRoute } from "@/lib/auth/route-policy";
import { GET, HEAD } from "./route";

const TOKEN = "K8F29XQ47M";
const CLICK_ID = "cm1abcdefghijklmnopqrstuv";

const hang = (p: Record<string, unknown> = {}) => ({
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
  campaign: { code: "TET_2027", status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: null, cookieWindowDays: 45, sites: [{ siteId: "site-1" }], landings: [] },
  site: { baseUrl: "https://quatang.edu.vn", allowedDomains: ["quatang.edu.vn"], status: "ACTIVE", trackingEnabled: true, landingPages: [{ id: "lp-1", host: null, label: null, trackingEnabled: true, pathPattern: "/khoa-hoc/*", isActive: true }] },
  ...p,
});

const goi = (token: string, qs = "", host = "satarobo.vn", headers: Record<string, string> = {}) =>
  GET(new NextRequest(`https://${host}/r/${token}${qs}`, { headers: { host, ...headers } }), { params: Promise.resolve({ token }) });

const cookies = (res: Response) => res.headers.getSetCookie();

beforeEach(() => {
  MOI.co = true;
  MOI.hang = hang();
  MOI.findUnique = vi.fn(async () => MOI.hang);
  MOI.create = vi.fn(async () => ({ id: CLICK_ID }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("[RT-01] cờ tắt", () => {
  it("KHÔNG 404: 302 tới trang đích SẠCH (không aff/cmp/clk), no-store, không cookie, KHÔNG ghi lượt bấm (R5 — khách bấm QR đã in không bị mất)", async () => {
    MOI.co = false;
    const res = await goi(TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://quatang.edu.vn/khoa-hoc/robot");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(cookies(res)).toEqual([]);
    expect(MOI.create).not.toHaveBeenCalled();
  });
  it("token lạ khi cờ tắt ⇒ trang chủ (cùng phản hồi), không ghi gì", async () => {
    MOI.co = false;
    MOI.findUnique = vi.fn(async () => null);
    const res = await goi(TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(MOI.create).not.toHaveBeenCalled();
  });
  it("đối chứng dương: cờ bật ⇒ 302 kèm aff/cmp/clk + cookie + ghi lượt bấm", async () => {
    const res = await goi(TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("aff=");
    expect(MOI.create).toHaveBeenCalledTimes(1);
  });
});

describe("[RT-02] link hợp lệ", () => {
  it("302 + Location từ DB + cookie đúng thuộc tính + no-store", async () => {
    const res = await goi(TOKEN);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://quatang.edu.vn/khoa-hoc/robot?aff=${TOKEN}&cmp=TET_2027&clk=${CLICK_ID}`);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const aff = cookies(res).find((c) => c.startsWith("sr_aff="));
    expect(aff).toBeDefined();
    expect(aff).toMatch(/HttpOnly/i);
    expect(aff).toMatch(/SameSite=lax/i);
    expect(aff).toMatch(/Path=\//);
    expect(aff).toContain(`Max-Age=${45 * 86400}`);
    expect(aff).toContain(`sr_aff=${TOKEN}.${new Date("2026-10-13T03:00:00.000Z").getTime()}`);
    expect(aff).not.toMatch(/Secure/i);
    expect(cookies(res).some((c) => c.startsWith("sr_aff_s=") && /HttpOnly/i.test(c))).toBe(true);
  });
  it("Max-Age THEO CAMPAIGN: campaign 7 ngày ⇒ 7 ngày (không phải hằng 30)", async () => {
    MOI.hang = hang({ campaign: { ...hang().campaign, cookieWindowDays: 7 } });
    const aff = cookies(await goi(TOKEN)).find((c) => c.startsWith("sr_aff="));
    expect(aff).toContain(`Max-Age=${7 * 86400}`);
  });
  it("Secure CHỈ ở production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const aff = cookies(await goi(TOKEN)).find((c) => c.startsWith("sr_aff="));
    expect(aff).toMatch(/Secure/i);
  });
});

describe("[RT-03] chống open-redirect", () => {
  it("query giả không ảnh hưởng điểm đến", async () => {
    const res = await goi(TOKEN, "?clk=x&aff=y&cmp=Z&redirect=https://evil.com&url=//evil.com");
    const loc = res.headers.get("location")!;
    expect(new URL(loc).host).toBe("quatang.edu.vn");
    expect(loc).not.toMatch(/evil|aff=y|clk=x|cmp=Z/);
    expect(new URL(loc).searchParams.get("aff")).toBe(TOKEN);
    expect(new URL(loc).searchParams.get("clk")).toBe(CLICK_ID);
  });
  it("Host / X-Forwarded-Host / Referer giả không ảnh hưởng điểm đến", async () => {
    const res = await goi(TOKEN, "", "evil.com", { "x-forwarded-host": "evil.com", referer: "https://evil.com/phish" });
    expect(new URL(res.headers.get("location")!).host).toBe("quatang.edu.vn");
  });
  it("trang chủ dự phòng KHÔNG lấy từ Host của request — chỉ từ gốc đã cấu hình của môi trường", async () => {
    vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", "https://satarobo.vn");
    const res = await goi("abc", "", "evil.com", { "x-forwarded-host": "evil.com" });
    expect(res.headers.get("location")).toBe("https://satarobo.vn/");
    // môi trường test cấu hình gốc của NÓ ⇒ trang chủ dự phòng của test, không lẫn sang prod
    vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", "https://test.satarobo.vn");
    expect((await goi("abc", "", "test.satarobo.vn")).headers.get("location")).toBe("https://test.satarobo.vn/");
  });
});

describe("[RT-04] token hỏng / lạ", () => {
  it("CHƯA cấu hình gốc ⇒ 302 `Location: /` TƯƠNG ĐỐI (không tên miền nào, kể cả khi Host giả), không cookie, không ghi click", async () => {
    vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", "");
    MOI.findUnique = vi.fn(async () => null);
    for (const host of ["satarobo.vn", "test.satarobo.vn", "evil.com"]) {
      const r = await goi("ZZZZZZZZZZ", "", host, { "x-forwarded-host": host });
      expect(r.status, host).toBe(302);
      expect(r.headers.get("location"), host).toBe("/");
      expect(cookies(r), host).toEqual([]);
    }
    expect(MOI.create).not.toHaveBeenCalled();
    // đối chứng dương: link HỢP LỆ vẫn chuyển tới website của link dù chưa cấu hình gốc (gốc chỉ là trang chủ dự phòng)
    MOI.findUnique = vi.fn(async () => MOI.hang);
    expect((await goi(TOKEN)).headers.get("location")).toContain("https://quatang.edu.vn/khoa-hoc/robot?aff=");
  });
  it("cùng một phản hồi, không cookie", async () => {
    vi.stubEnv("AFFILIATE_PUBLIC_ORIGIN", "https://satarobo.vn");
    MOI.findUnique = vi.fn(async () => null);
    const la = await goi("ZZZZZZZZZZ");
    const hong = await goi("khong-phai-token");
    for (const r of [la, hong]) {
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("https://satarobo.vn/");
      expect(r.headers.get("cache-control")).toContain("no-store");
      expect(cookies(r)).toEqual([]);
    }
    expect(MOI.create).not.toHaveBeenCalled();
  });
});

describe("[RT-05] link thu hồi", () => {
  it("KHÔNG set sr_aff; đích sạch; vẫn ghi click", async () => {
    MOI.hang = hang({ status: "REVOKED" });
    const res = await goi(TOKEN);
    expect(res.headers.get("location")).toBe("https://quatang.edu.vn/khoa-hoc/robot");
    expect(cookies(res).some((c) => c.startsWith("sr_aff="))).toBe(false);
    expect(MOI.create).toHaveBeenCalledTimes(1);
    expect((MOI.create as ReturnType<typeof vi.fn>).mock.calls[0]![0].data.outcome).toBe("LINK_DA_THU_HOI");
  });
});

describe("[RT-06] route-policy cho phép đường công khai", () => {
  it.each(["public", "unknown"] as const)("host %s: /r/<token> và /api/public/affiliate/v1/click, ẩn danh ⇒ next", (hostKind) => {
    for (const pathname of [`/r/${TOKEN}`, "/api/public/affiliate/v1/click"]) {
      expect(decideRoute({ hostKind, pathname, role: null, sessionValid: false })).toEqual({ type: "next" });
    }
  });
});

describe("[RT-07] HEAD / bot xem trước / công cụ KHÔNG phải lượt bấm (audit XI · R7)", () => {
  const UA_NGUOI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1";
  const UA_ZALO_TRONG_APP = "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Zalo/24.05.1";
  const UA_FB_TRONG_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0;FBBV/1]";
  const bam = (ua: string | null) => goi(TOKEN, "", "satarobo.vn", ua === null ? {} : { "user-agent": ua });

  it("[RT-07a] HEAD ⇒ 302 tới trang đích SẠCH, không cookie, KHÔNG ghi lượt bấm", async () => {
    const res = await HEAD(new NextRequest(`https://satarobo.vn/r/${TOKEN}`, { method: "HEAD", headers: { host: "satarobo.vn", "user-agent": UA_NGUOI } }), { params: Promise.resolve({ token: TOKEN }) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://quatang.edu.vn/khoa-hoc/robot");
    expect(cookies(res)).toEqual([]);
    expect(MOI.create).not.toHaveBeenCalled();
  });

  it("[RT-07b] bot xem trước / crawler / công cụ dòng lệnh ⇒ cùng kết quả: đích sạch, không cookie, không lượt bấm — nhưng khách của bộ xem trước vẫn thấy đúng trang", async () => {
    for (const ua of [
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "TelegramBot (like TwitterBot)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "WhatsApp/2.23.20.0",
      "curl/8.4.0",
      "python-requests/2.31.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0 Safari/537.36",
    ]) {
      MOI.create.mockClear();
      const res = await bam(ua);
      expect(res.status, ua).toBe(302);
      expect(res.headers.get("location"), ua).toBe("https://quatang.edu.vn/khoa-hoc/robot");
      expect(cookies(res), ua).toEqual([]);
      expect(MOI.create, ua).not.toHaveBeenCalled();
    }
  });

  it("[RT-07c] ĐỐI CHỨNG DƯƠNG — NGƯỜI THẬT vẫn được đếm: trình duyệt di động, trình duyệt TRONG app Zalo, trong app Facebook, và request KHÔNG có UA (script/test) đều ghi lượt bấm + cookie", async () => {
    for (const ua of [UA_NGUOI, UA_ZALO_TRONG_APP, UA_FB_TRONG_APP, null]) {
      MOI.create.mockClear();
      const res = await bam(ua);
      expect(res.status).toBe(302);
      expect(res.headers.get("location"), String(ua)).toContain("aff=");
      expect(MOI.create, String(ua)).toHaveBeenCalledTimes(1);
      expect(cookies(res).some((c) => c.startsWith("sr_aff="))).toBe(true);
    }
  });
});
