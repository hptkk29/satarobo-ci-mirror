/**
 * [DUT-*] Dựng địa chỉ link giới thiệu (AFF-P1) — THUẦN.
 *
 *   [DUT-01] dungUrlDich: đúng `?aff=&cmp=`; không clk khi link trực tiếp; clk đúng dạng cuid khi có; token chuẩn hoá ngược (chữ thường / dư gạch) bị TỪ CHỐI (chỉ nhận dạng chuẩn)
 *   [DUT-02] open-redirect: host không nằm trong tên miền được phép / website ngừng / tắt theo dõi / đường dẫn không khớp trang đích ⇒ KHÔNG có URL
 *   [DUT-03] landingPath hỏng (// , .. , %2f, thiếu /) ⇒ không có URL, kể cả khi bị gài vào dữ liệu
 *   [DUT-04] utm: chỉ 5 khoá utm_*, cắt 100 ký tự, mã hoá URL, bỏ ký tự điều khiển; khoá lạ (aff, clk, redirect, url…) bị bỏ — không thể ghi đè aff/cmp/clk
 *   [DUT-05] mã campaign / clk sai dạng ⇒ từ chối; URL dựng ra KHÔNG chứa PII hay id nội bộ (chỉ khoá aff · cmp · clk · utm_*)
 *   [DUT-06] dungUrlChuyenHuong: `<gốc>/r/<TOKEN>`; gốc không phải https-origin / token hỏng ⇒ ném
 */
import { describe, expect, it } from "vitest";
import { CLICK_ID_RE, dungUrlChuyenHuong, dungUrlDich, dungUrlTrangDich, chuanHoaUtm, type SiteDeDung } from "./dung-url-theo-doi";

const SITE: SiteDeDung = { baseUrl: "https://quatang.edu.vn", allowedDomains: ["quatang.edu.vn", "covua.quatang.edu.vn"], status: "ACTIVE", trackingEnabled: true };
const TRANG = [
  { pathPattern: "/khoa-hoc/*", isActive: true, host: "quatang.edu.vn", trackingEnabled: true },
  { pathPattern: "/", isActive: true, host: "quatang.edu.vn", trackingEnabled: true },
  { pathPattern: "/giai-dau/*", isActive: true, host: "covua.quatang.edu.vn", trackingEnabled: true },
];
const TOKEN = "K8F29XQ47M";
const CLICK = "cm1abcdefghijklmnopqrstuv"; // c + 24
const CHUNG = { site: SITE, trangDich: TRANG, landingHost: "quatang.edu.vn", landingPath: "/khoa-hoc/robot", token: TOKEN, campaignCode: "TET_2027" } as const;

describe("[DUT-01] dungUrlDich", () => {
  it("link trực tiếp: aff + cmp, KHÔNG clk", () => {
    expect(dungUrlDich(CHUNG)).toEqual({ ok: true, url: "https://quatang.edu.vn/khoa-hoc/robot?aff=K8F29XQ47M&cmp=TET_2027" });
  });
  it("từ /r: có clk đúng dạng cuid, thứ tự aff · cmp · clk", () => {
    const kq = dungUrlDich({ ...CHUNG, clickId: CLICK });
    expect(kq).toEqual({ ok: true, url: `https://quatang.edu.vn/khoa-hoc/robot?aff=K8F29XQ47M&cmp=TET_2027&clk=${CLICK}` });
    expect(CLICK_ID_RE.test(CLICK)).toBe(true);
  });
  it("clickId null / undefined = không có clk", () => {
    for (const clickId of [null, undefined]) {
      const kq = dungUrlDich({ ...CHUNG, clickId });
      expect(kq.ok && kq.url).not.toContain("clk=");
    }
  });
  it("token phải ở DẠNG CHUẨN — chữ thường / có gạch / O thay 0 bị từ chối (không sửa ngầm)", () => {
    for (const token of ["k8f29xq47m", "K8F2-9XQ4-7M", "K8F29XQ47O", "", "K8F29XQ47"]) {
      expect(dungUrlDich({ ...CHUNG, token })).toEqual({ ok: false, lyDo: "TOKEN_KHONG_HOP_LE" });
    }
  });
});

