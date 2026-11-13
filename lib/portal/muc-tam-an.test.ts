// [MTA-*] — «Bài tập & bài thi» tạm ẩn khỏi Cổng phụ huynh + Cổng học sinh (03/11/2026). MỘT công tắc, mọi nơi hỏi cùng một hàm.
//   [MTA-01] công tắc: mặc định TẮT; chỉ đúng chuỗi "true" mới bật (đối chứng dương: bật ⇒ hiện)
//   [MTA-02] hàm thuần nhận diện đường dẫn + lọc mục menu (cờ BẬT ⇒ nguyên danh sách)
//   [MTA-03] dây nối: route / hành động / vỏ / bộ nạp dữ liệu đều đi qua cùng công tắc (đọc nguồn — phép cấy ở commit)
//   [MTA-04] hai huy hiệu cần bài tập + tab «Bài tập» của tin ẩn cùng mục
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOI_MUC_DANG_AN,
  NHANH_BAI_TAP_BAI_THI,
  laDuongBaiTapBaiThi,
  locMucBaiTapBaiThi,
  mucBaiTapBaiThiDangHien,
} from "@/lib/portal/muc-tam-an";
import { HUY_HIEU_CAN_BAI_TAP, huyHieuTheoMuc, tinhHuyHieu } from "@/lib/portal/hv-hanh-trinh-thuan";
import { BO_LOC_TIN, boLocTinTheoMuc } from "@/lib/portal/hv-thong-bao-thuan";

afterEach(() => vi.unstubAllEnvs());

describe("[MTA-01] công tắc", () => {
  it("mặc định TẮT (không đặt env)", () => {
    vi.stubEnv("PORTAL_BAI_TAP_BAI_THI_ENABLED", "");
    expect(mucBaiTapBaiThiDangHien()).toBe(false);
  });
  it('chỉ "true" mới bật; "TRUE"/"1"/"yes" KHÔNG bật', () => {
    vi.stubEnv("PORTAL_BAI_TAP_BAI_THI_ENABLED", "true");
    expect(mucBaiTapBaiThiDangHien()).toBe(true);
    for (const v of ["TRUE", "1", "yes", "false"]) {
      vi.stubEnv("PORTAL_BAI_TAP_BAI_THI_ENABLED", v);
      expect(mucBaiTapBaiThiDangHien(), v).toBe(false);
    }
  });
});

describe("[MTA-02] đường dẫn + lọc menu", () => {
  it("nhận đúng bốn nhánh theo ĐOẠN (không khớp tiền tố chữ)", () => {
    expect(NHANH_BAI_TAP_BAI_THI).toHaveLength(4);
    for (const p of [
      "/portal/bai-tap",
      "/portal/bai-tap/abc",
      "/portal/bai-tap/lam-bai/x?y=1",
      "/portal/bai-thi",
      "/portal/bai-thi/e1",
      "/portal/hoc-sinh/bai-tap",
      "/portal/hoc-sinh/bai-thi/e1",
    ]) {
      expect(laDuongBaiTapBaiThi(p), p).toBe(true);
    }
    for (const p of ["/portal", "/portal/bai-giang", "/portal/bai-tap-x", "/portal/hoc-sinh", "/portal/hoc-sinh/lich", "/portal/ket-qua"]) {
      expect(laDuongBaiTapBaiThi(p), p).toBe(false);
    }
  });
  it("ẩn ⇒ bỏ đúng mục dẫn tới bài tập/bài thi; hiện ⇒ nguyên danh sách (đối chứng dương)", () => {
    const ds = [
      { href: "/portal", ten: "Tổng quan" },
      { href: "/portal/bai-tap", ten: "Bài tập & bài thi" },
      { href: "/portal/hoc-sinh/bai-tap", ten: "Bài tập" },
      { href: "/portal/lich", ten: "Lịch" },
    ];
    expect(locMucBaiTapBaiThi(ds, false).map((m) => m.ten)).toEqual(["Tổng quan", "Lịch"]);
    expect(locMucBaiTapBaiThi(ds, true)).toEqual(ds);
    expect(locMucBaiTapBaiThi(ds, true)).not.toBe(ds); // luôn bản sao
  });
  it("lời từ chối nói thật (tiếng Việt có dấu, nhắc đang tạm ẩn)", () => {
    expect(LOI_MUC_DANG_AN).toMatch(/tạm ẩn/);
  });
});

