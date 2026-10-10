import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chuanHoaTim, timHocVienBu } from "./loc";

// Chuẩn hoá CRLF: tệp nguồn trên Windows mang \r\n, cắt theo "\n}\n" sẽ trượt tới cuối tệp và nuốt
// thân hàm KHÁC — lưới xanh giả (đã cấy 07/10: bỏ dòng tìm ở whereCanBu mà lưới vẫn xanh).
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
/** Thân một hàm `export function ten(` — tới dấu `}` đóng ở đầu dòng. */
const than = (src: string, ten: string) => {
  const dau = src.indexOf(`export function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThan(-1);
  const cuoi = src.indexOf("\n}\n", dau);
  expect(cuoi, `không thấy cuối hàm ${ten}`).toBeGreaterThan(dau);
  return src.slice(dau, cuoi);
};

describe("[HBL-01] chuẩn hoá chuỗi tìm", () => {
  it("rỗng / toàn khoảng trắng ⇒ không lọc", () => {
    expect(chuanHoaTim(undefined)).toBeUndefined();
    expect(chuanHoaTim("")).toBeUndefined();
    expect(chuanHoaTim("   ")).toBeUndefined();
  });
  it("gộp khoảng trắng, cắt 80 ký tự", () => {
    expect(chuanHoaTim("  Phan   Đức  Nam ")).toBe("Phan Đức Nam");
    expect(chuanHoaTim("a".repeat(200))).toHaveLength(80);
  });
});

describe("[HBL-02] tìm khớp tên · mã HV · tên lớp — KHÔNG khớp SĐT", () => {
  const w = JSON.stringify(timHocVienBu("nam"));
  it("đủ ba trường, không phân biệt hoa thường", () => {
    expect(w).toContain('"name":{"contains":"nam","mode":"insensitive"}');
    expect(w).toContain('"studentCode":{"contains":"nam","mode":"insensitive"}');
    expect(w).toContain('"class":{"name":{"contains":"nam","mode":"insensitive"}}');
  });
  it("không có cột SĐT nào (tìm theo SĐT là máy dò SĐT — NỢ #11)", () => {
    expect(w).not.toMatch(/phone/i);
  });
});

describe("[HBL-W1] ba danh sách đều mang chuỗi tìm, đặt trong AND (không đè lọc Sale)", () => {
  it("whereCanBu · whereDaHuy", () => {
    const src = doc("lib/hoc-bu/danh-sach-db.ts");
    for (const ten of ["whereCanBu", "whereDaHuy"]) {
      const t = than(src, ten);
      expect(t, ten).toContain("...(loc.tim ? { AND: [timHocVienBu(loc.tim)] } : {})");
      expect(t, ten).toContain("student: hocVienCuaSale(loc.chiCuaSale)");
      expect(t, ten).toContain("id: loc.classId");
    }
  });
  it("whereCase — case có ít nhất một bé khớp", () => {
    const t = than(doc("lib/hoc-bu/case-doc.ts"), "whereCase");
    expect(t).toContain("AND: [{ students: { some: { makeupNeed: timHocVienBu(p.tim) } } }]");
    expect(t).toContain("courseId: p.courseId");
  });
  it("màn /hoc-bu: số trên tab dùng CÙNG bộ lọc chung với danh sách", () => {
    const t = doc("app/(admin)/admin/hoc-bu/page.tsx");
    expect(t).toContain("const tim = chuanHoaTim(sp.q);");
    expect(t).toContain("whereCanBu({ ...chung,");
    expect(t).toContain("whereCase({ ...chung,");
    expect(t).toContain("whereDaHuy({ ...chung,");
    expect(t.match(/loc=\{\{ \.\.\.chung,/g)).toHaveLength(3);
  });
});
