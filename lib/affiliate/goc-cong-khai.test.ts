// @vitest-environment node
/**
 * [GCK-*] — gốc công khai của link ngắn `/r/<token>` và QR (AFF-WEB). THUẦN: `env` là tham số, không đọc `process.env` thật.
 *
 *   [GCK-01] CHỈ đọc `AFFILIATE_PUBLIC_ORIGIN`: không lùi về `NEXT_PUBLIC_APP_URL`, không có mặc định theo `VERCEL_ENV` (chủ dự án chốt 13/10/2026)
 *   [GCK-02] chuẩn hoá: bỏ khoảng trắng + dấu / cuối, hạ chữ thường; KHÔNG sửa ngầm thứ sai (http · cổng · đường dẫn · query · tên miền đơn nhãn) ⇒ null
 *   [GCK-03] thiếu/sai ⇒ null ở MỌI môi trường, kể cả `VERCEL_ENV=production` — không bao giờ đoán sang prod
 *   [GCK-04] gốc hợp lệ luôn dựng được địa chỉ ngắn qua `dungUrlChuyenHuong` (hai bên cùng một luật hình dạng)
 */
import { describe, expect, it } from "vitest";
import { dungUrlChuyenHuong } from "./dung-url-theo-doi";
import { BIEN_GOC_CONG_KHAI, LY_DO_THIEU_GOC, chuanHoaGoc, gocCongKhai } from "./goc-cong-khai";

const TEST = "https://test.satarobo.vn";
const PROD = "https://satarobo.vn";

describe("[GCK-01] một nguồn duy nhất", () => {
  it("đọc AFFILIATE_PUBLIC_ORIGIN (đối chứng dương cho mọi ca âm bên dưới)", () => {
    expect(BIEN_GOC_CONG_KHAI).toBe("AFFILIATE_PUBLIC_ORIGIN");
    expect(gocCongKhai({ AFFILIATE_PUBLIC_ORIGIN: TEST })).toBe(TEST);
  });
  it("KHÔNG lùi về NEXT_PUBLIC_APP_URL — dù biến đó hợp lệ", () => {
    expect(gocCongKhai({ NEXT_PUBLIC_APP_URL: PROD })).toBeNull();
    expect(gocCongKhai({ AFFILIATE_PUBLIC_ORIGIN: "", NEXT_PUBLIC_APP_URL: PROD })).toBeNull();
    expect(gocCongKhai({ AFFILIATE_PUBLIC_ORIGIN: "không-phải-url", NEXT_PUBLIC_APP_URL: PROD })).toBeNull();
  });
  it("biến riêng thắng nếu có (không trộn với biến khác)", () => {
    expect(gocCongKhai({ AFFILIATE_PUBLIC_ORIGIN: TEST, NEXT_PUBLIC_APP_URL: PROD })).toBe(TEST);
  });
});

describe("[GCK-02] chuẩn hoá — không sửa ngầm", () => {
  it("bỏ khoảng trắng, dấu / cuối, hạ chữ thường", () => {
    expect(chuanHoaGoc("  HTTPS://Test.SataRobo.vn/ ")).toBe(TEST);
    expect(chuanHoaGoc("https://test.satarobo.vn///")).toBe(TEST);
  });
  it.each([
    ["http (không https)", "http://test.satarobo.vn"],
    ["có cổng", "https://test.satarobo.vn:8443"],
    ["có đường dẫn", "https://test.satarobo.vn/r"],
    ["có query", "https://test.satarobo.vn?x=1"],
    ["có fragment", "https://test.satarobo.vn#x"],
    ["có userinfo", "https://a@test.satarobo.vn"],
    ["tên miền đơn nhãn", "https://localhost"],
    ["rỗng", ""],
  ])("%s ⇒ null", (_ten, giaTri) => {
    expect(chuanHoaGoc(giaTri)).toBeNull();
  });
  it("không phải chuỗi ⇒ null", () => {
    expect(chuanHoaGoc(undefined)).toBeNull();
    expect(chuanHoaGoc(null)).toBeNull();
  });
});

describe("[GCK-03] thiếu cấu hình ⇒ null ở mọi môi trường", () => {
  it.each([["production"], ["preview"], ["test"], ["development"], [undefined]])("VERCEL_ENV=%s, chưa đặt biến ⇒ null (không mặc định prod)", (e) => {
    expect(gocCongKhai({ VERCEL_ENV: e })).toBeNull();
  });
  it("production nhưng đã đặt biến ⇒ dùng biến (đối chứng dương)", () => {
    expect(gocCongKhai({ VERCEL_ENV: "production", AFFILIATE_PUBLIC_ORIGIN: PROD })).toBe(PROD);
  });
  it("câu nhắc nêu đúng tên biến để người vận hành biết đặt gì", () => {
    expect(LY_DO_THIEU_GOC).toContain("AFFILIATE_PUBLIC_ORIGIN");
    expect(LY_DO_THIEU_GOC).not.toContain("NEXT_PUBLIC_APP_URL");
  });
});

describe("[GCK-04] cùng luật hình dạng với dungUrlChuyenHuong", () => {
  it("mọi gốc mà gocCongKhai trả đều dựng được địa chỉ ngắn", () => {
    for (const g of [TEST, PROD, "https://a.b.c.example.vn"]) {
      const goc = gocCongKhai({ AFFILIATE_PUBLIC_ORIGIN: g });
      expect(goc).toBe(g);
      expect(dungUrlChuyenHuong(goc!, "K8F29XQ47M")).toBe(`${g}/r/K8F29XQ47M`);
    }
  });
});