describe("[MTA-04] huy hiệu + tab tin", () => {
  const ds = tinhHuyHieu({ daHoc: 1, tong: 12, baiDungHan: 5, coBaiDiemToiDa: true, diemDanh: [], nhom: null });
  it("ẩn ⇒ bỏ đúng hai huy hiệu cần bài tập, các huy hiệu khác giữ nguyên", () => {
    expect([...HUY_HIEU_CAN_BAI_TAP].sort()).toEqual(["diem-10", "dung-hen"]);
    const an = huyHieuTheoMuc(ds, false);
    expect(an.map((h) => h.ma)).not.toContain("dung-hen");
    expect(an.map((h) => h.ma)).not.toContain("diem-10");
    expect(an).toHaveLength(ds.length - 2);
  });
  it("hiện ⇒ đủ (đối chứng dương)", () => {
    expect(huyHieuTheoMuc(ds, true).map((h) => h.ma)).toEqual(ds.map((h) => h.ma));
  });
  it("tab «Bài tập» của tin: ẩn ⇒ bỏ; hiện ⇒ còn", () => {
    expect(boLocTinTheoMuc(false).map((l) => l.id)).not.toContain("bt");
    expect(boLocTinTheoMuc(false)).toHaveLength(BO_LOC_TIN.length - 1);
    expect(boLocTinTheoMuc(true).map((l) => l.id)).toContain("bt");
  });
});

// ── [MTA-03] dây nối — đọc nguồn, neo vào LỜI GỌI (không neo vào dòng import: luật 14) ─────────────────────────────
const boChuThich = (s: string) =>
  s
    .split(/\r?\n/)
    .filter((d) => !/^\s*\/\//.test(d))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(\s)\/\/.*$/gm, "$1");
const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[MTA-03] dây nối", () => {
  const LAYOUT_ROUTE = [
    "app/(portal)/portal/bai-tap/layout.tsx",
    "app/(portal)/portal/bai-thi/layout.tsx",
    "app/(portal)/portal/hoc-sinh/(hoc-sinh)/bai-tap/layout.tsx",
    "app/(portal)/portal/hoc-sinh/(hoc-sinh)/bai-thi/layout.tsx",
  ];
  for (const f of LAYOUT_ROUTE) {
    it(`route ${f} trả 404 khi mục ẩn`, () => {
      expect(doc(f)).toMatch(/if\s*\(\s*!mucBaiTapBaiThiDangHien\(\)\s*\)\s*notFound\(\)/);
    });
  }
  it("hành động nộp bài (1) + ba hành động bài thi (3) tự từ chối khi mục ẩn, SAU requireActiveStudent", () => {
    const re = /await requireActiveStudent\(\{ choHocSinh: true \}\);\s*if \(!mucBaiTapBaiThiDangHien\(\)\) return \{ ok: false, error: LOI_MUC_DANG_AN \};/g;
    expect(dem(doc("app/(portal)/portal/bai-tap/actions.ts"), re)).toBe(1);
    expect(dem(doc("app/(portal)/portal/bai-thi/actions.ts"), re)).toBe(3);
  });
  it("layout gốc truyền công tắc cho cả vỏ v2 lẫn menu v1", () => {
    expect(dem(doc("app/(portal)/portal/layout.tsx"), /coBaiTap=\{mucBaiTapBaiThiDangHien\(\)\}/g)).toBe(2);
  });
  it("vỏ phụ huynh / học sinh / v2 / v1 lọc bằng MỘT hàm", () => {
    expect(doc("components/portal/sr-shell.tsx")).toMatch(/locMucBaiTapBaiThi\(NHOM_CON,\s*coBaiTap\)/);
    const hv = doc("components/portal/hv-shell.tsx");
    expect(hv).toMatch(/locMucBaiTapBaiThi\(mucDayDu,\s*coBaiTap\)/);
    expect(hv).toMatch(/locMucBaiTapBaiThi\(tabDayDu,\s*coBaiTap\)/);
    const v2 = doc("components/portal/v2-shell.tsx");
    expect(v2).toMatch(/locMucBaiTapBaiThi\(parentNav,\s*coBaiTap\)/);
    expect(v2).toMatch(/locMucBaiTapBaiThi\(studentNav,\s*coBaiTap\)/);
    expect(v2).toMatch(/coBaiTap=\{coBaiTap\}/);
    expect(doc("app/(portal)/portal/_components/portal-nav.tsx")).toMatch(/locMucBaiTapBaiThi\(ITEMS,\s*coBaiTap\)/);
  });
  it("bộ nạp dữ liệu hỏi cùng công tắc (số đếm, tin, huy hiệu, chuyên cần, nhận xét)", () => {
    const hv = doc("lib/portal/hv-du-lieu.ts");
    expect(dem(hv, /mucBaiTapBaiThiDangHien\(\)/g)).toBeGreaterThanOrEqual(6);
    expect(hv).toMatch(/huyHieuTheoMuc\(tinh,\s*coBaiTap\)/);
    expect(hv).toMatch(/boLocTinTheoMuc\(mucBaiTapBaiThiDangHien\(\)\)/);
    expect(doc("lib/portal/chuyen-can.ts")).toMatch(/canhBao\(xepLoai,\s*coBaiTap \? baiVe\.chuaNop : 0\)/);
    expect(doc("lib/portal/nhan-xet.ts")).toMatch(/coBaiTap:\s*mucBaiTapBaiThiDangHien\(\)/);
    expect(doc("app/(portal)/portal/huong-dan/_content/index.ts")).toMatch(/laDuongBaiTapBaiThi\(g\.pagePath \?\? ""\)/);
  });
});
