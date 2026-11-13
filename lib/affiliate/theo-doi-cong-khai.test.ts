/**
 * [TDC-*] Lõi công khai của link giới thiệu (AFF-P1): `xuLyBamLink` (/r/:token) + `xuLyBeacon` — với DB GIẢ (không Postgres; ca chạm DB thật ở tests/hoa-hong/affiliate-link.spec.ts).
 *
 *   [TDC-01] token hỏng / lạ ⇒ về trang chủ tuyệt đối, KHÔNG ghi gì, hai trường hợp KHÔNG phân biệt được với nhau (không lộ «token không tồn tại»)
 *   [TDC-02] link hợp lệ ⇒ ghi click OK, URL đích có aff + cmp + clk (cuid), cookie = token.mốc-ms, Max-Age = cookieWindowDays CỦA CAMPAIGN
 *   [TDC-03] OPEN-REDIRECT: query ?aff=&clk=&cmp=&redirect=&url= của request KHÔNG đi vào URL đích; chỉ utm_* qua được
 *   [TDC-04] link thu hồi / campaign dừng ⇒ ghi click với mã lý do, KHÔNG cookie giới thiệu, đích SẠCH (không aff/cmp/clk); website ngừng ⇒ trang chủ
 *   [TDC-05] ghi click hỏng ⇒ vẫn tới đích, không clk; lỗi nội bộ ⇒ trang chủ; vượt tần suất ⇒ trang chủ, không chạm DB
 *   [TDC-06] sessionKey = HMAC của mã phiên (không IP/UA); cookie phiên hợp lệ được tái dùng, rác bị thay; click không mang PII
 *   [TDC-07] referrerHost chỉ là HOST
 *   [TDC-B1] beacon hợp lệ ⇒ ghi click; ACAO phản chiếu CHỈ khi origin ∈ allowedDomains (không `*`)
 *   [TDC-B2] beacon: landingUrl ngoài website / ngoài trang đích / tên miền con / chuỗi lạ ⇒ KHÔNG ghi
 *   [TDC-B3] beacon: thân hỏng / v sai / token hỏng / quá dài ⇒ không chạm DB
 *   [TDC-B4] beacon link thu hồi ⇒ ghi click với mã lý do; query/fragment của landingUrl bị cắt trước khi kiểm; utm lọc
 *   [TDC-F1] docCoTheoDoi (cờ gác CẢ HAI đường công khai): chỉ BẬT khi affiliate ∧ nguon cùng bật; đọc hỏng ⇒ TẮT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ success: true })) }));
// Cờ điều khiển được từ test (`docCoTheoDoi` chạy THẬT, chỉ hai hàm ĐỌC cờ bị thay): `hopCoAffiliate` giữ nguyên bản thật để phép AND được thử.
const CO = vi.hoisted(() => ({ affiliate: (): Promise<boolean> => Promise.resolve(true), nguon: (): Promise<boolean> => Promise.resolve(true) }));
vi.mock("@/lib/affiliate/feature", async (goc) => ({ ...(await goc<typeof import("@/lib/affiliate/feature")>()), laAffiliateBatTho: () => CO.affiliate() }));
vi.mock("@/lib/nguon/feature", () => ({ laQuanLyNguonBat: () => CO.nguon() }));

import { CLICK_ID_RE } from "./dung-url-theo-doi";
import { acaoChoOrigin, boQueryVaFragment, docCoTheoDoi, hostTuReferer, tinhSessionKey, xuLyBamLink, xuLyBeacon, type PhuThuoc } from "./theo-doi-cong-khai";

const TOKEN = "K8F29XQ47M";
const CLICK_ID = "cm1abcdefghijklmnopqrstuv";
const GOC = "https://satarobo.vn";
const NOW = new Date("2026-10-13T03:00:00.000Z");
const KHOA = "khoa-hmac-chi-dung-trong-test-32-ky-tu!";
const PHIEN_MOI = "0123456789abcdef0123456789abcdef";

type Hang = {
  id: string;
  publicToken: string;
  partyId: string;
  campaignId: string;
  membershipId: string;
  status: "ACTIVE" | "REVOKED";
  landingPath: string;
  landingHost: string | null;
  siteId: string;
  party: { status: "ACTIVE" | "SUSPENDED" };
  membership: { status: "ACTIVE"; effectiveFrom: Date; effectiveTo: Date | null };
  campaign: { code: string; status: "ACTIVE" | "PAUSED"; effectiveFrom: Date | null; effectiveTo: Date | null; cookieWindowDays: number; sites: { siteId: string }[]; landings: { landingPageId: string; landingPage: { siteId: string } }[] };
  site: { baseUrl: string; allowedDomains: string[]; status: "ACTIVE" | "INACTIVE"; trackingEnabled: boolean; landingPages: { id: string; host: string | null; label: string | null; trackingEnabled: boolean; pathPattern: string; isActive: boolean }[] };
};

const hang = (p: Partial<Hang> = {}): Hang => ({
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

function dung(asset: Hang | null, opt: { taoLoi?: boolean; docLoi?: boolean; choPhep?: boolean } = {}) {
  const clicks: Record<string, unknown>[] = [];
  const findUnique = vi.fn(async () => {
    if (opt.docLoi) throw new Error("db sập");
    return asset;
  });
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    if (opt.taoLoi) throw new Error("ghi hỏng");
    clicks.push(data);
    return { id: CLICK_ID };
  });
  const choPhepTanSuat = vi.fn(async () => opt.choPhep ?? true);
  const deps: PhuThuoc = {
    client: { affiliateTrackingAsset: { findUnique }, referralClick: { create } } as unknown as PhuThuoc["client"],
    now: () => NOW,
    goc: GOC,
    choPhepTanSuat,
    khoaHmac: () => KHOA,
    sinhMaPhien: () => PHIEN_MOI,
  };
  return { deps, clicks, findUnique, create, choPhepTanSuat };
}

const BASE = { ip: "1.2.3.4", query: {}, cookiePhien: null, referer: null } as const;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("[TDC-01] token hỏng / lạ", () => {
  it.each(["", "abc", "x".repeat(40), "K8F29XQ47", "K8F29XQ47M/../x", "../../etc/passwd"])("token hỏng %j ⇒ trang chủ, không đụng DB", async (tokenTho) => {
    const { deps, findUnique, create } = dung(hang());
    const kq = await xuLyBamLink({ ...BASE, tokenTho }, deps);
    expect(kq.diemDen).toBe(`${GOC}/`);
    expect(kq.cookieGioiThieu).toBeNull();
    expect(kq.ketCuc).toBe("KHONG_GHI");
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it("token đúng định dạng nhưng KHÔNG tồn tại ⇒ cùng phản hồi với token hỏng (không lộ), không ghi gì", async () => {
    const a = dung(null);
    const lạ = await xuLyBamLink({ ...BASE, tokenTho: "ZZZZZZZZZZ" }, a.deps);
    const hong = await xuLyBamLink({ ...BASE, tokenTho: "abc" }, dung(null).deps);
    expect(lạ).toEqual(hong);
    expect(a.create).not.toHaveBeenCalled();
  });
});

describe("[TDC-02] link hợp lệ", () => {
  it("ghi click OK; đích có aff · cmp · clk; cookie đúng; Max-Age theo campaign", async () => {
    const { deps, clicks } = dung(hang());
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN }, deps);
    expect(kq.ketCuc).toBe("OK");
    expect(kq.diemDen).toBe(`https://quatang.edu.vn/khoa-hoc/robot?aff=${TOKEN}&cmp=TET_2027&clk=${CLICK_ID}`);
    expect(CLICK_ID_RE.test(CLICK_ID)).toBe(true);
    expect(kq.clickId).toBe(CLICK_ID);
    expect(kq.cookieGioiThieu).toEqual({ giaTri: `${TOKEN}.${NOW.getTime()}`, maxAgeGiay: 45 * 86400 });
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ assetId: "asset-1", campaignId: "camp-1", partyId: "party-1", outcome: "OK" });
  });
  it("token nhập dạng gạch/chữ thường vẫn nhận ra link (chuẩn hoá) nhưng URL đích mang token CHUẨN", async () => {
    const { deps } = dung(hang());
    const kq = await xuLyBamLink({ ...BASE, tokenTho: "k8f2-9xq4-7m" }, deps);
    expect(kq.diemDen).toContain(`aff=${TOKEN}&`);
  });
});

describe("[TDC-03] chống open-redirect", () => {
  it("query của request không đi vào URL đích trừ utm_*", async () => {
    const { deps, clicks } = dung(hang());
    const kq = await xuLyBamLink(
      {
        ...BASE,
        tokenTho: TOKEN,
        query: { aff: "EVILTOKEN1", clk: "x", cmp: "HACK", redirect: "https://evil.com", url: "https://evil.com", next: "//evil.com", utm_source: "fb", utm_medium: "cpc" },
      },
      deps,
    );
    const u = new URL(kq.diemDen);
    expect(u.host).toBe("quatang.edu.vn");
    expect(u.pathname).toBe("/khoa-hoc/robot");
    expect(u.searchParams.get("aff")).toBe(TOKEN);
    expect(u.searchParams.get("cmp")).toBe("TET_2027");
    expect(u.searchParams.get("clk")).toBe(CLICK_ID);
    expect(u.searchParams.get("utm_source")).toBe("fb");
    expect(u.searchParams.get("utm_medium")).toBe("cpc");
    expect([...u.searchParams.keys()].sort()).toEqual(["aff", "clk", "cmp", "utm_medium", "utm_source"]);
    expect(kq.diemDen).not.toMatch(/evil|EVILTOKEN1|HACK/i);
    expect(clicks[0]!.utm).toEqual({ utm_source: "fb", utm_medium: "cpc" });
  });
  it("Referer / Host tuỳ ý không đổi điểm đến", async () => {
    const { deps } = dung(hang());
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN, referer: "https://evil.com/login" }, deps);
    expect(new URL(kq.diemDen).host).toBe("quatang.edu.vn");
  });
  it("dữ liệu DB trỏ host ngoài danh sách (baseUrl bị đổi) ⇒ KHÔNG chuyển tới host đó", async () => {
    const { deps } = dung(hang({ site: { ...hang().site, baseUrl: "https://evil.com" } }));
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN }, deps);
    expect(kq.diemDen).toBe(`${GOC}/`);
    expect(kq.cookieGioiThieu).toBeNull();
  });
});

describe("[TDC-04] link không hợp lệ", () => {
  it("link THU HỒI: ghi click LINK_DA_THU_HOI, KHÔNG cookie giới thiệu, đích sạch", async () => {
    const { deps, clicks } = dung(hang({ status: "REVOKED" }));
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN, query: { utm_source: "fb" } }, deps);
    expect(kq.ketCuc).toBe("KHONG_HOP_LE");
    expect(kq.cookieGioiThieu).toBeNull();
    expect(kq.diemDen).toBe("https://quatang.edu.vn/khoa-hoc/robot");
    expect(kq.diemDen).not.toMatch(/aff=|cmp=|clk=|utm_/);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.outcome).toBe("LINK_DA_THU_HOI");
    expect(kq.cookiePhien).not.toBeNull();
  });
  it("campaign tạm dừng ⇒ outcome CAMPAIGN_KHONG_HOAT_DONG", async () => {
    const { deps, clicks } = dung(hang({ campaign: { ...hang().campaign, status: "PAUSED" } }));
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN }, deps);
    expect(kq.cookieGioiThieu).toBeNull();
    expect(clicks[0]!.outcome).toBe("CAMPAIGN_KHONG_HOAT_DONG");
  });
  it("website bị gỡ khỏi campaign ⇒ outcome SITE_KHONG_GAN_CAMPAIGN", async () => {
    const { deps, clicks } = dung(hang({ campaign: { ...hang().campaign, sites: [] } }));
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN }, deps);
    expect(kq.cookieGioiThieu).toBeNull();
    expect(clicks[0]!.outcome).toBe("SITE_KHONG_GAN_CAMPAIGN");
  });
  it("website ngừng ⇒ không có đích sạch ⇒ trang chủ công khai; vẫn ghi click", async () => {
    const { deps, clicks } = dung(hang({ site: { ...hang().site, status: "INACTIVE" } }));
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN }, deps);
    expect(kq.diemDen).toBe(`${GOC}/`);
    expect(clicks[0]!.outcome).toBe("WEBSITE_KHONG_HOAT_DONG");
  });
  it("đối chứng dương: cùng dữ liệu mà link ACTIVE ⇒ có cookie giới thiệu", async () => {
    const { deps } = dung(hang());
    expect((await xuLyBamLink({ ...BASE, tokenTho: TOKEN }, deps)).cookieGioiThieu).not.toBeNull();
  });
});

describe("[TDC-05] lỗi & giới hạn", () => {
  it("ghi click hỏng ⇒ vẫn chuyển tới đích, không clk", async () => {
    const { deps } = dung(hang(), { taoLoi: true });
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN }, deps);
    expect(kq.diemDen).toBe(`https://quatang.edu.vn/khoa-hoc/robot?aff=${TOKEN}&cmp=TET_2027`);
    expect(kq.clickId).toBeNull();
  });
  it("DB sập lúc tra link ⇒ trang chủ công khai, không ném", async () => {
    const { deps } = dung(hang(), { docLoi: true });
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN }, deps);
    expect(kq.diemDen).toBe(`${GOC}/`);
    expect(kq.ketCuc).toBe("LOI_NOI_BO");
  });
  it("vượt tần suất ⇒ trang chủ, không chạm DB; khoá giới hạn theo IP", async () => {
    const { deps, findUnique, choPhepTanSuat } = dung(hang(), { choPhep: false });
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN }, deps);
    expect(kq.diemDen).toBe(`${GOC}/`);
    expect(findUnique).not.toHaveBeenCalled();
    expect(choPhepTanSuat).toHaveBeenCalledWith("aff-r:1.2.3.4", expect.objectContaining({ max: expect.any(Number) }));
  });
});

describe("[TDC-06] sessionKey & PII", () => {
  it("sessionKey = HMAC của mã phiên; cookie phiên hợp lệ được tái dùng", async () => {
    const cu = "fedcba9876543210fedcba9876543210";
    const { deps, clicks } = dung(hang());
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN, cookiePhien: cu }, deps);
    expect(clicks[0]!.sessionKey).toBe(tinhSessionKey(KHOA, cu));
    expect(String(clicks[0]!.sessionKey)).toMatch(/^[0-9a-f]{32}$/);
    expect(kq.cookiePhien?.giaTri).toBe(cu);
  });
  it("cookie phiên rác bị thay bằng mã mới", async () => {
    const { deps, clicks } = dung(hang());
    const kq = await xuLyBamLink({ ...BASE, tokenTho: TOKEN, cookiePhien: "<script>" }, deps);
    expect(kq.cookiePhien?.giaTri).toBe(PHIEN_MOI);
    expect(clicks[0]!.sessionKey).toBe(tinhSessionKey(KHOA, PHIEN_MOI));
  });
  it("sessionKey không phụ thuộc IP: hai IP, cùng phiên ⇒ cùng khoá; khoá HMAC khác ⇒ khác", async () => {
    const a = dung(hang());
    const b = dung(hang());
    await xuLyBamLink({ ...BASE, ip: "1.1.1.1", tokenTho: TOKEN, cookiePhien: PHIEN_MOI }, a.deps);
    await xuLyBamLink({ ...BASE, ip: "9.9.9.9", tokenTho: TOKEN, cookiePhien: PHIEN_MOI }, b.deps);
    expect(a.clicks[0]!.sessionKey).toBe(b.clicks[0]!.sessionKey);
    expect(tinhSessionKey("khoa-khac-khoa-khac-khoa-khac-32!!", PHIEN_MOI)).not.toBe(tinhSessionKey(KHOA, PHIEN_MOI));
  });
  it("bản ghi click chỉ mang các cột cho phép — không IP, UA, SĐT, email", async () => {
    const { deps, clicks } = dung(hang());
    await xuLyBamLink({ ...BASE, tokenTho: TOKEN, query: { utm_source: "fb", phone: "0905123456", email: "a@b.vn" }, referer: "https://facebook.com/x?phone=0905123456" }, deps);
    expect(Object.keys(clicks[0]!).sort()).toEqual(["assetId", "campaignId", "outcome", "partyId", "referrerHost", "sessionKey", "utm"]);
    expect(JSON.stringify(clicks[0])).not.toMatch(/0905|@b\.vn|1\.2\.3\.4/);
  });
});

describe("[TDC-07] referrerHost", () => {
  it("chỉ lấy HOST", () => {
    expect(hostTuReferer("https://Facebook.com/groups/x?phone=0905#a")).toBe("facebook.com");
    expect(hostTuReferer("http://l.facebook.com/l.php")).toBe("l.facebook.com");
  });
  it("rác / thiếu / scheme lạ / IP ⇒ null", () => {
    for (const x of [null, undefined, "", "javascript:alert(1)", "not a url", "https://localhost/x", "https://127.0.0.1/x", "ftp://a.vn/x", `https://${"a".repeat(300)}.vn/`]) expect(hostTuReferer(x)).toBeNull();
  });
});

// ── Beacon ──────────────────────────────────────────────────────────────────────────────────────────────────────

const than = (p: Record<string, unknown> = {}) => JSON.stringify({ v: 1, token: TOKEN, landingUrl: "https://quatang.edu.vn/khoa-hoc/robot", ...p });
const BB = { ip: "1.2.3.4", origin: "https://quatang.edu.vn", cookiePhien: null } as const;

describe("[TDC-B1] beacon hợp lệ + CORS", () => {
  it("ghi click OK và phản chiếu ACAO đúng origin của website", async () => {
    const { deps, clicks } = dung(hang());
    const kq = await xuLyBeacon({ ...BB, thanTho: than() }, deps);
    expect(kq).toEqual({ acao: "https://quatang.edu.vn", ketCuc: "OK" });
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ assetId: "asset-1", outcome: "OK", referrerHost: "quatang.edu.vn" });
  });
  it("origin LẠ ⇒ ACAO null (không `*`), nhưng click vẫn được ghi — origin chỉ là tín hiệu phụ", async () => {
    const { deps, clicks } = dung(hang());
    const kq = await xuLyBeacon({ ...BB, origin: "https://evil.com", thanTho: than() }, deps);
    expect(kq.acao).toBeNull();
    expect(clicks).toHaveLength(1);
  });
  it("không có Origin ⇒ ACAO null", async () => {
    const { deps } = dung(hang());
    expect((await xuLyBeacon({ ...BB, origin: null, thanTho: than() }, deps)).acao).toBeNull();
  });
  it.each([
    ["*", null],
    ["null", null],
    ["http://quatang.edu.vn", null],
    ["https://quatang.edu.vn:8443", null],
    ["https://quatang.edu.vn/path", null],
    ["https://www.quatang.edu.vn", null],
    ["https://quatang.edu.vn.evil.com", null],
    ["https://quatang.edu.vn", "https://quatang.edu.vn"],
    ["https://QUATANG.edu.vn", "https://quatang.edu.vn"],
  ])("acaoChoOrigin(%j)", (origin, mong) => {
    expect(acaoChoOrigin(origin, ["quatang.edu.vn"])).toBe(mong);
  });
});

describe("[TDC-B2] URL ngoài website", () => {
  it.each([
    ["https://evil.com/khoa-hoc/robot"],
    ["https://www.quatang.edu.vn/khoa-hoc/robot"],
    ["https://quatang.edu.vn/admin"],
    ["https://quatang.edu.vn/khoa-hoc/../admin"],
    ["http://quatang.edu.vn/khoa-hoc/robot"],
    ["https://quatang.edu.vn@evil.com/khoa-hoc/robot"],
    ["javascript:alert(1)"],
    ["//evil.com"],
  ])("%s ⇒ không ghi click", async (landingUrl) => {
    const { deps, create } = dung(hang());
    const kq = await xuLyBeacon({ ...BB, thanTho: than({ landingUrl }) }, deps);
    expect(kq.ketCuc).toBe("KHONG_GHI");
    expect(create).not.toHaveBeenCalled();
  });
  it("đối chứng dương: URL đúng website + trang đích ⇒ ghi", async () => {
    const { deps, create } = dung(hang());
    await xuLyBeacon({ ...BB, thanTho: than({ landingUrl: "https://quatang.edu.vn/khoa-hoc/robot-nang-cao" }) }, deps);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("[TDC-B3] thân hỏng", () => {
  it.each([
    ["không phải JSON", "xin chào"],
    ["v sai", JSON.stringify({ v: 2, token: TOKEN, landingUrl: "https://quatang.edu.vn/khoa-hoc/robot" })],
    ["thiếu v", JSON.stringify({ token: TOKEN, landingUrl: "https://quatang.edu.vn/khoa-hoc/robot" })],
    ["token hỏng", than({ token: "abc" })],
    ["token là số", than({ token: 123 })],
    ["landingUrl thiếu", JSON.stringify({ v: 1, token: TOKEN })],
    ["mảng", "[]"],
    ["rỗng", ""],
    ["quá dài", than({ utm: { utm_source: "x".repeat(5000) } })],
  ])("%s ⇒ không chạm DB", async (_t, thanTho) => {
    const { deps, findUnique, create } = dung(hang());
    const kq = await xuLyBeacon({ ...BB, thanTho }, deps);
    expect(kq.ketCuc).toBe("KHONG_GHI");
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it("token lạ ⇒ không ghi, ACAO null", async () => {
    const { deps, create } = dung(null);
    const kq = await xuLyBeacon({ ...BB, thanTho: than() }, deps);
    expect(kq).toEqual({ acao: null, ketCuc: "KHONG_GHI" });
    expect(create).not.toHaveBeenCalled();
  });
  it("vượt tần suất ⇒ không chạm DB", async () => {
    const { deps, findUnique } = dung(hang(), { choPhep: false });
    expect((await xuLyBeacon({ ...BB, thanTho: than() }, deps)).ketCuc).toBe("KHONG_GHI");
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("DB sập ⇒ không ném", async () => {
    const { deps } = dung(hang(), { docLoi: true });
    await expect(xuLyBeacon({ ...BB, thanTho: than() }, deps)).resolves.toMatchObject({ ketCuc: "KHONG_GHI" });
  });
});

describe("[TDC-B4] beacon: link thu hồi, query, utm", () => {
  it("link thu hồi ⇒ ghi click LINK_DA_THU_HOI, ketCuc KHONG_HOP_LE", async () => {
    const { deps, clicks } = dung(hang({ status: "REVOKED" }));
    const kq = await xuLyBeacon({ ...BB, thanTho: than() }, deps);
    expect(kq.ketCuc).toBe("KHONG_HOP_LE");
    expect(clicks[0]!.outcome).toBe("LINK_DA_THU_HOI");
  });
  it("query + fragment của landingUrl bị cắt trước khi kiểm (chỉ host + đường dẫn được xét)", async () => {
    const { deps, create } = dung(hang());
    await xuLyBeacon({ ...BB, thanTho: than({ landingUrl: "https://quatang.edu.vn/khoa-hoc/robot?aff=X&next=https://evil.com#frag" }) }, deps);
    expect(create).toHaveBeenCalledTimes(1);
    expect(boQueryVaFragment("https://a.vn/x?y#z")).toBe("https://a.vn/x");
    expect(boQueryVaFragment("https://a.vn/x")).toBe("https://a.vn/x");
  });
  it("host ngoài giấu sau dấu ? vẫn bị bắt (cắt tại ? cho ra https://evil.com)", async () => {
    const { deps, create } = dung(hang());
    await xuLyBeacon({ ...BB, thanTho: than({ landingUrl: "https://evil.com?x=https://quatang.edu.vn/khoa-hoc/robot" }) }, deps);
    expect(create).not.toHaveBeenCalled();
  });
  it("utm lọc: chỉ khoá utm_*, cắt 100 ký tự", async () => {
    const { deps, clicks } = dung(hang());
    await xuLyBeacon({ ...BB, thanTho: than({ utm: { utm_source: "fb", aff: "HACK", utm_term: "x".repeat(300) } }) }, deps);
    expect(clicks[0]!.utm).toEqual({ utm_source: "fb", utm_term: "x".repeat(100) });
  });
});

// ── Cờ gác đường công khai ──────────────────────────────────────────────────────────────────────────────────────

describe("[TDC-F1] docCoTheoDoi", () => {
  const dat = (a: () => Promise<boolean>, n: () => Promise<boolean>) => {
    CO.affiliate = a;
    CO.nguon = n;
  };
  const batHet = () => dat(async () => true, async () => true);
  afterEach(batHet);

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])("affiliate=%s ∧ nguon=%s ⇒ %s", async (a, n, mong) => {
    dat(async () => a, async () => n);
    expect(await docCoTheoDoi()).toBe(mong);
  });
  it("đọc cờ affiliate HỎNG ⇒ TẮT (không ném, không mặc định bật)", async () => {
    dat(() => Promise.reject(new Error("db sập")), async () => true);
    expect(await docCoTheoDoi()).toBe(false);
  });
  it("đọc cờ nguon HỎNG ⇒ TẮT", async () => {
    dat(async () => true, () => Promise.reject(new Error("db sập")));
    expect(await docCoTheoDoi()).toBe(false);
  });
  it("đối chứng dương: cả hai đọc lại được ⇒ BẬT", async () => {
    batHet();
    expect(await docCoTheoDoi()).toBe(true);
  });
});
