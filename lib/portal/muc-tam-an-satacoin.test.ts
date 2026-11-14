// [MSC-*] — «SataCoin» tạm ẩn khỏi Cổng phụ huynh + Cổng học sinh (04/11/2026). MỘT công tắc, mọi nơi hỏi cùng một hàm.
//   [MSC-01] công tắc: mặc định TẮT; chỉ đúng chuỗi "true" mới bật (đối chứng dương: bật ⇒ hiện); độc lập với công tắc bài tập
//   [MSC-02] hàm thuần nhận diện đường dẫn + lọc mục menu (cờ BẬT ⇒ nguyên danh sách)
//   [MSC-03] dây nối: route / layout / vỏ menu / bộ nạp dữ liệu đều đi qua cùng công tắc (đọc nguồn — neo vào LỜI GỌI, luật 14)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NHANH_SATACOIN, laDuongSataCoin, locMucSataCoin, mucBaiTapBaiThiDangHien, mucSataCoinDangHien } from "@/lib/portal/muc-tam-an";

afterEach(() => vi.unstubAllEnvs());

describe("[MSC-01] công tắc", () => {
  it("mặc định TẮT (không đặt env)", () => {
    vi.stubEnv("PORTAL_SATACOIN_ENABLED", "");
    expect(mucSataCoinDangHien()).toBe(false);
  });
  it('chỉ "true" mới bật; "TRUE"/"1"/"yes" KHÔNG bật', () => {
    vi.stubEnv("PORTAL_SATACOIN_ENABLED", "true");
    expect(mucSataCoinDangHien()).toBe(true);
    for (const v of ["TRUE", "1", "yes", "false"]) {
      vi.stubEnv("PORTAL_SATACOIN_ENABLED", v);
      expect(mucSataCoinDangHien(), v).toBe(false);
    }
  });
  it("độc lập với công tắc «Bài tập & bài thi» (bật cái này không bật cái kia)", () => {
    vi.stubEnv("PORTAL_BAI_TAP_BAI_THI_ENABLED", "");
    vi.stubEnv("PORTAL_SATACOIN_ENABLED", "true");
    expect(mucSataCoinDangHien()).toBe(true);
    expect(mucBaiTapBaiThiDangHien()).toBe(false);
    vi.stubEnv("PORTAL_BAI_TAP_BAI_THI_ENABLED", "true");
    vi.stubEnv("PORTAL_SATACOIN_ENABLED", "");
    expect(mucBaiTapBaiThiDangHien()).toBe(true);
    expect(mucSataCoinDangHien()).toBe(false);
  });
});

describe("[MSC-02] đường dẫn + lọc menu", () => {
  it("nhận đúng nhánh /portal/satacoin theo ĐOẠN (không khớp tiền tố chữ)", () => {
    expect(NHANH_SATACOIN).toEqual(["/portal/satacoin"]);
    for (const p of ["/portal/satacoin", "/portal/satacoin/", "/portal/satacoin/lich-su?x=1"]) expect(laDuongSataCoin(p), p).toBe(true);
    // «Hành trình & huy hiệu» của cổng học sinh KHÔNG thuộc mục này (route đó còn mở cho huy hiệu)
    for (const p of ["/portal", "/portal/satacoin-x", "/portal/hoc-sinh/hanh-trinh", "/portal/bai-tap", "/portal/thong-bao"]) {
      expect(laDuongSataCoin(p), p).toBe(false);
    }
  });
  it("ẩn ⇒ bỏ đúng mục SataCoin; hiện ⇒ nguyên danh sách và luôn là bản sao (đối chứng dương)", () => {
    const ds = [
      { href: "/portal", ten: "Tổng quan" },
      { href: "/portal/satacoin", ten: "SataCoin" },
      { href: "/portal/thong-bao", ten: "Thông báo" },
    ];
    expect(locMucSataCoin(ds, false).map((m) => m.ten)).toEqual(["Tổng quan", "Thông báo"]);
    expect(locMucSataCoin(ds, true)).toEqual(ds);
    expect(locMucSataCoin(ds, true)).not.toBe(ds);
  });
});

// ── [MSC-03] dây nối ───────────────────────────────────────────────────────────────────────────────────────────────
const boChuThich = (s: string) =>
  s
    .split(/\r?\n/)
    .filter((d) => !/^\s*\/\//.test(d))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(\s)\/\/.*$/gm, "$1");
const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[MSC-03] dây nối", () => {
  it("route /portal/satacoin trả 404 khi mục ẩn, và hỏi TRƯỚC khi đụng phiên/DB", () => {
    const s = doc("app/(portal)/portal/satacoin/page.tsx");
    expect(s).toMatch(/if\s*\(\s*!mucSataCoinDangHien\(\)\s*\)\s*notFound\(\)/);
    expect(s.indexOf("mucSataCoinDangHien()")).toBeLessThan(s.indexOf("await requireActiveStudent("));
  });
  it("layout gốc truyền công tắc cho cả vỏ v2 lẫn menu v1", () => {
    expect(dem(doc("app/(portal)/portal/layout.tsx"), /coSataCoin=\{mucSataCoinDangHien\(\)\}/g)).toBe(2);
  });
  it("menu phụ huynh (v2 + v1) lọc bằng MỘT hàm", () => {
    expect(doc("components/portal/v2-shell.tsx")).toMatch(/locMucSataCoin\(locMucBaiTapBaiThi\(parentNav,\s*coBaiTap\),\s*coSataCoin\)/);
    expect(doc("app/(portal)/portal/_components/portal-nav.tsx")).toMatch(/locMucSataCoin\(locMucBaiTapBaiThi\(ITEMS,\s*coBaiTap\),\s*coSataCoin\)/);
  });
  it("bộ nạp dữ liệu Cổng học sinh: MỌI lần đọc số dư / giao dịch coin đều nằm sau công tắc", () => {
    const s = doc("lib/portal/hv-du-lieu.ts");
    // số dư: docHvVo + docHvHomNay + docHvHanhTrinh
    expect(dem(s, /\bhvSoDu\(studentId\)/g)).toBe(3);
    expect(dem(s, /mucSataCoinDangHien\(\)\s*\?\s*hvSoDu\(studentId\)\s*:\s*Promise\.resolve\(null\)/g)).toBe(3);
    // giao dịch: tin «Em nhận +N coin» (qua biến coCoin) + thẻ giao dịch ở Hành trình
    expect(dem(s, /\blistTransactions\(/g)).toBe(2);
    expect(dem(s, /(?:coCoin|mucSataCoinDangHien\(\))\s*\?\s*listTransactions\(/g)).toBe(2);
    expect(s).toMatch(/const coCoin = mucSataCoinDangHien\(\)/);
  });
  it("giao diện chỉ vẽ coin khi coin !== null (vỏ · Hôm nay · Hành trình · Thêm)", () => {
    expect(dem(doc("components/portal/hv-shell.tsx"), /soCoin !== null &&/g)).toBe(2);
    expect(doc("components/portal/hv-hom-nay.tsx")).toMatch(/d\.coin !== null &&/);
    expect(doc("components/portal/hv-hanh-trinh.tsx")).toMatch(/d\.coin !== null &&/);
    expect(doc("components/portal/hv-them.tsx")).toMatch(/coin === null\s*\?/);
  });
});