describe("[DUT-02] open-redirect: host/đường dẫn chỉ lấy từ dữ liệu ĐÃ KHAI", () => {
  it("tên miền đích ngoài danh sách tên miền được phép ⇒ HOST_KHONG_DUOC_PHEP (kể cả khi có trang đích mang đúng tên miền đó)", () => {
    expect(dungUrlDich({ ...CHUNG, landingHost: "evil.com", trangDich: [{ pathPattern: "/khoa-hoc/*", isActive: true, host: "evil.com", trackingEnabled: true }] })).toEqual({ ok: false, lyDo: "HOST_KHONG_DUOC_PHEP" });
  });
  it("tên miền con KHÔNG được coi là khớp", () => {
    expect(dungUrlDich({ ...CHUNG, landingHost: "www.quatang.edu.vn" })).toEqual({ ok: false, lyDo: "HOST_KHONG_DUOC_PHEP" });
  });
  it("[AFF-L6] một website nhiều tên miền: URL đích dựng trên TÊN MIỀN CỦA TRANG ĐÍCH, không luôn là baseUrl", () => {
    const kq = dungUrlDich({ ...CHUNG, landingHost: "covua.quatang.edu.vn", landingPath: "/giai-dau/2027" });
    expect(kq).toEqual({ ok: true, url: "https://covua.quatang.edu.vn/giai-dau/2027?aff=K8F29XQ47M&cmp=TET_2027" });
    // cùng đường dẫn nhưng tên miền không có trang đích đó ⇒ từ chối (trang đích gắn với tên miền)
    expect(dungUrlDich({ ...CHUNG, landingHost: "quatang.edu.vn", landingPath: "/giai-dau/2027" })).toEqual({ ok: false, lyDo: "KHONG_CO_TRANG_DICH" });
    expect(dungUrlDich({ ...CHUNG, landingHost: "covua.quatang.edu.vn", landingPath: "/khoa-hoc/robot" })).toEqual({ ok: false, lyDo: "KHONG_CO_TRANG_DICH" });
  });
  it("website ngừng ⇒ SITE_NGUNG; tắt theo dõi ⇒ SITE_TAT_THEO_DOI", () => {
    expect(dungUrlDich({ ...CHUNG, site: { ...SITE, status: "INACTIVE" } })).toEqual({ ok: false, lyDo: "SITE_NGUNG" });
    expect(dungUrlDich({ ...CHUNG, site: { ...SITE, trackingEnabled: false } })).toEqual({ ok: false, lyDo: "SITE_TAT_THEO_DOI" });
  });
  it("đường dẫn không khớp trang đích đang bật ⇒ KHONG_CO_TRANG_DICH; trang tắt không tính", () => {
    expect(dungUrlDich({ ...CHUNG, landingPath: "/admin" })).toEqual({ ok: false, lyDo: "KHONG_CO_TRANG_DICH" });
    expect(dungUrlDich({ ...CHUNG, trangDich: [{ pathPattern: "/khoa-hoc/*", isActive: false, host: "quatang.edu.vn", trackingEnabled: true }] })).toEqual({ ok: false, lyDo: "KHONG_CO_TRANG_DICH" });
  });
  it("[AFF-L6] trang đích tắt theo dõi RIÊNG (website vẫn bật) ⇒ không có URL", () => {
    expect(dungUrlDich({ ...CHUNG, trangDich: [{ pathPattern: "/khoa-hoc/*", isActive: true, host: "quatang.edu.vn", trackingEnabled: false }] })).toEqual({ ok: false, lyDo: "KHONG_CO_TRANG_DICH" });
  });
  it("dungUrlTrangDich: địa chỉ sạch, không aff/cmp/clk", () => {
    expect(dungUrlTrangDich(CHUNG)).toEqual({ ok: true, url: "https://quatang.edu.vn/khoa-hoc/robot" });
  });
  it("baseUrl không còn quyết địa chỉ đích: đổi baseUrl (kể cả có dấu / cuối) không đổi URL của link đã chụp tên miền", () => {
    expect(dungUrlTrangDich({ ...CHUNG, site: { ...SITE, baseUrl: "https://quatang.edu.vn/" } })).toEqual({ ok: true, url: "https://quatang.edu.vn/khoa-hoc/robot" });
    expect(dungUrlTrangDich({ ...CHUNG, site: { ...SITE, baseUrl: "https://covua.quatang.edu.vn" } })).toEqual({ ok: true, url: "https://quatang.edu.vn/khoa-hoc/robot" });
  });
});

describe("[DUT-03] landingPath hỏng không thành URL", () => {
  it.each(["//evil.com/x", "/khoa-hoc/../admin", "/khoa-hoc/%2e%2e/admin", "/khoa-hoc/a%2fb", "khoa-hoc/x", "/khoa-hoc/\tx", "/\\evil.com"])("%s", (landingPath) => {
    expect(dungUrlDich({ ...CHUNG, landingPath }).ok).toBe(false);
  });
  it("landingPath kiểu `@evil.com` ghép sau baseUrl không đổi được host", () => {
    const kq = dungUrlDich({ ...CHUNG, landingPath: "@evil.com/x" });
    expect(kq.ok).toBe(false);
  });
});

