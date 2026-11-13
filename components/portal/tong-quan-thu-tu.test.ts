// @vitest-environment node
// [TQT] Thứ tự khối ở «Tổng quan» (12/11/2026, chủ dự án): buổi học tiếp theo ĐẦU TIÊN → (khoá sắp hết) → học bù + số lượt bù → Quà tặng/Khuyến mãi (hai ô) → sản phẩm.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const trang = doc("components/portal/tong-quan-page.tsx");
const vi = (s: string) => {
  const k = trang.indexOf(s);
  expect(k, `thiếu «${s}»`).toBeGreaterThan(-1);
  return k;
};

describe("[TQT] thứ tự khối ở Tổng quan", () => {
  it("[TQT-01] buổi tiếp theo đứng TRƯỚC khoá sắp hết, học bù, hai ô quà/khuyến mãi và sản phẩm", () => {
    const tiep = vi("BUỔI HỌC TIẾP THEO · ");
    const het = vi('aria-label="Khoá học của con sắp hết"');
    const bu = vi("d.hocBu ?");
    const o = vi('aria-label="Quà tặng và khuyến mãi"');
    const sp = vi("CON ĐÃ TỰ TAY LÀM RA");
    expect(tiep).toBeLessThan(het);
    expect(het).toBeLessThan(bu);
    expect(bu).toBeLessThan(o);
    expect(o).toBeLessThan(sp);
  });

  it("[TQT-02] không còn khối Quà tặng/khuyến mãi hay khoá-sắp-hết nằm TRƯỚC buổi tiếp theo", () => {
    const tiep = vi("BUỔI HỌC TIẾP THEO · ");
    for (const s of ['aria-label="Quà tặng và khuyến mãi"', 'aria-label="Khoá học của con sắp hết"']) {
      expect(trang.indexOf(s)).toBeGreaterThan(tiep);
      expect(trang.lastIndexOf(s)).toBe(trang.indexOf(s)); // chỉ MỘT chỗ
    }
  });

  it("[TQT-03] điện thoại: hai ô quà/khuyến mãi LUÔN hai cột (không rơi một cột)", () => {
    expect(trang).toMatch(/aria-label="Quà tặng và khuyến mãi" className="grid grid-cols-2 /);
  });

  it("[TQT-04] hàng học bù hiện SỐ LƯỢT BÙ CÒN LẠI lấy từ sổ lượt (luotCon), và dữ liệu lấy qua docLuotBuChoCon (cùng nguồn trang Chuyên cần)", () => {
    expect(trang).toContain("lượt bù");
    expect(trang).toContain("d.hocBu.luotCon");
    const tq = doc("lib/portal/tong-quan.ts");
    expect(tq).toContain("docLuotBuChoCon(studentId)");
    expect(tq).toContain("luotCon: luotBu ? luotBu.con : null");
  });
});

describe("[TQT] thẻ «khoá sắp hết» — nút liên hệ (chủ dự án 12/11)", () => {
  it("[TQT-05] hai nút theo lời chủ dự án: «Liên hệ với tư vấn viên phụ trách» (→ tin nhắn, nơi có tư vấn viên) + «Gọi qua hotline»; hết «Gọi trung tâm»/«Nhắn tin»", () => {
    expect(trang).toContain("Liên hệ với tư vấn viên phụ trách");
    expect(trang).toContain("Gọi qua hotline");
    expect(trang).not.toContain("Gọi trung tâm");
    expect(trang).not.toMatch(/>\s*Nhắn tin\s*</);
    // nút liên hệ trỏ vào màn tin nhắn (có khối «Tư vấn viên phụ trách»), nút gọi là tel:
    expect(trang).toMatch(/href="\/portal\/tin-nhan"[\s\S]{0,260}Liên hệ với tư vấn viên phụ trách/);
    expect(trang).toMatch(/href=\{`tel:\$\{SATA_ROBO_PHONE\.tho\}`\}[\s\S]{0,260}Gọi qua hotline/);
  });

  it("[TQT-06] KHÔNG hứa «tư vấn viên phụ trách» khi phụ huynh không có: nhãn đổi theo coTuVanVien (đọc từ listSalesForParent), prop BẮT BUỘC", () => {
    expect(trang).toMatch(/coTuVanVien \? "Liên hệ với tư vấn viên phụ trách" : "Nhắn tin cho trung tâm"/);
    expect(trang).toMatch(/coTuVanVien: boolean;/);
    const p = doc("app/(portal)/portal/page.tsx");
    expect(p).toContain("listSalesForParent(ctx.parentUserId)");
    expect(p).toContain("coTuVanVien={coTuVanVien}");
  });
});
