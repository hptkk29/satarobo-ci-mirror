import { describe, expect, it } from "vitest";
import { CACHE_ASSET_CON, CACHE_KHONG_LUU, CACHE_LOI, chinhSachCache } from "@/lib/scorm/cache-asset";

describe("[CAC] chính sách cache asset SCORM", () => {
  it("[CAC-01] asset con URL có mã gói, không vé trên URL ⇒ cache riêng tư", () => {
    expect(chinhSachCache({ coQueryToken: false, urlKieuCu: false }).cacheControl).toBe(CACHE_ASSET_CON);
  });
  it("[CAC-02] hop đầu có vé trên URL ⇒ không lưu", () => {
    expect(chinhSachCache({ coQueryToken: true, urlKieuCu: false }).cacheControl).toBe(CACHE_KHONG_LUU);
  });
  it("[CAC-03] URL kiểu cũ (trùng giữa các gói) ⇒ không lưu, kể cả không vé trên URL", () => {
    expect(chinhSachCache({ coQueryToken: false, urlKieuCu: true }).cacheControl).toBe(CACHE_KHONG_LUU);
  });
  it("[CAC-04] KHÔNG có Vary ở mọi tổ hợp (cookie vé đổi theo gia hạn ⇒ Vary: Cookie sẽ tắt cache); luôn `private`", () => {
    for (const coQueryToken of [true, false]) {
      for (const urlKieuCu of [true, false]) {
        const c = chinhSachCache({ coQueryToken, urlKieuCu });
        expect(c.vary, JSON.stringify({ coQueryToken, urlKieuCu })).toBeNull();
        expect(c.cacheControl.startsWith("private"), c.cacheControl).toBe(true);
        expect(c.cacheControl).not.toMatch(/public|s-maxage|immutable/);
      }
    }
  });
  it("[CAC-05] chỉ MỘT tổ hợp được cache (có mã gói + không vé trên URL); max-age không vượt 1 giờ", () => {
    const duocLuu = [true, false]
      .flatMap((q) => [true, false].map((c) => chinhSachCache({ coQueryToken: q, urlKieuCu: c }).cacheControl))
      .filter((c) => c.includes("max-age"));
    expect(duocLuu).toEqual([CACHE_ASSET_CON]);
    expect(Number(/max-age=(\d+)/.exec(CACHE_ASSET_CON)![1])).toBeLessThanOrEqual(3600);
  });
  it("[CAC-06] phản hồi LỖI không bao giờ được lưu", () => {
    expect(CACHE_LOI).toBe(CACHE_KHONG_LUU);
    expect(CACHE_LOI).toContain("no-store");
  });
});
