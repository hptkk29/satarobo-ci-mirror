import { describe, expect, it } from "vitest";
import { cookiePathChoGoi, laMaGoi, rangeChuyenTiep, tachDuongDanAsset, taoUrlAssetScorm, tuyChonCookieVe } from "./asset-url";

const GOI_A = "cmuz8xsix01vlh3dv9t2bz8d1";
const GOI_B = "cmuz8xsiy01vmh3dv9t2bz8d2";

describe("[SCA-U] URL asset SCORM mang MÃ GÓI", () => {
  it("[SCA-U1] cùng đường dẫn trong gói nhưng KHÁC gói ⇒ URL KHÁC (khoá cache theo gói)", () => {
    const a = taoUrlAssetScorm(GOI_A, "res/index.html", "VE");
    const b = taoUrlAssetScorm(GOI_B, "res/index.html", "VE");
    expect(a).not.toBe(b);
    expect(a).toBe(`/api/scorm/asset/${GOI_A}/res/index.html?t=VE`);
  });

  it("[SCA-U2] mã hoá từng segment (khoảng trắng, dấu), bỏ './' và đổi '\\' thành '/'", () => {
    const b = String.fromCharCode(92);
    expect(taoUrlAssetScorm(GOI_A, `./res${b}data${b}bài 1.png`, "V")).toBe(`/api/scorm/asset/${GOI_A}/res/data/${encodeURIComponent("bài 1.png")}?t=V`);
  });

  it("[SCA-U3] tách đường dẫn: kiểu mới có mã gói; kiểu cũ (vé đang bay) dùng cả đường dẫn", () => {
    expect(tachDuongDanAsset([GOI_A, "res", "index.html"])).toEqual({ maGoiTrongUrl: GOI_A, rel: ["res", "index.html"] });
    expect(tachDuongDanAsset(["res", "data", "player.js"])).toEqual({ maGoiTrongUrl: null, rel: ["res", "data", "player.js"] });
    // Thư mục đầu tình cờ đặt tên giống cuid vẫn bị hiểu là mã gói ⇒ route đòi KHỚP vé (an toàn: chỉ làm 403, không rò).
    expect(laMaGoi("res")).toBe(false);
    expect(laMaGoi(GOI_A)).toBe(true);
  });

  it("[SCA-U4] cookie vé chỉ phủ thư mục của ĐÚNG gói (mở hai bài ở hai tab không ghi đè nhau)", () => {
    expect(cookiePathChoGoi(GOI_A)).toBe(`/api/scorm/asset/${GOI_A}`);
    expect(cookiePathChoGoi(GOI_A)).not.toBe(cookiePathChoGoi(GOI_B));
  });
});

describe("[SCA-C] thuộc tính cookie vé dùng chung", () => {
  it("[SCA-C1] httpOnly + sameSite lax + path RIÊNG của gói; maxAge mặc định = TTL vé (600s), truyền được số giây còn lại", () => {
    const c = tuyChonCookieVe(GOI_A);
    expect(c).toMatchObject({ httpOnly: true, sameSite: "lax", path: `/api/scorm/asset/${GOI_A}`, maxAge: 600 });
    expect(tuyChonCookieVe(GOI_A, 90).maxAge).toBe(90);
    expect(tuyChonCookieVe(GOI_B).path).not.toBe(c.path);
  });
  it("[SCA-C2] `secure` chỉ bật ở production", () => {
    const env = process.env as Record<string, string | undefined>;
    const cu = env.NODE_ENV;
    try {
      env.NODE_ENV = "production";
      expect(tuyChonCookieVe(GOI_A).secure).toBe(true);
      env.NODE_ENV = "test";
      expect(tuyChonCookieVe(GOI_A).secure).toBe(false);
    } finally {
      env.NODE_ENV = cu;
    }
  });
});

describe("[SCA-R] Range chuyển cho R2", () => {
  it("[SCA-R1] một khoảng hợp lệ ⇒ chuyển nguyên (video xin từng khoảng)", () => {
    expect(rangeChuyenTiep("bytes=0-")).toBe("bytes=0-");
    expect(rangeChuyenTiep("bytes=100-199")).toBe("bytes=100-199");
    expect(rangeChuyenTiep("bytes=-500")).toBe("bytes=-500");
    expect(rangeChuyenTiep(" BYTES=5-9 ")).toBe("bytes=5-9");
  });

  it("[SCA-R2] không có / sai dạng / nhiều khoảng / đơn vị lạ ⇒ null (trả cả tệp, không đoán)", () => {
    expect(rangeChuyenTiep(null)).toBeNull();
    expect(rangeChuyenTiep("")).toBeNull();
    expect(rangeChuyenTiep("bytes=0-99,200-299")).toBeNull();
    expect(rangeChuyenTiep("items=0-1")).toBeNull();
    expect(rangeChuyenTiep("bytes=-")).toBeNull();
    expect(rangeChuyenTiep("bytes=abc-def")).toBeNull();
  });
});
