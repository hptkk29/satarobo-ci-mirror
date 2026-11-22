// @vitest-environment jsdom
/**
 * [XSS-*] F-20 — TÊN do người dùng gõ (họ tên phụ huynh / trẻ) có thể là HTML (`<img src=x onerror=…>`).
 * Mọi chỗ HIỂN THỊ tên phải coi nó là CHỮ: không sinh phần tử, không sinh thuộc tính sự kiện.
 * Dữ liệu BỊA. Không chạy script thật: ta đo CÂY DOM sinh ra (jsdom không tải ảnh).
 *   [XSS-01] giao diện portal (read-only ở đây): tổng quan, lịch sử, chi tiết, biểu đồ
 *   [XSS-02] bản in/PDF HTML (`dungBaoCaoHtml`, read-only ở đây): phân tích bằng DOMParser
 *   [XSS-03] LƯỚI NGUỒN: cấm các "lỗ" ghi HTML thô trong mã hiển thị DISC (trừ JSON-LD đã có hàm riêng)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ChiTietLuotDisc } from "@/components/disc-portal/chi-tiet-luot-disc";
import { DanhSachLuotDisc, LichSuDisc, TongQuanGiaDinh } from "@/components/disc-portal/tong-quan-disc";
import { dungLichSu, type LuotDisc } from "@/lib/disc/portal-doc";
import { dungBaoCaoHtml } from "@/lib/disc/tai-bao-cao";

afterEach(cleanup);

const DOC_HAI = [
  '<img src=x onerror="alert(1)">',
  '"><script>alert(1)</script>',
  "<svg/onload=alert(1)>",
  "' onmouseover='alert(1)",
  "</title><iframe srcdoc='<script>1</script>'></iframe>",
];

const luot = (ten: string): LuotDisc => ({
  id: "l1",
  taoLuc: new Date("2026-11-01T05:00:00Z"),
  engineVersion: "gia-1",
  nguoi: [
    { vaiTro: "PHU_HUYNH", hoTen: ten, namSinh: 1985, bacHoc: null, nguoiLonQuanSat: false, diem: { D: 40, I: 30, S: 20, C: 10 }, maBoDe: "BD-GIA", phienBanBoDe: "v1" },
    { vaiTro: "HOC_SINH", hoTen: ten, namSinh: 2016, bacHoc: "3", nguoiLonQuanSat: false, diem: { D: 10, I: 20, S: 30, C: 40 }, maBoDe: "BD-GIA", phienBanBoDe: "v1" },
  ],
});

function khongCoPhanTuNguyHiem(goc: ParentNode) {
  for (const sel of ["img", "script", "svg[onload]", "iframe", "[onerror]", "[onload]", "[onmouseover]"]) {
    expect(goc.querySelector(sel), `không được có phần tử ${sel}`).toBeNull();
  }
  // Thuộc tính sự kiện trên BẤT KỲ phần tử nào.
  for (const el of Array.from(goc.querySelectorAll("*"))) {
    for (const a of Array.from(el.attributes)) expect(a.name.startsWith("on"), `${el.tagName} có thuộc tính ${a.name}`).toBe(false);
  }
}

describe("[XSS-01] giao diện portal coi tên là chữ", () => {
  it.each(DOC_HAI)("payload %s", (p) => {
    const l = luot(p);
    const a = render(<TongQuanGiaDinh lichSu={dungLichSu([l])} />);
    khongCoPhanTuNguyHiem(a.container);
    expect(a.container.textContent).toContain(p); // đối chứng dương: tên VẪN hiện, nguyên văn, dạng chữ
    a.unmount();
    const b = render(<LichSuDisc lichSu={dungLichSu([l])} />);
    khongCoPhanTuNguyHiem(b.container);
    b.unmount();
    const c = render(<DanhSachLuotDisc trang={{ luot: [l], tong: 1, trang: 1, tongTrang: 1, moiTrang: 10 }} />);
    khongCoPhanTuNguyHiem(c.container);
    c.unmount();
    const d = render(<ChiTietLuotDisc luot={l} coBaoCao />);
    khongCoPhanTuNguyHiem(d.container);
    expect(d.container.textContent).toContain(p);
  });
});

describe("[XSS-02] bản in HTML", () => {
  it.each(DOC_HAI)("payload %s", (p) => {
    const html = dungBaoCaoHtml({
      taoLuc: "2026-11-01T05:00:00.000Z",
      engineVersion: "gia-1",
      nguoi: [{ vaiTro: "PHU_HUYNH", hoTen: p, namSinh: 1985, bacHoc: null, nguoiLonQuanSat: false, diem: { D: 40, I: 30, S: 20, C: 10 }, maBoDe: p, phienBanBoDe: p }],
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("img, script, iframe, svg, [onerror], [onload], [onmouseover]").length).toBe(0);
    expect(doc.querySelectorAll("script").length).toBe(0);
    expect(doc.querySelector("h2")!.textContent).toContain(p);
    expect(doc.title).toBe("Kết quả DISC");
  });
});

const GOC = process.cwd();
function liet(thuMuc: string): string[] {
  const ra: string[] = [];
  for (const ten of readdirSync(thuMuc)) {
    const d = join(thuMuc, ten);
    if (statSync(d).isDirectory()) ra.push(...liet(d));
    else if (/\.(ts|tsx)$/.test(ten) && !/\.test\./.test(ten)) ra.push(d);
  }
  return ra;
}
function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:\\"'`])\/\/[^\n]*/gm, "$1");
}

describe("[XSS-03] lưới nguồn: không ghi HTML thô trong mã hiển thị DISC", () => {
  const THU_MUC = ["components/disc", "components/disc-portal", "app/(portal)/portal/disc", "app/(public)/disc"].map((d) => resolve(GOC, d));
  const tep = THU_MUC.flatMap(liet).map((t) => ({ t: t.split(sep).join("/"), ma: boChuThich(readFileSync(t, "utf8")) }));
  const LO = /\b(dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write(ln)?)\b/;

  it("quét được tệp thật", () => {
    expect(tep.length).toBeGreaterThan(20);
    expect(tep.some((x) => x.t.endsWith("components/disc-portal/chi-tiet-luot-disc.tsx"))).toBe(true);
  });
  it("chỉ JSON-LD của landing /disc được dùng dangerouslySetInnerHTML — và bằng hàm jsonLdScript", () => {
    const dung = tep.filter((x) => LO.test(x.ma));
    expect(dung.map((x) => x.t.replace(/^.*?(app\/\(public\)\/disc\/)/, "$1"))).toEqual(["app/(public)/disc/page.tsx"]);
    const dong = dung[0]!.ma.split("\n").filter((l) => LO.test(l));
    expect(dong.length).toBe(1);
    expect(dong[0]).toMatch(/application\/ld\+json/);
    expect(dong[0]).toMatch(/__html:\s*jsonLdScript\(/);
  });
});
