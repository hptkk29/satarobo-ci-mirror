// Ca [TRT-*] — trang công khai mang MÃ LIÊN KẾT trong đường dẫn (token = quyền truy cập) không được nạp phân tích / quảng cáo / theo dõi nguồn khách.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TIEN_TO_TRANG_RIENG_TU, laTrangRiengTu } from "./trang-rieng-tu";

describe("[TRT-01] nhận diện trang riêng tư", () => {
  it("đúng tiền tố và mọi đường con; KHÔNG khớp tiền tố gần giống (đối chứng)", () => {
    expect(laTrangRiengTu("/thong-tin-hoa-don/abc.def")).toBe(true);
    expect(laTrangRiengTu("/thong-tin-hoa-don")).toBe(true);
    expect(laTrangRiengTu("/thong-tin-hoa-donxyz")).toBe(false);
    expect(laTrangRiengTu("/")).toBe(false);
    expect(laTrangRiengTu("/lien-he")).toBe(false);
    expect(laTrangRiengTu("/khoa-hoc/laptrinhrobot")).toBe(false);
  });
  it("pathname rỗng / null / undefined ⇒ false (không ném, không coi là riêng tư)", () => {
    for (const p of [null, undefined, ""]) expect(laTrangRiengTu(p), String(p)).toBe(false);
  });
  it("danh sách tiền tố có đúng một phần tử và khớp đường dẫn thật của trang", () => {
    expect([...TIEN_TO_TRANG_RIENG_TU]).toEqual(["/thong-tin-hoa-don"]);
  });
});

describe("[TRT-02] lưới ghim: mọi thành phần theo dõi / quảng cáo dưới layout công khai đều hỏi hàm này", () => {
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n");
  const doc = (f: string) => boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
  const CAN_HOI = [
    "components/public/ga4.tsx",
    "components/public/meta-pixel.tsx",
    "components/public/attribution-capture.tsx",
    "components/public/popup-hoc-thu-1-1.tsx",
    "components/public/floating-cta.tsx",
    // sticky-mobile-cta.tsx đã xoá (giao diện public mới: thanh đáy điện thoại nằm trong floating-cta) — không còn nơi nào import.
  ];
  it.each(CAN_HOI)("%s gọi laTrangRiengTu(pathname) đúng một lần", (f) => {
    const t = doc(f);
    expect(t.match(/\blaTrangRiengTu\(pathname\)/g)?.length ?? 0).toBe(1);
  });
  it("robots cấm lập chỉ mục đường dẫn", () => {
    expect(doc("app/robots.ts")).toContain("/thong-tin-hoa-don/");
  });
  it("hai thành phần nạp script bên thứ ba KHÔNG nạp khi là trang riêng tư: câu kiểm đứng TRƯỚC câu `return` trả JSX", () => {
    for (const f of ["components/public/ga4.tsx", "components/public/meta-pixel.tsx"]) {
      const t = doc(f);
      expect(t.indexOf("laTrangRiengTu(pathname)"), f).toBeGreaterThan(-1);
      expect(t.indexOf("laTrangRiengTu(pathname)"), f).toBeLessThan(t.search(/return \(\s*</));
    }
  });
});