describe("[DUT-04] utm", () => {
  it("chỉ nhận 5 khoá utm_*, đúng thứ tự, mã hoá URL", () => {
    const kq = dungUrlDich({ ...CHUNG, utm: { utm_term: "a b", utm_source: "fb&x=1", utm_medium: "cpc", utm_campaign: "tet", utm_content: "v1" } });
    expect(kq.ok && kq.url).toBe(
      "https://quatang.edu.vn/khoa-hoc/robot?aff=K8F29XQ47M&cmp=TET_2027&utm_source=fb%26x%3D1&utm_medium=cpc&utm_campaign=tet&utm_content=v1&utm_term=a%20b",
    );
  });
  it("khoá lạ (aff, clk, cmp, redirect, url) bị bỏ — không ghi đè được tham số hệ thống", () => {
    const kq = dungUrlDich({ ...CHUNG, utm: { aff: "HACK", clk: "x", cmp: "Y", redirect: "https://evil.com", url: "https://evil.com", utm_source: "fb" } });
    expect(kq.ok && kq.url).toBe("https://quatang.edu.vn/khoa-hoc/robot?aff=K8F29XQ47M&cmp=TET_2027&utm_source=fb");
  });
  it("cắt 100 ký tự, bỏ ký tự điều khiển, giá trị rỗng/không phải chuỗi bị bỏ", () => {
    const u = chuanHoaUtm({ utm_source: "x".repeat(300), utm_medium: "a\r\nb", utm_campaign: "   ", utm_content: 5, utm_term: null });
    expect(u).toEqual({ utm_source: "x".repeat(100), utm_medium: "ab" });
    expect(chuanHoaUtm(null)).toEqual({});
  });
});

describe("[DUT-05] mã campaign / clk sai dạng; không PII", () => {
  it("mã campaign sai dạng ⇒ từ chối", () => {
    for (const campaignCode of ["tet 2027", "TET-2027", "T", "Tết", "TET_2027&aff=X"]) {
      expect(dungUrlDich({ ...CHUNG, campaignCode })).toEqual({ ok: false, lyDo: "MA_CAMPAIGN_KHONG_HOP_LE" });
    }
  });
  it("clk sai dạng cuid ⇒ từ chối (không nhét chuỗi lạ vào URL)", () => {
    for (const clickId of ["x", "cm1&aff=HACK", "CM1ABCDEFGHIJKLMNOPQRSTUV", "cm1abcdefghijklmnopqrstu", "https://evil.com", ""]) {
      expect(dungUrlDich({ ...CHUNG, clickId })).toEqual({ ok: false, lyDo: "CLICK_ID_KHONG_HOP_LE" });
    }
  });
  it("mọi khoá trên query của URL dựng ra thuộc {aff, cmp, clk, utm_*}", () => {
    const kq = dungUrlDich({ ...CHUNG, clickId: CLICK, utm: { utm_source: "fb", utm_term: "robot" } });
    expect(kq.ok).toBe(true);
    if (!kq.ok) return;
    const khoa = [...new URL(kq.url).searchParams.keys()];
    expect(khoa.every((k) => ["aff", "cmp", "clk", ...Object.keys({ utm_source: 1, utm_medium: 1, utm_campaign: 1, utm_content: 1, utm_term: 1 })].includes(k))).toBe(true);
    expect(kq.url).not.toMatch(/@|%40|phone|email|sdt|party|member/i);
  });
});

describe("[DUT-06] dungUrlChuyenHuong", () => {
  it("<gốc>/r/<TOKEN>", () => {
    expect(dungUrlChuyenHuong("https://satarobo.vn", TOKEN)).toBe("https://satarobo.vn/r/K8F29XQ47M");
  });
  it("gốc không phải https-origin ⇒ ném", () => {
    for (const goc of ["http://satarobo.vn", "https://satarobo.vn/", "https://satarobo.vn/x", "https://satarobo.vn:8443", "satarobo.vn", "https://localhost", "//satarobo.vn", "https://a@b.vn", ""]) {
      expect(() => dungUrlChuyenHuong(goc, TOKEN)).toThrow();
    }
  });
  it("token hỏng hoặc chưa ở dạng chuẩn ⇒ ném", () => {
    for (const t of ["", "abc", "k8f29xq47m", "K8F29XQ47M/../x", "K8F29XQ47I"]) expect(() => dungUrlChuyenHuong("https://satarobo.vn", t)).toThrow();
  });
});
