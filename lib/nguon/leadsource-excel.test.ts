/**
 * Ca [LSE-*] — F1 (19/10/2026): `Lead.source` của lead sinh từ Excel KHÔNG phải ô tự do. THUẦN, không DB.
 *
 * Luật: cờ nguồn BẬT ⇒ nhãn thuộc 28 nhãn đã chốt GIỮ nguyên chữ người gõ; nhãn khác (chữ tự do, có thể là SĐT/tên) ⇒ nhãn hệ thống «Import Excel»,
 * chuỗi gốc đi ở `nhanKhai` ⇒ `signals.nhanGoc`. Ca hành vi trên Postgres: `[EMNV-F1]` `[EMNV-F1b]` `[EMNV-F1c]` (tests/lead-intake/nguon-excel-ma-nv.spec.ts).
 * Lưới ghim dây nối ở đây vì ca DB SKIP khi không có Postgres (job `Unit tests` của CI không dựng DB).
 *
 *   [LSE-01]  cả 28 nhãn đã chốt (kể cả biến thể hoa/thường · khoảng trắng) ⇒ GIỮ nguyên chữ
 *   [LSE-02]  nhãn ngoài 28 (kể cả chuỗi chứa SĐT, tên nguồn tuỳ biến, «Import Excel») ⇒ nhãn hệ thống
 *   [LSE-03]  nhãn hệ thống của đường E KHÔNG được là nhãn trong 28 («Import Excel ĐK» là #26 ⇒ nhóm nhân sự): đường D/E dùng «Import Excel», và nó phân loại INVALID
 *   [LSE-W1]  đường D: gán `g.base.source` bằng hàm CHỈ khi cờ nguồn bật; `nhanKhai`/`conversionEntry` vẫn nhận đúng giá trị
 *   [LSE-W2]  đường E: `Lead.source` và `conversionEntry` đi qua `sourceGhiLead`; `nhanKhai` vẫn là chuỗi GỐC
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { anhXaNhanCu, BANG_ANH_XA_0610, laNhanDaChot, leadSourceTuNhanExcel } from "./anh-xa-nhan-cu";
import { VAI_SANG_NGUON_MAC_DINH } from "./danh-muc-goc";

const MAC_DINH = "Import Excel";

describe("[LSE-01] nhãn trong 28 nhãn đã chốt ⇒ giữ nguyên chữ", () => {
  it("đủ 28 dòng của bảng, mỗi dòng giữ đúng chữ", () => {
    expect(BANG_ANH_XA_0610).toHaveLength(28);
    for (const r of BANG_ANH_XA_0610) {
      expect(laNhanDaChot(r.nhan), r.nhan).toBe(true);
      expect(leadSourceTuNhanExcel(r.nhan, MAC_DINH), r.nhan).toBe(r.nhan);
    }
  });
  it("biến thể hoa/thường/khoảng trắng của nhãn trong bảng cũng là nhãn đã chốt — và GIỮ chữ người gõ (như hành vi cũ)", () => {
    for (const raw of ["ads", "ADS", "Ads", "sale tự  kiếm", "NGUỒN KH TỰ ĐẾN TRUNG TÂM"]) {
      expect(laNhanDaChot(raw), raw).toBe(true);
      expect(leadSourceTuNhanExcel(raw, MAC_DINH), raw).toBe(raw);
    }
  });
});

describe("[LSE-02] nhãn ngoài 28 ⇒ nhãn hệ thống (không chép chuỗi tự do vào khoá định tuyến)", () => {
  it("chuỗi chứa SĐT/tên, tên nguồn tuỳ biến, nhãn lạ, chính «Import Excel» ⇒ «Import Excel»", () => {
    for (const raw of ["Chị Lan 0905123456 giới thiệu", "Hội thảo STEM tháng 10", "Nguồn tuỳ biến NS", "Import Excel", "0905123456", "Ads 2"]) {
      expect(laNhanDaChot(raw), raw).toBe(false);
      expect(leadSourceTuNhanExcel(raw, MAC_DINH), raw).toBe(MAC_DINH);
    }
  });
  it("`macDinh` là THAM SỐ (luật 7): trả đúng chuỗi được truyền", () => {
    expect(leadSourceTuNhanExcel("Hội thảo", "Nhãn khác")).toBe("Nhãn khác");
  });
});

describe("[LSE-03] nhãn hệ thống phải phân loại INVALID (di trú đọc lại Lead.source không được đổi nguồn lead)", () => {
  const phanLoai = (nhan: string) =>
    anhXaNhanCu({ nhan, createdAt: new Date("2026-10-11T03:00:00.000Z"), affiliate: null, nguoiNhap: null, maNvTrongNote: null }, VAI_SANG_NGUON_MAC_DINH, "EMPLOYEE_REFERRAL").loai;
  it("«Import Excel» ⇒ INVALID", () => {
    expect(phanLoai(MAC_DINH)).toBe("INVALID");
  });
  it("đối chứng dương: «Import Excel ĐK» là nhãn #26 ⇒ KHÔNG INVALID (vì vậy đường E không dùng nó cho nhãn lạ)", () => {
    expect(laNhanDaChot("Import Excel ĐK")).toBe(true);
    expect(phanLoai("Import Excel ĐK")).not.toBe("INVALID");
  });
});

// ── lưới ghim dây nối ──
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (d: string) => boChuThich(readFileSync(resolve(process.cwd(), d), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe("[LSE-W1] đường D (`import/leads`)", () => {
  const ma = doc("app/api/admin/import/leads/route.ts");
  it("gán `g.base.source` bằng `leadSourceTuNhanExcel` đúng MỘT lần, và CHỈ khi cờ nguồn bật", () => {
    expect(dem(ma, /\bleadSourceTuNhanExcel\(/g)).toBe(1);
    expect(dem(ma, /if \(nguonBat\) for \(const g of dsTao\) g\.base\.source = leadSourceTuNhanExcel\(g\.base\.source, "Import Excel"\);/g)).toBe(1);
  });
  it("phép gán đứng SAU khi biết cờ + dựng `dsTao` và TRƯỚC khi quy nguồn / ghi lead", () => {
    const at = (re: RegExp) => ma.search(re);
    const gan = at(/g\.base\.source = leadSourceTuNhanExcel/);
    expect(gan).toBeGreaterThan(at(/const nguonBat = await laQuanLyNguonBat\(\)/));
    expect(gan).toBeGreaterThan(at(/const dsTao = \[\.\.\.groups\.values\(\)\]/));
    expect(gan).toBeLessThan(at(/await chuanBiQuyNguon\(/));
    expect(gan).toBeLessThan(at(/source: v\.source,/));
  });
  it("chuỗi GỐC vẫn đi tiếp: `nhanKhai` = `sourceRaw` (hai nơi), `conversionEntry` = `source` đã chuẩn hoá, ghi lead dùng `v.source`", () => {
    expect(dem(ma, /nhanKhai: g\.base\.sourceRaw/g)).toBe(2);
    expect(dem(ma, /conversionEntry: g\.base\.source,/g)).toBe(1);
    expect(dem(ma, /source: v\.source,/g)).toBe(1);
  });
});

describe("[LSE-W2] đường E (`import/leads/registered`)", () => {
  const ma = doc("app/api/admin/import/leads/registered/route.ts");
  it("`sourceGhiLead` CHỈ chuẩn hoá khi cờ nguồn bật, nhãn hệ thống «Import Excel» (không phải «Import Excel ĐK»)", () => {
    expect(dem(ma, /const sourceGhiLead = \(nhan: string\): string => \(nguonBat \? leadSourceTuNhanExcel\(nhan, "Import Excel"\) : nhan\);/g)).toBe(1);
  });
  it("`Lead.source` và `conversionEntry` đi qua nó; `nhanKhai` vẫn là chuỗi GỐC `c.source` (hai nơi)", () => {
    expect(dem(ma, /conversionEntry: sourceGhiLead\(c\.source\)/g)).toBe(1);
    expect(dem(ma, /source: sourceGhiLead\(c\.source\),/g)).toBe(1);
    expect(dem(ma, /nhanKhai: c\.source,/g)).toBe(2);
    expect(dem(ma, /\bsource: c\.source,/g), "không còn ghi nguyên văn vào Lead.source").toBe(0);
  });
});
