/**
 * [CTA-*] — khối CTA tím cuối trang (`.cta-band`) nằm giữa khoảng trống ĐỀU trên và dưới (04/11/2026).
 * Lỗi cũ: section bọc nó có `padding-top: 0` còn `.sec` có padding-bottom ~104px ⇒ khối dính sát đường kẻ phía trên, hở 120px phía dưới (trang DISC, Tin tức, Khoá học,
 * Liên hệ, Về chúng tôi). Nay mọi section bọc CTA dùng đúng `.sec` mặc định (trên = dưới).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TRANG = [
  "components/blog/tin-tuc-khung.tsx",
  "components/jobs/tuyen-dung-khung.tsx",
  "components/public/disc/gioi-thieu.tsx",
  "components/public/khoa-hoc/phan-chung.tsx",
  "app/(public)/lien-he/noi-dung.tsx",
  "app/(public)/ve-chung-toi/noi-dung.tsx",
];

const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).filter((d) => !/^\s*\/\//.test(d)).join("\n");

describe("[CTA-01] section bọc .cta-band không ép padding-trên về 0", () => {
  it.each(TRANG)("%s: section ngay trước .wrap > .cta-band là `<section className=\"sec\">` trần", (f) => {
    const t = bo(readFileSync(resolve(process.cwd(), f), "utf8"));
    const m = t.match(/(<section[^>]*>)\s*<div className="wrap">\s*<div className="cta-band/);
    expect(m, f + ": không thấy khối CTA").not.toBeNull();
    expect(m![1]).toBe('<section className="sec">');
  });

  it("đối chứng của bộ bóc: một section còn `paddingTop: 0` PHẢI bị bắt", () => {
    const mau = '<section className="sec" style={{paddingTop: "0"}}>\n<div className="wrap">\n<div className="cta-band sv">';
    const m = mau.match(/(<section[^>]*>)\s*<div className="wrap">\s*<div className="cta-band/);
    expect(m![1]).not.toBe('<section className="sec">');
  });
});
