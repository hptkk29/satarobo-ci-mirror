/**
 * Lưới ghim dây nối `ref` FIRST-TOUCH (09/10/2026) — phần mà test hành vi của `attribution.ts` KHÔNG chạm tới:
 * `contact-form.tsx` là nơi `ref` thật sự rời trình duyệt, và bản cũ ưu tiên ref trên URL HIỆN TẠI. Giữ thứ tự cũ thì cookie first-touch
 * vẫn xanh hết mà link giới thiệu thứ hai vẫn đè link thứ nhất lúc submit (ref B từ URL thắng ref A từ cookie).
 *
 * Neo hẹp theo BIỂU THỨC (không theo chỗ đặt dòng), bỏ chú thích trước khi đếm (chú thích giải thích bản vá chứa đúng chuỗi đang cấm),
 * và khẳng định SỐ LẦN khớp.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Bỏ chú thích dòng (`//`) và chú thích khối — đủ cho tệp .tsx này (không dòng mang `ref:` nào chứa `//` trong chuỗi). */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[ATT-W1] contact-form gửi ref: COOKIE (đã first-touch) trước, URL chỉ là đường lùi", () => {
  const ma = boChuThich(doc("app/(public)/lien-he/_components/contact-form.tsx"));

  it("đúng MỘT dòng `ref:` trong payload và nó là `attribution.ref || getUrlParam(..., 'ref')`", () => {
    expect(dem(ma, /^\s*ref:\s/gm)).toBe(1);
    expect(dem(ma, /ref:\s*attribution\.ref\s*\|\|\s*getUrlParam\(\s*searchParams\s*,\s*'ref'\s*\)/g)).toBe(1);
  });

  it("KHÔNG còn thứ tự cũ (URL trước cookie)", () => {
    expect(dem(ma, /getUrlParam\(\s*searchParams\s*,\s*'ref'\s*\)\s*\|\|\s*attribution\.ref/g)).toBe(0);
  });
});

describe("[ATT-W2] hai nơi gửi còn lại chỉ trải readAttribution() — không tự ghép ref từ URL", () => {
  it("consult-modal và tracking.ts của landing legacy không đọc `ref` từ URL", () => {
    for (const p of ["components/khoa-hoc/consult-modal.tsx", "components/legacy-laptrinhrobot/_utils/tracking.ts"]) {
      const ma = boChuThich(doc(p));
      expect(dem(ma, /\.\.\.readAttribution\(\)/g)).toBe(1);
      expect(dem(ma, /get\(\s*['"]ref['"]\s*\)/g)).toBe(0);
    }
  });
});
